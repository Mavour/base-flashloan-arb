// src/priceMonitor.ts
import { ethers } from 'ethers';
import { ADDRESSES, ARB_PAIRS } from './addresses';
import { logger } from './utils/logger';

// ─── ABIs ────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
];

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)',
];

const UNI_FEE_TIERS = [500, 3000, 100, 10000];

// ─── Types ───────────────────────────────────────────────────────────────────
export interface ArbOpportunity {
  pair: any;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  uniswapOut: bigint;
  aerodromeOut: bigint;
  profitRaw: bigint;
  profitEth: number;
  direction: 'UNI_TO_AERO' | 'AERO_TO_UNI';
  flashloanToken: string;
  flashloanAmount: bigint;
  timestamp: number;
  strategyName: string;
  expectedProfitEth: string;
  profitBps: number;
}

// ─── Price Monitor Class ─────────────────────────────────────────────────────
export class PriceMonitor {
  private factory: ethers.Contract;
  private aeroRouter: ethers.Contract;
  private provider: ethers.Provider;

  private readonly AAVE_PREMIUM_BPS = 9n;
  private readonly BPS_BASE         = 10000n;

  constructor(provider: ethers.Provider) {
    this.provider   = provider;
    this.factory    = new ethers.Contract(ADDRESSES.UNISWAP_V3_FACTORY, FACTORY_ABI, provider);
    this.aeroRouter = new ethers.Contract(ADDRESSES.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
  }

  // ── Hitung amountOut dari sqrtPriceX96 (raw values, NO decimal adjustment) ─
  // Formula Uniswap V3:
  //   price = (sqrtP / 2^96)^2 = token1_raw / token0_raw
  //
  //   tokenIn=token0 → amountOut = amountIn * sqrtP / 2^96 * sqrtP / 2^96
  //   tokenIn=token1 → amountOut = amountIn * 2^96 / sqrtP * 2^96 / sqrtP
  //
  // Step-by-step division menghindari integer overflow
  private calcAmountOut(
    sqrtPriceX96: bigint,
    amountIn: bigint,
    tokenIn: string,
    token0: string,
  ): bigint {
    if (sqrtPriceX96 === 0n || amountIn === 0n) return 0n;

    const Q96 = 2n ** 96n;
    const isToken0 = tokenIn.toLowerCase() === token0.toLowerCase();

    try {
      if (isToken0) {
        // token0 → token1: multiply by price (sqrtP^2 / Q96^2)
        // amountOut = amountIn * sqrtP / Q96 * sqrtP / Q96
        const step1 = amountIn * sqrtPriceX96 / Q96;
        return step1 * sqrtPriceX96 / Q96;
      } else {
        // token1 → token0: divide by price (Q96^2 / sqrtP^2)
        // amountOut = amountIn * Q96 / sqrtP * Q96 / sqrtP
        const step1 = amountIn * Q96 / sqrtPriceX96;
        return step1 * Q96 / sqrtPriceX96;
      }
    } catch {
      return 0n;
    }
  }

  // ── Quote Uniswap V3 via Pool slot0 ───────────────────────────────────────
  async quoteUniswap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    preferredFee: number
  ): Promise<{ amountOut: bigint; fee: number; poolAddress: string }> {
    const feesToTry = [preferredFee, ...UNI_FEE_TIERS.filter(f => f !== preferredFee)];

    let bestOut  = 0n;
    let bestFee  = preferredFee;
    let bestPool = ethers.ZeroAddress;

    for (const fee of feesToTry) {
      try {
        const poolAddress: string = await this.factory.getPool(tokenIn, tokenOut, fee);
        if (!poolAddress || poolAddress === ethers.ZeroAddress) continue;

        const pool = new ethers.Contract(poolAddress, POOL_ABI, this.provider);
        const [slot0Data, token0]: [any, string] = await Promise.all([
          pool.slot0(),
          pool.token0(),
        ]);

        const sqrtPriceX96: bigint = slot0Data[0];
        if (sqrtPriceX96 === 0n) continue;

        // Kurangi fee dari amountIn (dalam bps per million)
        const feeAmount      = amountIn * BigInt(fee) / 1_000_000n;
        const amountAfterFee = amountIn - feeAmount;

        const amountOut = this.calcAmountOut(sqrtPriceX96, amountAfterFee, tokenIn, token0);

        if (amountOut > bestOut) {
          bestOut  = amountOut;
          bestFee  = fee;
          bestPool = poolAddress;
        }
      } catch {
        continue;
      }
    }

    return { amountOut: bestOut, fee: bestFee, poolAddress: bestPool };
  }

