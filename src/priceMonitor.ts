import { ethers } from 'ethers';
import {
  BASE, ARB_PAIRS, ArbPair,
  ERC20_ABI, UNISWAP_FACTORY_ABI, UNISWAP_POOL_ABI,
} from './addresses';
import { BotConfig } from './config';
import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// TIPE DATA
// ════════════════════════════════════════════════

export interface ArbOpportunity {
  pair: ArbPair;
  flashloanAmount: bigint;
  expectedProfit: bigint;
  expectedProfitEth: string;
  profitBps: number;
  marketPrice: number;
  aavePrice: number;
  poolAddress: string;
  actualAmountOut: bigint;   // dari Quoter — nilai real
}

// ════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════

// Aave V3 flashloan premium = 0.09%
const AAVE_PREMIUM_BPS = 9n;
const BPS_DENOMINATOR  = 10000n;

// QuoterV2 Base mainnet (Uniswap official)
const QUOTER_V2_ADDRESS = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';

const QUOTER_V2_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const AAVE_POOL_ABI = [
  'function getReserveNormalizedIncome(address asset) view returns (uint256)',
];

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════

function calcFlashloanPremium(amount: bigint): bigint {
  return (amount * AAVE_PREMIUM_BPS) / BPS_DENOMINATOR;
}

async function getDecimals(
  provider: ethers.JsonRpcProvider,
  token: string
): Promise<number> {
  try {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    return Number(await contract.decimals());
  } catch {
    return 18;
  }
}

// ════════════════════════════════════════════════
// GET AAVE EXCHANGE RATE
// Aave aWETH bukan 1:1 — ada accumulated interest
// 1 aWETH = ~1.04 WETH karena interest
// ════════════════════════════════════════════════

async function getAaveExchangeRate(
  provider: ethers.JsonRpcProvider,
  asset: string
): Promise<number> {
  try {
    const pool = new ethers.Contract(BASE.AAVE_POOL, AAVE_POOL_ABI, provider);
    const normalizedIncome = await pool.getReserveNormalizedIncome(asset);
    // normalizedIncome dalam RAY (1e27)
    return Number(normalizedIncome) / 1e27;
  } catch {
    return 1.0;
  }
}

// ════════════════════════════════════════════════
// GET ACTUAL QUOTE VIA UNISWAP QUOTER
// Lebih akurat dari slot0 — tahu persis output aktual
// ════════════════════════════════════════════════

async function getActualQuote(
  provider: ethers.JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: bigint
): Promise<{ amountOut: bigint; executable: boolean }> {
  try {
    const quoter = new ethers.Contract(QUOTER_V2_ADDRESS, QUOTER_V2_ABI, provider);
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    });
    return { amountOut: BigInt(result[0].toString()), executable: true };
  } catch {
    return { amountOut: 0n, executable: false };
  }
}

// ════════════════════════════════════════════════
// GET POOL ADDRESS
// ════════════════════════════════════════════════

async function getPoolAddress(
  provider: ethers.JsonRpcProvider,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<string | null> {
  try {
    const factory = new ethers.Contract(
      BASE.UNISWAP_FACTORY,
      UNISWAP_FACTORY_ABI,
      provider
    );
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);
    if (poolAddress === ethers.ZeroAddress) return null;
    return poolAddress;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════
// SCAN OPPORTUNITIES
// Menggunakan Quoter untuk verifikasi real sebelum eksekusi
// ════════════════════════════════════════════════

export async function scanOpportunities(
  config: BotConfig
): Promise<ArbOpportunity[]> {
  const opportunities: ArbOpportunity[] = [];
  const { provider, flashloanAmountEth, minProfitEth } = config;

  // Ambil Aave exchange rate sekali untuk semua pairs
  const aaveRate = await getAaveExchangeRate(provider, BASE.WETH);
  logger.info(`Aave WETH rate: 1 aWETH = ${aaveRate.toFixed(6)} WETH`);

  for (const pair of ARB_PAIRS) {
    try {
      // ─── Cek pool ada ───
      const poolAddress = await getPoolAddress(
        provider,
        pair.flashloanToken,
        pair.marketToken,
        pair.poolFee
      );

      if (!poolAddress) {
        logger.warn(`No pool found for ${pair.name}`);
        continue;
      }

      // ─── Strategy: deposit WETH ke Aave → dapat aWETH → jual di Uniswap ───
      // Aave rate > 1 berarti 1 WETH deposit → dapat aWETH yang bisa dijual > 1 WETH
      //
      // Step 1: Deposit flashloanAmount WETH ke Aave
      //         → dapat flashloanAmount aWETH (1:1 token, tapi aWETH worth lebih)
      // Step 2: Jual aWETH di Uniswap → dapat WETH
      // Profit = WETH received - flashloan amount - premium

      // Get actual quote: berapa WETH yang dapat kalau jual aWETH
      const { amountOut: wethFromSell, executable } = await getActualQuote(
        provider,
        pair.marketToken,    // aWETH in
        pair.flashloanToken, // WETH out
        pair.poolFee,
        flashloanAmountEth   // amount aWETH to sell
      );

      if (!executable) {
        logger.info(`${pair.name}: swap not executable via Quoter`);
        continue;
      }

      // ─── Hitung profit real ───
      const premium   = calcFlashloanPremium(flashloanAmountEth);
      const totalDebt = flashloanAmountEth + premium;

      if (wethFromSell <= totalDebt) {
        const diff = ethers.formatEther(totalDebt - wethFromSell);
        logger.info(`${pair.name}: not profitable (short by ${diff} ETH)`);
        continue;
      }

      const netProfit = wethFromSell - totalDebt;
      const profitBps = Math.floor(
        (Number(netProfit) / Number(flashloanAmountEth)) * 10000
      );

      const marketPrice = Number(ethers.formatEther(wethFromSell)) /
                          Number(ethers.formatEther(flashloanAmountEth));

      logger.info(
        `${pair.name}: sell ${ethers.formatEther(flashloanAmountEth)} aWETH → ` +
        `${ethers.formatEther(wethFromSell)} WETH | ` +
        `profit=${ethers.formatEther(netProfit)} ETH (${profitBps} bps)`
      );

      if (netProfit < minProfitEth) continue;

      logger.opportunity(
        pair.name,
        parseFloat(ethers.formatEther(netProfit)),
        profitBps / 100
      );

      opportunities.push({
        pair,
        flashloanAmount:    flashloanAmountEth,
        expectedProfit:     netProfit,
        expectedProfitEth:  ethers.formatEther(netProfit),
        profitBps,
        marketPrice,
        aavePrice:          aaveRate,
        poolAddress,
        actualAmountOut:    wethFromSell,
      });

    } catch (err) {
      logger.warn(`Error scanning ${pair.name}: ${err}`);
    }
  }

  opportunities.sort((a, b) => {
    if (b.expectedProfit > a.expectedProfit) return 1;
    if (b.expectedProfit < a.expectedProfit) return -1;
    return 0;
  });

  logger.scan(ARB_PAIRS.length, opportunities.length);
  return opportunities;
}
