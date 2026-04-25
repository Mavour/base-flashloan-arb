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
  flashloanAmount: bigint;      // wei
  expectedProfit: bigint;       // wei
  expectedProfitEth: string;    // human readable
  profitBps: number;            // basis points (1 bps = 0.01%)
  marketPrice: number;          // harga di Uniswap
  aavePrice: number;            // harga di Aave (seharusnya 1.0)
  poolAddress: string;
}

// ════════════════════════════════════════════════
// AAVE FLASH LOAN PREMIUM
// ════════════════════════════════════════════════

// Aave V3 flashloan premium = 0.09% = 9 bps
const AAVE_PREMIUM_BPS = 9n;
const BPS_DENOMINATOR  = 10000n;

function calcFlashloanPremium(amount: bigint): bigint {
  return (amount * AAVE_PREMIUM_BPS) / BPS_DENOMINATOR;
}

// ════════════════════════════════════════════════
// GET UNISWAP POOL PRICE
// ════════════════════════════════════════════════

/**
 * Ambil harga dari Uniswap V3 pool via slot0.
 * sqrtPriceX96 → actual price ratio
 */
async function getUniswapPrice(
  provider: ethers.JsonRpcProvider,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<{ price: number; poolAddress: string } | null> {
  try {
    const factory = new ethers.Contract(
      BASE.UNISWAP_FACTORY,
      UNISWAP_FACTORY_ABI,
      provider
    );

    const poolAddress = await factory.getPool(tokenA, tokenB, fee);
    if (poolAddress === ethers.ZeroAddress) return null;

    const pool = new ethers.Contract(poolAddress, UNISWAP_POOL_ABI, provider);
    const slot0 = await pool.slot0();

    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());

    // Convert sqrtPriceX96 ke price ratio
    // price = (sqrtPriceX96 / 2^96)^2
    const Q96    = 2n ** 96n;
    const priceRatio = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q96 * Q96);

    // Sesuaikan decimals
    const [dec0, dec1] = await Promise.all([
      getDecimals(provider, tokenA),
      getDecimals(provider, tokenB),
    ]);

    const adjustedPrice = priceRatio * Math.pow(10, dec0 - dec1);

    return { price: adjustedPrice, poolAddress };
  } catch {
    return null;
  }
}

async function getDecimals(
  provider: ethers.JsonRpcProvider,
  token: string
): Promise<number> {
  try {
    const contract = new ethers.Contract(token, ERC20_ABI, provider);
    return Number(await contract.decimals());
  } catch {
    return 18; // default ETH decimals
  }
}

// ════════════════════════════════════════════════
// SIMULATE PROFIT
// ════════════════════════════════════════════════

/**
 * Simulasikan profit dari arb:
 * - Beli aToken di market dengan harga `marketPrice`
 * - Redeem di Aave 1:1
 * - Bayar flashloan premium
 * - Sisa = profit
 */
function simulateProfit(
  flashloanAmount: bigint,
  marketPrice: number,  // berapa aToken yang dapat per 1 WETH
  pair: ArbPair
): {
  grossProfit: bigint;
  premium: bigint;
  netProfit: bigint;
} {
  const premium = calcFlashloanPremium(flashloanAmount);

  // Berapa aToken yang kita dapat dengan flashloanAmount WETH
  // Kalau marketPrice = 1.002, artinya 1 WETH → 1.002 aWETH
  const aTokenReceived = BigInt(
    Math.floor(Number(flashloanAmount) * marketPrice)
  );

  // Redeem aToken → WETH (1:1 di Aave)
  const wethAfterRedeem = aTokenReceived;

  // Gross profit sebelum premium
  const grossProfit = wethAfterRedeem > flashloanAmount
    ? wethAfterRedeem - flashloanAmount
    : 0n;

  // Net profit setelah bayar premium
  const netProfit = grossProfit > premium
    ? grossProfit - premium
    : 0n;

  return { grossProfit, premium, netProfit };
}

// ════════════════════════════════════════════════
// SCAN OPPORTUNITIES
// ════════════════════════════════════════════════

export async function scanOpportunities(
  config: BotConfig
): Promise<ArbOpportunity[]> {
  const opportunities: ArbOpportunity[] = [];
  const { provider, flashloanAmountEth, minProfitEth } = config;

  for (const pair of ARB_PAIRS) {
    try {
      // Ambil harga dari Uniswap
      const result = await getUniswapPrice(
        provider,
        pair.flashloanToken,
        pair.marketToken,
        pair.poolFee
      );

      if (!result) {
        logger.warn(`No pool found for ${pair.name}`);
        continue;
      }

      const { price: marketPrice, poolAddress } = result;

      // Aave price = 1.0 (redeem 1:1)
      const aavePrice = 1.0;

      // Cek apakah ada peluang (marketPrice > 1 = kita dapat lebih aToken)
      if (marketPrice <= aavePrice) {
        logger.info(`${pair.name}: no arb (market=${marketPrice.toFixed(6)})`);
        continue;
      }

      // Simulasikan profit
      const { netProfit } = simulateProfit(flashloanAmountEth, marketPrice, pair);

      const profitBps = Math.floor(
        (Number(netProfit) / Number(flashloanAmountEth)) * 10000
      );

      logger.info(
        `${pair.name}: market=${marketPrice.toFixed(6)} ` +
        `profit=${ethers.formatEther(netProfit)} ETH (${profitBps} bps)`
      );

      if (netProfit < minProfitEth) continue;

      const opp: ArbOpportunity = {
        pair,
        flashloanAmount:    flashloanAmountEth,
        expectedProfit:     netProfit,
        expectedProfitEth:  ethers.formatEther(netProfit),
        profitBps,
        marketPrice,
        aavePrice,
        poolAddress,
      };

      logger.opportunity(
        pair.name,
        parseFloat(ethers.formatEther(netProfit)),
        profitBps / 100
      );

      opportunities.push(opp);

    } catch (err) {
      logger.warn(`Error scanning ${pair.name}: ${err}`);
    }
  }

  // Sort by profit tertinggi
  opportunities.sort((a, b) => {
    if (b.expectedProfit > a.expectedProfit) return 1;
    if (b.expectedProfit < a.expectedProfit) return -1;
    return 0;
  });

  logger.scan(ARB_PAIRS.length, opportunities.length);
  return opportunities;
}