  // ── Quote Aerodrome ────────────────────────────────────────────────────────
  private async quoteAerodrome(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<bigint> {
    let bestOut = 0n;
    for (const stable of [false, true]) {
      try {
        const routes = [{ from: tokenIn, to: tokenOut, stable, factory: ADDRESSES.AERODROME_FACTORY }];
        const amounts = await this.aeroRouter.getAmountsOut(amountIn, routes);
        const out: bigint = amounts[amounts.length - 1];
        if (out > bestOut) bestOut = out;
      } catch {
        continue;
      }
    }
    return bestOut;
  }

  // ── Estimasi profit dalam ETH ──────────────────────────────────────────────
  private estimateProfitInEth(profitRaw: bigint, tokenOut: string): number {
    if (tokenOut.toLowerCase() === ADDRESSES.WETH.toLowerCase()) {
      return Number(ethers.formatUnits(profitRaw, 18));
    }
    if (tokenOut.toLowerCase() === ADDRESSES.USDC.toLowerCase()) {
      return Number(ethers.formatUnits(profitRaw, 6)) / 2500;
    }
    return Number(ethers.formatUnits(profitRaw, 18));
  }

  // ── Scan satu pair ─────────────────────────────────────────────────────────
  async scanPair(pair: typeof ARB_PAIRS[0]): Promise<ArbOpportunity | null> {
    const amountIn = ethers.parseUnits(pair.flashloanAmount, pair.decimalsIn);

    const [uniResult, aeroOut] = await Promise.all([
      this.quoteUniswap(pair.tokenIn, pair.tokenOut, amountIn, pair.uniswapFee),
      this.quoteAerodrome(pair.tokenIn, pair.tokenOut, amountIn),
    ]);

    const uniOut = uniResult.amountOut;

    if (uniOut === 0n || aeroOut === 0n) {
      logger.warn(
        `${pair.name}: quote failed ` +
        `(uni=${ethers.formatUnits(uniOut, pair.decimalsOut)} ` +
        `fee=${uniResult.fee} ` +
        `aero=${ethers.formatUnits(aeroOut, pair.decimalsOut)})`
      );
      return null;
    }

    const spreadBps = uniOut > aeroOut
      ? ((uniOut - aeroOut) * 10000n) / aeroOut
      : ((aeroOut - uniOut) * 10000n) / uniOut;

    logger.info(
      `${pair.name}: ` +
      `UNI=${ethers.formatUnits(uniOut, pair.decimalsOut)} (fee=${uniResult.fee}) ` +
      `AERO=${ethers.formatUnits(aeroOut, pair.decimalsOut)} ` +
      `spread=${Number(spreadBps) / 100}%`
    );

    const direction  = uniOut > aeroOut ? 'UNI_TO_AERO' as const : 'AERO_TO_UNI' as const;
    const bestOut    = uniOut > aeroOut ? uniOut : aeroOut;
    const worstOut   = uniOut > aeroOut ? aeroOut : uniOut;
    const rawProfit  = bestOut - worstOut;

    const flashloanAmount = ethers.parseUnits(pair.flashloanAmount, pair.decimalsIn);
    const flashloanCost   = (flashloanAmount * this.AAVE_PREMIUM_BPS) / this.BPS_BASE;
    const GAS_COST_ETH    = 0.0001;

    const profitEth    = this.estimateProfitInEth(rawProfit, pair.tokenOut);
    const netProfitEth = profitEth - GAS_COST_ETH - Number(ethers.formatEther(flashloanCost));

    if (netProfitEth <= 0) {
      logger.info(`${pair.name}: not profitable (net=${netProfitEth.toFixed(6)} ETH)`);
      return null;
    }

    logger.info(`✅ OPPORTUNITY: ${pair.name} ${direction} profit~${netProfitEth.toFixed(6)} ETH`);

    return {
      pair: {
        name: pair.name,
        tokenIn: pair.tokenIn,
        tokenOut: pair.tokenOut,
        flashloanToken: pair.flashloanToken,
        flashloanAmount,
        uniswapFee: uniResult.fee,
      },
      tokenIn:          pair.tokenIn,
      tokenOut:         pair.tokenOut,
      amountIn,
      uniswapOut:       uniOut,
      aerodromeOut:     aeroOut,
      profitRaw:        rawProfit,
      profitEth:        netProfitEth,
      direction,
      flashloanToken:   pair.flashloanToken,
      flashloanAmount,
      timestamp:        Date.now(),
      strategyName:     direction,
      expectedProfitEth: netProfitEth.toFixed(6),
      profitBps:        Number(spreadBps),
    };
  }

  // ── Scan semua pairs ───────────────────────────────────────────────────────
  async scanAll(): Promise<ArbOpportunity[]> {
    const results = await Promise.allSettled(
      ARB_PAIRS.map(pair => this.scanPair(pair))
    );

    const opportunities: ArbOpportunity[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        opportunities.push(result.value);
      }
    }

    return opportunities.sort((a, b) => b.profitEth - a.profitEth);
  }
}

// ─── Wrapper Function (dipanggil oleh index.ts) ───────────────────────────────
export async function scanOpportunities(config: any): Promise<ArbOpportunity[]> {
  const monitor = new PriceMonitor(config.provider);
  return monitor.scanAll();
}
