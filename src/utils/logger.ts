const C: Record<string, string> = {
  reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m',
  cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m',
};

const ts  = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const c   = (col: string, txt: string) => `${C[col]}${txt}${C.reset}`;

export const logger = {
  info: (msg: string) =>
    console.log(`${c('dim', ts())} ${c('cyan', 'i')} ${msg}`),

  success: (msg: string) =>
    console.log(`${c('dim', ts())} ${c('green', 'OK')} ${c('green', msg)}`),

  warn: (msg: string) =>
    console.log(`${c('dim', ts())} ${c('yellow', '!!')} ${c('yellow', msg)}`),

  error: (msg: string, err?: unknown) => {
    console.error(`${c('dim', ts())} ${c('red', 'ERR')} ${c('red', msg)}`);
    if (err) console.error(err);
  },

  header: (msg: string) => {
    console.log(`\n${c('bold', c('magenta', '='.repeat(54)))}`);
    console.log(`${c('bold', c('magenta', `  ${msg}`))}`);
    console.log(`${c('bold', c('magenta', '='.repeat(54)))}\n`);
  },

  opportunity: (pair: string, profitEth: number, profitPct: number) =>
    console.log(
      `${c('dim', ts())} ${c('yellow', '🎯 ARB')} ` +
      `${c('cyan', pair)} ` +
      `profit=${c('green', profitEth.toFixed(6) + ' ETH')} ` +
      `(${c('green', profitPct.toFixed(3) + '%')})`
    ),

  trade: (tx: string, profitEth: string, dry: boolean) =>
    console.log(
      `${c('dim', ts())} ${c('green', '💰 EXECUTED')} ` +
      `${dry ? c('yellow', '[DRY RUN]') : c('green', '[LIVE]')} ` +
      `tx=${c('cyan', tx.slice(0, 18) + '...')} ` +
      `profit=${c('green', profitEth + ' ETH')}`
    ),

  scan: (pairs: number, opps: number) =>
  console.log(
    `${c('dim', ts())} ${c('blue', 'SCAN')} ` +
    `pairs=${c('white', String(pairs))} ` +
    `opportunities=${c(opps > 0 ? 'yellow' : 'white', String(opps))}`
    ),
};
