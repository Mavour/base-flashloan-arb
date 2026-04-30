// src/priceMonitor.ts
import { ethers } from 'ethers';
import { ADDRESSES, ARB_PAIRS } from './addresses';
import { logger } from './utils/logger';

// ─── ABIs ────────────────────────────────────────────────────────────────────
const UNISWAP_QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)',
];

// Fee tiers yang akan dicoba secara berurutan
const UNI_FEE_TIERS = [500, 3000, 10000, 100];

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
  private uniQuoter: ethers.Contract;
  private aeroRouter: ethers.Contract;
  private provider: ethers.Provider;

  private readonly AAVE_PREMIUM_BPS = 9n;
  private readonly BPS_BASE = 10000n;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
    this.uniQuoter = new ethers.Contract(
      ADDRESSES.UNISWAP_V3_QUOTER,
      UNISWAP_QUOTER_ABI,
      provider
    );
    this.aeroRouter = new ethers.Contract(
      ADDRESSES.AERODROME_ROUTER,
      AERODROME_ROUTER_ABI,
      provider
    );
  }

  // ── Quote Uniswap V3 — coba semua fee tier, ambil yang terbaik ─────────────
  private async quoteUniswap(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    preferredFee: number
  ): Promise<{ amountOut: bigint; fee: number }> {
    // Prioritaskan fee tier dari config, lalu coba sisanya
    const feesToTry = [
      preferredFee,
      ...UNI_FEE_TIERS.filter(f => f !== preferredFee),
    ];

    let bestOut = 0n;
    let bestFee = preferredFee;

    for (const fee of feesToTry) {
      try {
        const [amountOut] = await this.uniQuoter.quoteExactInputSingle.staticCall({
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0n,
        });
        if (amountOut > bestOut) {
          bestOut = amountOut;
          bestFee = fee;
        }
      } catch {
        // Pool tidak ada untuk fee tier ini, lanjut ke berikutnya
        continue;
      }
    }

    return { amountOut: bestOut, fee: bestFee };
  }

  // ── Quote Aerodrome — coba volatile dulu, lalu stable ─────────────────────
  private async quoteAerodrome(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<bigint> {
    let bestOut = 0n;

    for (const stable of [false, true]) {
      try {
        const routes = [{
          from: tokenIn,
          to: tokenOut,
          stable,
          factory: ADDRESSES.AERODROME_FACTORY,
        }];
        const amounts = await this.aeroRouter.getAmountsOut(amountIn, routes);
        const out = amounts[amounts.length - 1];
        if (out > bestOut) bestOut = out;
      } catch {
        continue;
      }
    }

    return bestOut;
  }

  // ── Estimasi profit dalam ETH ──────────────────────────────────────────────
  private async estimateProfitInEth(
    profitRaw: bigint,
    tokenOut: string,
    decimalsOut: number
  ): Promise<number> {
    if (tokenOut.toLowerCase() === ADDRESSES.WETH.toLowerCase()) {
      return Number(ethers.formatUnits(profitRaw, 18));
    }
    if (tokenOut.toLowerCase() === ADDRESSES.USDC.toLowerCase()) {
      const usdcAmount = Number(ethers.formatUnits(profitRaw, 6));
      return usdcAmount / 2500;
    }
    return Number(ethers.formatUnits(profitRaw, decimalsOut));
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
        `${pair.name}: quote failed (uni=${uniOut} aero=${aeroOut}) ` +
        `[best uni fee: ${uniResult.fee}]`
      );
      return null;
    }

    const spreadBps = uniOut > aeroOut
      ? ((uniOut - aeroOut) * 10000n) / aeroOut
      : ((aeroOut - uniOut) * 10000n) / uniOut;

    logger.info(
      `${pair.name}: UNI=${ethers.formatUnits(uniOut, pair.decimalsOut)} ` +
      `(fee=${uniResult.fee}) ` +
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

    const profitEth    = await this.estimateProfitInEth(rawProfit, pair.tokenOut, pair.decimalsOut);
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
        flashloanAmount: flashloanAmount,
        uniswapFee: uniResult.fee,  // pakai fee terbaik yang ditemukan
      },
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn,
      uniswapOut: uniOut,
      aerodromeOut: aeroOut,
      profitRaw: rawProfit,
      profitEth: netProfitEth,
      direction,
      flashloanToken: pair.flashloanToken,
      flashloanAmount,
      timestamp: Date.now(),
      strategyName: direction,
      expectedProfitEth: netProfitEth.toFixed(6),
      profitBps: Number(spreadBps),
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
