import * as http from 'http';
import { getDailyStats, getAllTimeStats } from './tracker';
import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// HEALTH CHECK SERVER
// ════════════════════════════════════════════════

let _uptime   = 0;
let _rounds   = 0;
let _lastScan = new Date().toISOString();
let _mode     = 'unknown';
let _wallet   = 'unknown';
let _contract = 'not deployed';
let _server: http.Server | null = null;

export function tickRound() {
  _rounds++;
  _lastScan = new Date().toISOString();
}

export function setMeta(mode: string, wallet: string, contract: string) {
  _mode = mode; _wallet = wallet; _contract = contract;
}

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function startHealthCheck(): void {
  const port = parseInt(process.env.HEALTHCHECK_PORT ?? '3001');

  _server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/ping') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }

    const today   = getDailyStats();
    const allTime = getAllTimeStats();

    res.writeHead(200);
    res.end(JSON.stringify({
      status:        'running',
      network:       'Base Mainnet',
      uptime:        fmt(_uptime),
      uptimeSeconds: _uptime,
      currentRound:  _rounds,
      lastScanAt:    _lastScan,
      mode:          _mode,
      wallet:        _wallet,
      contract:      _contract,
      today: {
        trades:      today.totalTrades,
        profitEth:   today.totalProfitEth.toFixed(6),
        gasEth:      today.totalGasEth.toFixed(6),
        netProfitEth: today.netProfitEth.toFixed(6),
      },
      allTime: {
        trades:      allTime.totalTrades,
        netProfitEth: allTime.netProfitEth.toFixed(6),
      },
    }, null, 2));
  });

  _server.listen(port, () => {
    logger.success(`Health check: http://localhost:${port}`);
  });

  _server.on('error', err => {
    logger.warn(`Health check error (non-fatal): ${err.message}`);
  });

  // Update uptime setiap detik
  setInterval(() => { _uptime++; }, 1000);
}

export function stopHealthCheck(): void {
  _server?.close();
}
