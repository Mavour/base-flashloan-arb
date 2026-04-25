import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
dotenv.config();

export interface BotConfig {
  wallet: ethers.Wallet;
  walletAddress: string;
  provider: ethers.JsonRpcProvider;
  contractAddress: string;
  scanIntervalMs: number;
  minProfitEth: bigint;
  flashloanAmountEth: bigint;
  maxPriorityFeeGwei: bigint;
  isDryRun: boolean;
}

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function opt(key: string, def: string): string {
  return process.env[key] ?? def;
}

export function loadConfig(): BotConfig {
  console.log('Loading config...');

  const provider = new ethers.JsonRpcProvider(req('RPC_URL_BASE'));
  const wallet   = new ethers.Wallet(req('WALLET_PRIVATE_KEY'), provider);

  const contractAddress = opt('ARBITRAGE_CONTRACT_ADDRESS', '');
  if (!contractAddress && opt('DRY_RUN', 'true') !== 'true') {
    throw new Error('ARBITRAGE_CONTRACT_ADDRESS required for live mode. Run: npm run deploy');
  }

  return {
    wallet,
    walletAddress:      wallet.address,
    provider,
    contractAddress,
    scanIntervalMs:     parseInt(opt('SCAN_INTERVAL_MS', '2000')),
    minProfitEth:       ethers.parseEther(opt('MIN_PROFIT_ETH', '0.0005')),
    flashloanAmountEth: ethers.parseEther(opt('FLASHLOAN_AMOUNT_ETH', '10')),
    maxPriorityFeeGwei: ethers.parseUnits(opt('MAX_PRIORITY_FEE_GWEI', '0.1'), 'gwei'),
    isDryRun:           opt('DRY_RUN', 'true') === 'true',
  };
}
