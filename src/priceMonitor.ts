import { ethers } from 'ethers';
import {
  BASE, ARB_PAIRS, ArbPair,
  ERC20_ABI,
  UNISWAP_FACTORY_ABI,
  QUOTER_V2_ABI,
  AERODROME_FACTORY_ABI,
  AERODROME_ROUTER_ABI,
} from './addresses';
import { BotConfig } from './config';
import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════

// Aave V3 flashloan premium = 0.05% (bukan 0.09%!)
const AAVE_PREMIUM_BPS = 5n;
const BPS_DENOMINATOR  = 10000n;

// Strategy IDs (harus sama dengan contract)
export const STRATEGY_UNI_TO_AERO = 1;
export const STRATEGY_AERO_TO_UNI = 2;

// ════════════════════════════════════════════════
// TIPE DATA
// ════════════════════════════════════════════════

export interface ArbOpportunity {
  pair: ArbPair;
  strategy: number;          // 1 atau 2
  strategyName: string;      // human readable
  flashloanAmount: bigint;
  expectedProfit: bigint;
  expectedProfitEth: string;
  profitBps: number;
  uniswapAmountOut: bigint;  // output dari Uniswap
  aerodromeAmountOut: bigint; // output dari Aerodrome
  poolAddress: string;
}

// ════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════

function calcPremium(amount: bigint): bigint {
  return (amount * AAVE_PREMIUM_BPS) / BPS_DENOMINATOR;
}

async function getDecimals(
  provider: ethers.JsonRpcProvider,
  token: string
): Promise<number> {
  try {
    const c = new ethers.Contract(token, ERC20_ABI, provider);
    return Number(await c.decimals());
  } catch { return 18; }
}

// ════════════════════════════════════════════════
// GET UNISWAP QUOTE (via QuoterV2)
// Output aktual yang akan diterima dari Uniswap
// ════════════════════════════════════════════════

async function getUniswapQuote(
  provider: ethers.JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  fee: number,
  amountIn: bigint
): Promise<bigint> {
  try {
    const quoter = new ethers.Contract(BASE.QUOTER_V2, QUOTER_V2_ABI, provider);
    const result = await quoter.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0,
    });
    return BigInt(result[0].toString());
  } catch {
    return 0n;
  }
}

// ════════════════════════════════════════════════
// GET AERODROME QUOTE (via Router.getAmountsOut)
// Output aktual yang akan diterima dari Aerodrome
// ════════════════════════════════════════════════

async function getAerodromeQuote(
  provider: ethers.JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  stable: boolean,
  amountIn: bigint
): Promise<bigint> {
  try {
    const router = new ethers.Contract(
      BASE.AERODROME_ROUTER,
      AERODROME_ROUTER_ABI,
      provider
    );

    const routes = [{
      from:    tokenIn,
      to:      tokenOut,
      stable,
      factory: BASE.AERODROME_FACTORY,
    }];

    const amounts = await router.getAmountsOut(amountIn, routes);
    return BigInt(amounts[amounts.length - 1].toString());
  } catch {
    return 0n;
  }
}

// ════════════════════════════════════════════════
// GET POOL ADDRESS
// ════════════════════════════════════════════════

async function getUniswapPool(
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
    const pool = await factory.getPool(tokenA, tokenB, fee);
    return pool === ethers.ZeroAddress ? null : pool;
  } catch { return null; }
}

// ════════════════════════════════════════════════
// SCAN SATU PAIR — cek kedua arah
// ════════════════════════════════════════════════

