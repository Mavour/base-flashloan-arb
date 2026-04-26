import { ethers }               from 'ethers';
import { loadConfig }           from './config';
import { scanOpportunities }    from './priceMonitor';
import { executeArbitrage, withdrawProfit } from './executor';
import { recordTrade, printSummary, getDailyStats } from './tracker';
import { initTelegram, notify } from './notifications';
import { startHealthCheck, stopHealthCheck, tickRound, setMeta } from './healthcheck';
import { BASE }                 from './addresses';
import { logger }               from './utils/logger';

// ════════════════════════════════════════════════
// SESSION STATS
// ════════════════════════════════════════════════

const session = {
  startTime:      Date.now(),
  totalRounds:    0,
  totalExecuted:  0,
  totalProfitEth: 0,
  totalFailed:    0,
};

const WITHDRAW_EVERY_N = 5;

// ════════════════════════════════════════════════
// SINGLE ROUND
// ════════════════════════════════════════════════

async function runOneRound(config: ReturnType<typeof loadConfig>) {
  session.totalRounds++;
  tickRound();

  try {
    // ─── 1. Scan ───
    const opps = await scanOpportunities(config);
    if (opps.length === 0) return;

    // ─── 2. Best opportunity ───
    const best = opps[0];
    logger.info(`Best: ${best.pair.name} [${best.strategyName}] profit=${best.expectedProfitEth} ETH`);

    // ─── 3. Notify ───
    await notify.opportunity(
      `${best.pair.name} [${best.strategyName}]`,
      best.expectedProfitEth,
      best.profitBps
    );

    // ─── 4. Execute ───
    const result = await executeArbitrage(config, best);

    if (!result.success) {
      session.totalFailed++;
      logger.warn(`Failed: ${result.error}`);
      return;
    }

    session.totalExecuted++;
    session.totalProfitEth += parseFloat(result.actualProfitEth ?? '0');

    // ─── 5. Record ───
    recordTrade({
      timestamp:          new Date().toISOString(),
      pair:               `${best.pair.name} [${best.strategyName}]`,
      flashloanAmountEth: ethers.formatEther(best.flashloanAmount),
      profitEth:          result.actualProfitEth ?? '0',
      gasEth:             result.gasCostEth ?? '0',
      netProfitEth:       result.actualProfitEth ?? '0',
      profitBps:          best.profitBps,
      txHash:             result.txHash ?? 'unknown',
      isDryRun:           config.isDryRun,
    });

    // ─── 6. Telegram ───
    await notify.trade(
      `${best.pair.name} [${best.strategyName}]`,
      result.actualProfitEth ?? '0',
      result.txHash ?? '',
      config.isDryRun
    );

    // ─── 7. Auto-withdraw setiap N trades ───
    if (!config.isDryRun && session.totalExecuted % WITHDRAW_EVERY_N === 0) {
      logger.info('Auto-withdrawing profits...');
      // Withdraw semua token yang mungkin ada profit
      await withdrawProfit(config, BASE.WETH);
      await withdrawProfit(config, BASE.USDC);
    }

  } catch (err) {
    session.totalFailed++;
    logger.error('Round error', err);
  }
}

// ════════════════════════════════════════════════
// SHUTDOWN
// ════════════════════════════════════════════════

async function shutdown(config: ReturnType<typeof loadConfig>) {
  logger.header('BOT STOPPING...');
  printSummary();

  if (!config.isDryRun && config.contractAddress) {
    await withdrawProfit(config, BASE.WETH);
    await withdrawProfit(config, BASE.USDC);
  }

  const d = getDailyStats();
  await notify.daily(d.totalTrades, d.netProfitEth);
  stopHealthCheck();
  process.exit(0);
}

// ════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════

async function main() {
  logger.header('BASE CROSS-DEX FLASHLOAN ARB BOT v2.0');

  const config = loadConfig();

  logger.info(`Wallet:    ${config.walletAddress}`);
  logger.info(`Contract:  ${config.contractAddress || 'NOT DEPLOYED'}`);
  logger.info(`Mode:      ${config.isDryRun ? '🟡 DRY RUN' : '🔴 LIVE'}`);
  logger.info(`Interval:  ${config.scanIntervalMs / 1000}s`);
  logger.info(`Min profit: ${ethers.formatEther(config.minProfitEth)} ETH`);
  logger.info(`Loan size:  ${ethers.formatEther(config.flashloanAmountEth)} ETH`);

  // Balance check
  const balance = await config.provider.getBalance(config.walletAddress);
  logger.info(`ETH balance: ${ethers.formatEther(balance)} ETH`);
  if (balance < ethers.parseEther('0.005') && !config.isDryRun) {
    logger.warn('Low ETH! Need at least 0.005 ETH for gas');
  }

  initTelegram();
  startHealthCheck();
  setMeta(
    config.isDryRun ? 'DRY_RUN' : 'LIVE',
    config.walletAddress.slice(0, 10) + '...',
    config.contractAddress ? config.contractAddress.slice(0, 10) + '...' : 'not deployed'
  );

  if (!config.contractAddress) {
    logger.warn('Contract not deployed! Run: npm run compile && npm run deploy');
    logger.warn('Running in MONITOR-ONLY mode...');
  }

  if (!config.isDryRun) {
    logger.warn('⚠️  LIVE MODE — starting in 5s. Ctrl+C to abort!');
    await new Promise(r => setTimeout(r, 5000));
  } else {
    logger.warn('DRY RUN — no real transactions');
  }

  await notify.started(config.walletAddress, config.contractAddress, config.isDryRun);

  process.on('SIGINT',  () => shutdown(config));
  process.on('SIGTERM', () => shutdown(config));
  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught', err);
    await notify.error(String(err));
    await shutdown(config);
  });

  // Daily summary scheduler
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  setTimeout(async () => {
    printSummary();
    setInterval(printSummary, 24 * 60 * 60 * 1000);
  }, midnight.getTime() - now.getTime());

  logger.success('Bot v2.0 running! Scanning Uniswap vs Aerodrome...\n');

  while (true) {
    await runOneRound(config);
    await new Promise(r => setTimeout(r, config.scanIntervalMs));
  }
}

main().catch(async err => {
  logger.error('Fatal error', err);
  await notify.error(String(err));
  process.exit(1);
});
