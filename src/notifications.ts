import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// TELEGRAM NOTIFICATIONS
// ════════════════════════════════════════════════

let _token   = '';
let _chatId  = '';
let _enabled = false;

export function initTelegram() {
  _token   = process.env.TELEGRAM_BOT_TOKEN ?? '';
  _chatId  = process.env.TELEGRAM_CHAT_ID   ?? '';
  _enabled = !!(_token && _chatId);
  if (!_enabled) logger.warn('Telegram not configured — notifications disabled');
  else logger.success('Telegram notifications enabled');
}

async function send(text: string): Promise<void> {
  if (!_enabled) return;
  try {
    await fetch(`https://api.telegram.org/bot${_token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:                  _chatId,
        text,
        parse_mode:               'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch { /* non-fatal */ }
}

export const notify = {
  started: (wallet: string, contractAddr: string, dry: boolean) =>
    send(
      `🤖 <b>Base Flashloan Arb Bot Started</b>\n\n` +
      `Wallet: <code>${wallet.slice(0, 10)}...</code>\n` +
      `Contract: <code>${contractAddr ? contractAddr.slice(0, 10) + '...' : 'NOT DEPLOYED'}</code>\n` +
      `Mode: <code>${dry ? '🟡 DRY RUN' : '🔴 LIVE'}</code>\n` +
      `Time: <code>${new Date().toISOString()}</code>`
    ),

  opportunity: (pair: string, profitEth: string, profitBps: number) =>
    send(
      `🎯 <b>ARB OPPORTUNITY</b>\n\n` +
      `Pair: <code>${pair}</code>\n` +
      `Est. Profit: <b>${profitEth} ETH</b>\n` +
      `Profit: <b>${(profitBps / 100).toFixed(3)}%</b>`
    ),

  trade: (pair: string, profitEth: string, txHash: string, dry: boolean) =>
    send(
      `💰 <b>${dry ? '[DRY RUN] ' : ''}ARB EXECUTED</b>\n\n` +
      `Pair: <code>${pair}</code>\n` +
      `Profit: <b>+${profitEth} ETH</b>\n` +
      (dry ? '' : `Tx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 18)}...</a>`)
    ),

  contractDeployed: (address: string) =>
    send(
      `✅ <b>Contract Deployed!</b>\n\n` +
      `Address: <code>${address}</code>\n` +
      `View: <a href="https://basescan.org/address/${address}">Basescan</a>\n\n` +
      `Add to .env:\n<code>ARBITRAGE_CONTRACT_ADDRESS=${address}</code>`
    ),

  profitWithdrawn: (amountEth: string) =>
    send(`💸 <b>Profit Withdrawn</b>\n\nAmount: <b>${amountEth} ETH</b>`),

  error: (msg: string) =>
    send(`❌ <b>FATAL ERROR</b>\n\n<code>${msg.slice(0, 400)}</code>\n\nBot mungkin berhenti!`),

  daily: (trades: number, netEth: number) =>
    send(
      `📊 <b>Daily Summary</b>\n\n` +
      `Trades: <code>${trades}</code>\n` +
      `Net Profit: <b>${netEth.toFixed(6)} ETH</b>`
    ),
};