async function scanPair(
  provider: ethers.JsonRpcProvider,
  pair: ArbPair,
  flashloanAmount: bigint,
  minProfitWei: bigint
): Promise<ArbOpportunity[]> {
  const opportunities: ArbOpportunity[] = [];

  // Pastikan pool Uniswap ada
  const poolAddress = await getUniswapPool(
    provider, pair.tokenIn, pair.tokenOut, pair.uniswapFee
  );
  if (!poolAddress) {
    logger.warn(`${pair.name}: Uniswap pool not found`);
    return [];
  }

  const premium   = calcPremium(flashloanAmount);
  const totalDebt = flashloanAmount + premium;

  // ─── STRATEGY 1: Buy Uniswap → Sell Aerodrome ───
  // Step 1: flashloanAmount tokenIn → tokenOut via Uniswap
  const uniOut1 = await getUniswapQuote(
    provider, pair.tokenIn, pair.tokenOut, pair.uniswapFee, flashloanAmount
  );

  if (uniOut1 > 0n) {
    // Step 2: tokenOut → tokenIn via Aerodrome
    const aeroOut1 = await getAerodromeQuote(
      provider, pair.tokenOut, pair.tokenIn, pair.aerodromeStable, uniOut1
    );

    if (aeroOut1 > totalDebt) {
      const profit = aeroOut1 - totalDebt;
      const bps = Math.floor((Number(profit) / Number(flashloanAmount)) * 10000);

      if (profit >= minProfitWei) {
        const profitEth = ethers.formatEther(profit);
        logger.opportunity(`${pair.name} [UniSwap→Aerodrome]`, parseFloat(profitEth), bps / 100);
        opportunities.push({
          pair,
          strategy:            STRATEGY_UNI_TO_AERO,
          strategyName:        'Uniswap→Aerodrome',
          flashloanAmount,
          expectedProfit:      profit,
          expectedProfitEth:   profitEth,
          profitBps:           bps,
          uniswapAmountOut:    uniOut1,
          aerodromeAmountOut:  aeroOut1,
          poolAddress,
        });
      } else {
        logger.info(`${pair.name} [Uni→Aero]: profit=${ethers.formatEther(profit)} ETH (below min)`);
      }
    } else {
      logger.info(`${pair.name} [Uni→Aero]: not profitable`);
    }
  }

  // ─── STRATEGY 2: Buy Aerodrome → Sell Uniswap ───
  // Step 1: flashloanAmount tokenIn → tokenOut via Aerodrome
  const aeroOut2 = await getAerodromeQuote(
    provider, pair.tokenIn, pair.tokenOut, pair.aerodromeStable, flashloanAmount
  );

  if (aeroOut2 > 0n) {
    // Step 2: tokenOut → tokenIn via Uniswap
    const uniOut2 = await getUniswapQuote(
      provider, pair.tokenOut, pair.tokenIn, pair.uniswapFee, aeroOut2
    );

    if (uniOut2 > totalDebt) {
      const profit = uniOut2 - totalDebt;
      const bps = Math.floor((Number(profit) / Number(flashloanAmount)) * 10000);

      if (profit >= minProfitWei) {
        const profitEth = ethers.formatEther(profit);
        logger.opportunity(`${pair.name} [Aerodrome→Uniswap]`, parseFloat(profitEth), bps / 100);
        opportunities.push({
          pair,
          strategy:            STRATEGY_AERO_TO_UNI,
          strategyName:        'Aerodrome→Uniswap',
          flashloanAmount,
          expectedProfit:      profit,
          expectedProfitEth:   profitEth,
          profitBps:           bps,
          uniswapAmountOut:    uniOut2,
          aerodromeAmountOut:  aeroOut2,
          poolAddress,
        });
      } else {
        logger.info(`${pair.name} [Aero→Uni]: profit=${ethers.formatEther(profit)} ETH (below min)`);
      }
    } else {
      logger.info(`${pair.name} [Aero→Uni]: not profitable`);
    }
  }

  return opportunities;
}

// ════════════════════════════════════════════════
// MAIN SCAN — semua pairs
// ════════════════════════════════════════════════

export async function scanOpportunities(
  config: BotConfig
): Promise<ArbOpportunity[]> {
  const all: ArbOpportunity[] = [];
  const { provider, flashloanAmountEth, minProfitEth } = config;

  for (const pair of ARB_PAIRS) {
    try {
      const opps = await scanPair(
        provider,
        pair,
        flashloanAmountEth,
        minProfitEth
      );
      all.push(...opps);
    } catch (err) {
      logger.warn(`Error scanning ${pair.name}: ${err}`);
    }
  }

  // Sort by profit tertinggi
  all.sort((a, b) => {
    if (b.expectedProfit > a.expectedProfit) return 1;
    if (b.expectedProfit < a.expectedProfit) return -1;
    return 0;
  });

  logger.scan(ARB_PAIRS.length, all.length);
  return all;
}
