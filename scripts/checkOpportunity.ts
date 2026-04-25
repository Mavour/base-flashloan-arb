import { ethers }  from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

// ════════════════════════════════════════════════
// SCRIPT: CHECK OPPORTUNITY
//
// Cara run:
//   npx tsx scripts/checkOpportunity.ts
//
// Fungsi:
// - Scan semua pairs sekarang
// - Tampilkan harga Uniswap vs Aave
// - Hitung estimasi profit kalau ada
// - Berguna untuk debug sebelum jalankan full bot
// ════════════════════════════════════════════════

import { BASE, ARB_PAIRS } from '../src/addresses';

const UNISWAP_FACTORY_ABI = [
  'function getPool(address, address, uint24) view returns (address)',
];
const UNISWAP_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
];
const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// Aave flashloan premium = 0.09%
const AAVE_PREMIUM = 0.0009;

async function getPoolPrice(
  provider: ethers.JsonRpcProvider,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<{ price: number; poolAddress: string; liquidity: string } | null> {
  try {
    const factory = new ethers.Contract(BASE.UNISWAP_FACTORY, UNISWAP_FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);

    if (poolAddress === ethers.ZeroAddress) return null;

    const pool = new ethers.Contract(poolAddress, UNISWAP_POOL_ABI, provider);
    const [slot0, liquidity] = await Promise.all([pool.slot0(), pool.liquidity()]);

    const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
    const Q96          = 2n ** 96n;
    const priceRatio   = Number(sqrtPriceX96 * sqrtPriceX96) / Number(Q96 * Q96);

    const tokenAContract = new ethers.Contract(tokenA, ERC20_ABI, provider);
    const tokenBContract = new ethers.Contract(tokenB, ERC20_ABI, provider);
    const [decA, decB]   = await Promise.all([
      tokenAContract.decimals(),
      tokenBContract.decimals(),
    ]);

    const adjustedPrice = priceRatio * Math.pow(10, Number(decA) - Number(decB));

    return {
      price: adjustedPrice,
      poolAddress,
      liquidity: ethers.formatEther(liquidity),
    };
  } catch (err) {
    return null;
  }
}

async function main() {
  const rpcUrl = process.env.RPC_URL_BASE;
  if (!rpcUrl) throw new Error('RPC_URL_BASE not set in .env');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const block    = await provider.getBlockNumber();

  console.log('\n' + '='.repeat(60));
  console.log('  BASE ARB OPPORTUNITY SCANNER');
  console.log('='.repeat(60));
  console.log(`  Block: ${block}`);
  console.log(`  Time:  ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');

  const FLASHLOAN_ETH = parseFloat(process.env.FLASHLOAN_AMOUNT_ETH ?? '10');

  for (const pair of ARB_PAIRS) {
    console.log(`\n📊 ${pair.name}`);
    console.log(`   ${pair.description}`);

    const result = await getPoolPrice(
      provider,
      pair.flashloanToken,
      pair.marketToken,
      pair.poolFee
    );

    if (!result) {
      console.log(`   ❌ Pool not found`);
      continue;
    }

    const { price, poolAddress, liquidity } = result;

    // Kalau price > 1 → kita dapat lebih aToken per WETH → ada peluang
    const hasOpportunity = price > 1.0;
    const aavePrice      = 1.0;
    const priceDiff      = ((price - aavePrice) / aavePrice) * 100;

    console.log(`   Pool:        ${poolAddress.slice(0, 20)}...`);
    console.log(`   Market price: ${price.toFixed(8)} (${priceDiff > 0 ? '+' : ''}${priceDiff.toFixed(4)}%)`);
    console.log(`   Aave price:   ${aavePrice.toFixed(8)} (redeem 1:1)`);
    console.log(`   Liquidity:    ${parseFloat(liquidity).toFixed(2)} ETH equivalent`);

    if (hasOpportunity) {
      // Hitung estimasi profit
      const grossProfitPct = price - aavePrice;
      const premiumPct     = AAVE_PREMIUM;
      const netProfitPct   = grossProfitPct - premiumPct;

      const grossProfitEth = FLASHLOAN_ETH * grossProfitPct;
      const premiumEth     = FLASHLOAN_ETH * premiumPct;
      const netProfitEth   = FLASHLOAN_ETH * netProfitPct;
      const gasEstEth      = 0.00005; // ~$0.12 di Base

      console.log(`\n   🎯 OPPORTUNITY DETECTED!`);
      console.log(`   Flashloan:    ${FLASHLOAN_ETH} ETH`);
      console.log(`   Gross profit: ${grossProfitEth.toFixed(6)} ETH`);
      console.log(`   Premium:     -${premiumEth.toFixed(6)} ETH (0.09% Aave)`);
      console.log(`   Gas est:     -${gasEstEth.toFixed(6)} ETH`);
      console.log(`   NET PROFIT:   ${(netProfitEth - gasEstEth).toFixed(6)} ETH`);

      if (netProfitEth - gasEstEth > 0) {
        console.log(`   ✅ PROFITABLE — worth executing!`);
      } else {
        console.log(`   ⚠️  Not profitable after costs`);
      }
    } else {
      console.log(`   ℹ️  No arb opportunity (market price ≤ Aave price)`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  Scan complete!');
  console.log('='.repeat(60) + '\n');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
