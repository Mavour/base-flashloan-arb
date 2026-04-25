import * as fs   from 'fs';
import * as path from 'path';
import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// P&L TRACKER — simpan setiap trade ke JSON
// ════════════════════════════════════════════════

const LOGS_DIR    = path.join(process.cwd(), 'logs');
const TRADES_FILE = path.join(LOGS_DIR, 'trades.json');

export interface TradeEntry {
  id: string;
  timestamp: string;
  date: string;
  pair: string;
  flashloanAmountEth: string;
  profitEth: string;
  gasEth: string;
  netProfitEth: string;
  profitBps: number;
  txHash: string;
  isDryRun: boolean;
}

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function load(): TradeEntry[] {
  ensureDir();
  if (!fs.existsSync(TRADES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf-8')); }
  catch { return []; }
}

function save(trades: TradeEntry[]) {
  ensureDir();
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), 'utf-8');
}

export function recordTrade(entry: Omit<TradeEntry, 'id' | 'date'>): TradeEntry {
  const trades = load();
  const full: TradeEntry = {
    ...entry,
    id:   `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    date: entry.timestamp.slice(0, 10),
  };
  trades.push(full);
  save(trades);
  logger.info(`Trade recorded: ${full.id} | profit=${full.profitEth} ETH`);
  return full;
}

export function getDailyStats() {
  const today  = new Date().toISOString().slice(0, 10);
  const trades = load().filter(t => t.date === today && !t.isDryRun);
  return {
    totalTrades:    trades.length,
    totalProfitEth: trades.reduce((s, t) => s + parseFloat(t.profitEth), 0),
    totalGasEth:    trades.reduce((s, t) => s + parseFloat(t.gasEth || '0'), 0),
    netProfitEth:   trades.reduce((s, t) => s + parseFloat(t.netProfitEth), 0),
    bestProfitEth:  trades.length ? Math.max(...trades.map(t => parseFloat(t.profitEth))) : 0,
  };
}

export function getAllTimeStats() {
  const trades = load().filter(t => !t.isDryRun);
  return {
    totalTrades:  trades.length,
    netProfitEth: trades.reduce((s, t) => s + parseFloat(t.netProfitEth), 0),
    firstDate:    trades[0]?.date ?? '-',
  };
}

export function printSummary() {
  const d = getDailyStats();
  const a = getAllTimeStats();
  console.log('\n' + '='.repeat(54));
  console.log('  BASE ARB BOT — P&L SUMMARY');
  console.log('='.repeat(54));
  console.log(`  Today trades:    ${d.totalTrades}`);
  console.log(`  Today profit:    ${d.totalProfitEth.toFixed(6)} ETH`);
  console.log(`  Today gas:       ${d.totalGasEth.toFixed(6)} ETH`);
  console.log(`  Today net:       ${d.netProfitEth.toFixed(6)} ETH`);
  console.log(`  Best trade:      ${d.bestProfitEth.toFixed(6)} ETH`);
  console.log('─'.repeat(54));
  console.log(`  All-time trades: ${a.totalTrades}`);
  console.log(`  All-time net:    ${a.netProfitEth.toFixed(6)} ETH`);
  console.log(`  Since:           ${a.firstDate}`);
  console.log('='.repeat(54) + '\n');
}
