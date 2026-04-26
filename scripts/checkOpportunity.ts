import { ethers }  from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  BASE, ARB_PAIRS,
  QUOTER_V2_ABI, AERODROME_ROUTER_ABI, ERC20_ABI
} from '../src/addresses';

// ════════════════════════════════════════════════
// CHECK OPPORTUNITY v2.1 — Cross-DEX Scanner
// Cara run: npm run check
// ════════════════════════════════════════════════

async function getUniQuote(
  provider: ethers.JsonRpcProvider,
  tokenIn: string, tokenOut: string,
  fee: number, amountIn: bigint
): Promise<bigint> {
  try {
    const q = new ethers.Contract(BASE.QUOTER_V2, QUOTER_V2_ABI, provider);
    const r = await q.quoteExactInputSingle.staticCall({
      tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0
    });
    return BigInt(r[0].toString());
  } catch { return 0n; }
}

async function getAeroQuote(
  provider: ethers.JsonRpcProvider,
  tokenIn: string, tokenOut: string,
  stable: boolean, amountIn: bigint
): Promise<bigint> {
  try {
    const r = new ethers.Contract(BASE.AERODROME_ROUTER, AERODROME_ROUTER_ABI, provider);
    const routes = [{ from: tokenIn, to: tokenOut, stable, factory: BASE.AERODROME_FACTORY }];
    const amounts = await r.getAmountsOut(amountIn, routes);
    return BigInt(amounts[amounts.length - 1].toString());
  } catch { return 0n; }
}

async function getSymbol(provider: ethers.JsonRpcProvider, token: string): Promise<string> {
  try {
    const c = new ethers.Contract(token, ERC20_ABI, provider);
    return await c.symbol();
  } catch { return token.slice(0, 8); }
}

async function main() {
  const rpcUrl = process.env.RPC_URL_BASE;
  if (!rpcUrl) throw new Error('RPC_URL_BASE not set');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const block    = await provider.getBlockNumber();

  console.log('\n' + '='.repeat(62));
  console.log('  BASE CROSS-DEX ARB SCANNER v2.1');
  console.log('  Uniswap V3 vs Aerodrome');
  console.log('='.repeat(62));
  console.log(`  Block: ${block} | Time: ${new Date().toISOString()}`);
  console.log('='.repeat(62) + '\n');

  const LOAN_WETH = ethers.parseEther('10');   // 10 WETH = 10e18
  const LOAN_USDC = BigInt('10000000000');      // 10000 USDC = 10000e6

  let foundAny = false;

  for (const pair of ARB_PAIRS) {
    const symIn  = await getSymbol(provider, pair.tokenIn);
    const symOut = await getSymbol(provider, pair.tokenOut);

    // Tentukan loan amount berdasarkan token input
    const isUsdcIn   = pair.tokenIn.toLowerCase() === BASE.USDC.toLowerCase();
    const loanAmount = isUsdcIn ? LOAN_USDC : LOAN_WETH;
    const loanDisplay = isUsdcIn ? '10000 USDC' : '10 WETH';

    const premium   = (loanAmount * 5n) / 10000n; // 0.05% Aave premium
    const totalDebt = loanAmount + premium;

    console.log(`📊 ${pair.name} (${symIn}/${symOut})`);
    console.log(`   ${pair.description}`);

    // ─── Strategy 1: Uni → Aero ───
    const uniOut1  = await getUniQuote(provider, pair.tokenIn, pair.tokenOut, pair.uniswapFee, loanAmount);
    const aeroOut1 = uniOut1 > 0n
      ? await getAeroQuote(provider, pair.tokenOut, pair.tokenIn, pair.aerodromeStable, uniOut1)
      : 0n;

    if (uniOut1 > 0n && aeroOut1 > 0n) {
      const profit1 = aeroOut1 > totalDebt ? aeroOut1 - totalDebt : 0n;
      const pct1    = (Number(aeroOut1) / Number(loanAmount) - 1) * 100;

      // Format display sesuai decimals token
      const midDisplay = isUsdcIn
        ? (Number(uniOut1) / 1e18).toFixed(6) + ' WETH'
        : (Number(uniOut1) / 1e6).toFixed(2) + ' USDC';
      const outDisplay = isUsdcIn
        ? (Number(aeroOut1) / 1e6).toFixed(4) + ' USDC'
        : ethers.formatEther(aeroOut1) + ' WETH';
      const profitDisplay = isUsdcIn
        ? (Number(profit1) / 1e6).toFixed(4) + ' USDC'
        : ethers.formatEther(profit1) + ' WETH';

      console.log(`   [Uni→Aero] in=${loanDisplay} → mid=${midDisplay} → out=${outDisplay}`);
      console.log(`              net=${pct1 >= 0 ? '+' : ''}${pct1.toFixed(4)}% | profit=${profitDisplay} ${profit1 > 0n ? '✅ PROFITABLE!' : '❌'}`);
      if (profit1 > 0n) foundAny = true;
    } else {
      console.log(`   [Uni→Aero] ❌ quote failed`);
    }

    // ─── Strategy 2: Aero → Uni ───
    const aeroOut2 = await getAeroQuote(provider, pair.tokenIn, pair.tokenOut, pair.aerodromeStable, loanAmount);
    const uniOut2  = aeroOut2 > 0n
      ? await getUniQuote(provider, pair.tokenOut, pair.tokenIn, pair.uniswapFee, aeroOut2)
      : 0n;

    if (aeroOut2 > 0n && uniOut2 > 0n) {
      const profit2 = uniOut2 > totalDebt ? uniOut2 - totalDebt : 0n;
      const pct2    = (Number(uniOut2) / Number(loanAmount) - 1) * 100;

      const midDisplay = isUsdcIn
        ? (Number(aeroOut2) / 1e18).toFixed(6) + ' WETH'
        : (Number(aeroOut2) / 1e6).toFixed(2) + ' USDC';
      const outDisplay = isUsdcIn
        ? (Number(uniOut2) / 1e6).toFixed(4) + ' USDC'
        : ethers.formatEther(uniOut2) + ' WETH';
      const profitDisplay = isUsdcIn
        ? (Number(profit2) / 1e6).toFixed(4) + ' USDC'
        : ethers.formatEther(profit2) + ' WETH';

      console.log(`   [Aero→Uni] in=${loanDisplay} → mid=${midDisplay} → out=${outDisplay}`);
      console.log(`              net=${pct2 >= 0 ? '+' : ''}${pct2.toFixed(4)}% | profit=${profitDisplay} ${profit2 > 0n ? '✅ PROFITABLE!' : '❌'}`);
      if (profit2 > 0n) foundAny = true;
    } else {
      console.log(`   [Aero→Uni] ❌ quote failed`);
    }

    console.log('');
  }

  console.log('='.repeat(62));
  if (foundAny) {
    console.log('  🎯 OPPORTUNITIES FOUND! Run: npm run bot');
  } else {
    console.log('  No profitable opportunities right now.');
    console.log('  Market is efficient between Uniswap and Aerodrome.');
  }
  console.log('='.repeat(62) + '\n');
}

main().catch(err => { console.error(err.message); process.exit(1); });
