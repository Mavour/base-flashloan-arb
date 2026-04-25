import { ethers }               from 'ethers';
import { loadConfig }           from './config';
import { scanOpportunities }    from './priceMonitor';
import { executeArbitrage, withdrawProfit } from './executor';
import { recordTrade, printSummary, getDailyStats } from './tracker';
import { initTelegram, notify } from './notifications';
import { startHealthCheck, stopHealthCheck, tickRound, setMeta } from './healthcheck';
import { logger }               from './utils/logger';

// ════════════════════════════════════════════════
// SESSION STATS
// ════════════════════════════════════════════════

const session = {
  startTime:     Date.now(),
  totalRounds:   0,
  totalExecuted: 0,
  totalProfitEth: 0,
  totalFailed:   0,
};

// Auto-withdraw setiap N trades
const WITHDRAW_EVERY_N_TRADES = 10;

// ════════════════════════════════════════════════
// SINGLE ROUND
// ════════════════════════════════════════════════

async function runOneRound(config: ReturnType<typeof loadConfig>): Promise<void> {
  session.totalRounds++;
  tickRound();

  try {
    // ─── 1. Scan peluang ───
    const opportunities = await scanOpportunities(config);
    if (opportunities.length === 0) return;

    // ─── 2. Ambil yang paling profitable ───
    const best = opportunities[0];

    // ─── 3. Notify opportunity ───
    await notify.opportunity(
      best.pair.name,
      best.expectedProfitEth,
      best.profitBps
    );

    // ─── 4. Execute ───
    const result = await executeArbitrage(config, best);

    if (!result.success) {
      session.totalFailed++;
      logger.warn(`Execution failed: ${result.error}`);
      return;
    }

    session.totalExecuted++;
    session.totalProfitEth += parseFloat(result.actualProfitEth ?? '0');

    // ─── 5. Record trade ───
    recordTrade({
      timestamp:          new Date().toISOString(),
      pair:               best.pair.name,
      flashloanAmountEth: ethers.formatEther(best.flashloanAmount),
      profitEth:          result.actualProfitEth ?? '0',
      gasEth:             result.gasCostEth ?? '0',
      netProfitEth:       result.actualProfitEth ?? '0',
      profitBps:          best.profitBps,
      txHash:             result.txHash ?? 'unknown',
      isDryRun:           config.isDryRun,
    });

    // ─── 6. Telegram notif ───
    await notify.trade(
      best.pair.name,
      result.actualProfitEth ?? '0',
      result.txHash ?? '',
      config.isDryRun
    );

    // ─── 7. Auto-withdraw setiap N trades ───
    if (!config.isDryRun && session.totalExecuted % WITHDRAW_EVERY_N_TRADES === 0) {
      logger.info(`Auto-withdrawing profit after ${WITHDRAW_EVERY_N_TRADES} trades...`);
      await withdrawProfit(config);
    }

  } catch (err) {
    session.totalFailed++;
    logger.error('Round error', err);
  }
}

// ════════════════════════════════════════════════
// SHUTDOWN
// ════════════════════════════════════════════════

async function shutdown(config: ReturnType<typeof loadConfig>): Promise<void> {
  logger.header('BOT STOPPING...');
  printSummary();

  // Withdraw profit sebelum shutdown (kalau live)
  if (!config.isDryRun && config.contractAddress) {
    await withdrawProfit(config);
  }

  const d = getDailyStats();
  await notify.daily(d.totalTrades, d.netProfitEth);
  stopHealthCheck();
  process.exit(0);
}

// ════════════════════════════════════════════════
// DAILY SCHEDULER
// ════════════════════════════════════════════════

function scheduleDailySummary(config: ReturnType<typeof loadConfig>): void {
  const now      = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const msUntil  = midnight.getTime() - now.getTime();

  setTimeout(async () => {
    printSummary();
    const d = getDailyStats();
    await notify.daily(d.totalTrades, d.netProfitEth);

    setInterval(async () => {
      printSummary();
      const d2 = getDailyStats();
      await notify.daily(d2.totalTrades, d2.netProfitEth);
    }, 24 * 60 * 60 * 1000);
  }, msUntil);

  logger.info(`Daily summary in ${Math.floor(msUntil / 3600000)}h`);
}

// ════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════

async function main(): Promise<void> {
  logger.header('BASE FLASHLOAN ARB BOT v1.0');

  const config = loadConfig();

  // ─── Print config ───
  logger.info(`Wallet:    ${config.walletAddress}`);
  logger.info(`Contract:  ${config.contractAddress || 'NOT DEPLOYED YET'}`);
  logger.info(`Mode:      ${config.isDryRun ? '🟡 DRY RUN' : '🔴 LIVE'}`);
  logger.info(`Interval:  ${config.scanIntervalMs / 1000}s`);
  logger.info(`Min profit: ${ethers.formatEther(config.minProfitEth)} ETH`);
  logger.info(`Loan size:  ${ethers.formatEther(config.flashloanAmountEth)} ETH`);

  // ─── Cek ETH balance ───
  const balance = await config.provider.getBalance(config.walletAddress);
  logger.info(`ETH balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther('0.005') && !config.isDryRun) {
    logger.warn('Low ETH balance! Need at least 0.005 ETH for gas');
  }

  // ─── Init services ───
  initTelegram();
  startHealthCheck();
  setMeta(
    config.isDryRun ? 'DRY_RUN' : 'LIVE',
    config.walletAddress.slice(0, 10) + '...',
    config.contractAddress ? config.contractAddress.slice(0, 10) + '...' : 'not deployed'
  );

  // ─── Warning untuk contract yang belum deploy ───
  if (!config.contractAddress) {
    logger.warn('Contract not deployed yet!');
    logger.warn('Run: npm run compile && npm run deploy');
    logger.warn('Then add ARBITRAGE_CONTRACT_ADDRESS to .env');
    logger.warn('Continuing in MONITOR-ONLY mode (will not execute)...');
  }

  // ─── Safety delay untuk LIVE ───
  if (!config.isDryRun) {
    logger.warn('⚠️  LIVE MODE — starting in 5s. Ctrl+C to abort!');
    await new Promise(r => setTimeout(r, 5000));
  } else {
    logger.warn('DRY RUN — no real transactions');
  }

  // ─── Notify start ───
  await notify.started(
    config.walletAddress,
    config.contractAddress,
    config.isDryRun
  );

  // ─── Signal handlers ───
  process.on('SIGINT',  () => shutdown(config));
  process.on('SIGTERM', () => shutdown(config));
  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception', err);
    await notify.error(String(err));
    await shutdown(config);
  });

  // ─── Daily scheduler ───
  scheduleDailySummary(config);

  // ════════════════════
  //  MAIN LOOP
  // ════════════════════
  logger.success('Bot running! Scanning Base network...\n');

  while (true) {
    await runOneRound(config);
    await new Promise(r => setTimeout(r, config.scanIntervalMs));
  }
}

main().catch(async err => {
  logger.error('Fatal startup error', err);
  await notify.error(String(err));
  process.exit(1);
});
