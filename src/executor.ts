import { ethers } from 'ethers';
import { CONTRACT_ABI } from './addresses';
import { BotConfig } from './config';
import { ArbOpportunity } from './priceMonitor';
import { logger } from './utils/logger';

// ════════════════════════════════════════════════
// TIPE DATA
// ════════════════════════════════════════════════

export interface ExecutionResult {
  success: boolean;
  txHash?: string;
  actualProfitEth?: string;
  gasUsed?: string;
  gasCostEth?: string;
  error?: string;
  isDryRun: boolean;
}

// ════════════════════════════════════════════════
// SIMULATE TX (eth_call)
// ════════════════════════════════════════════════

/**
 * Simulate transaksi sebelum kirim.
 * Kalau gagal di sini → tidak buang gas.
 */
async function simulateTx(
  config: BotConfig,
  opportunity: ArbOpportunity
): Promise<{ success: boolean; error?: string }> {
  // Kalau contract belum deploy, skip simulation
  if (!config.contractAddress) {
    return { success: false, error: 'Contract not deployed yet' };
  }

  try {
    const contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      config.wallet
    );

    await contract.executeArbitrage.staticCall(
      opportunity.flashloanAmount,
      opportunity.expectedProfit,
    );

    return { success: true };
  } catch (err: any) {
    const msg = err?.reason ?? err?.message ?? String(err);
    return { success: false, error: msg };
  }
}

// ════════════════════════════════════════════════
// ESTIMATE GAS
// ════════════════════════════════════════════════

async function estimateGas(
  config: BotConfig,
  opportunity: ArbOpportunity
): Promise<bigint> {
  try {
    const contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      config.wallet
    );

    const gas = await contract.executeArbitrage.estimateGas(
      opportunity.flashloanAmount,
      opportunity.expectedProfit,
    );

    // Tambah 20% buffer untuk safety
    return (gas * 120n) / 100n;
  } catch {
    return 500_000n; // fallback estimate
  }
}

// ════════════════════════════════════════════════
// EXECUTE ARBITRAGE
// ════════════════════════════════════════════════

export async function executeArbitrage(
  config: BotConfig,
  opportunity: ArbOpportunity
): Promise<ExecutionResult> {
  logger.info(`Executing: ${opportunity.pair.name}`);
  logger.info(`Flashloan: ${ethers.formatEther(opportunity.flashloanAmount)} ETH`);
  logger.info(`Min profit: ${opportunity.expectedProfitEth} ETH`);

  // ─── 1. Simulate dulu ───
  logger.info('Simulating transaction...');
  const sim = await simulateTx(config, opportunity);

  if (!sim.success) {
    logger.warn(`Simulation failed: ${sim.error}`);
    return {
      success: false,
      error: `Simulation failed: ${sim.error}`,
      isDryRun: config.isDryRun,
    };
  }
  logger.success('Simulation passed!');

  // ─── 2. DRY RUN stop di sini ───
  if (config.isDryRun) {
    logger.trade('DRY_RUN_TX', opportunity.expectedProfitEth, true);
    return {
      success: true,
      txHash: 'DRY_RUN',
      actualProfitEth: opportunity.expectedProfitEth,
      isDryRun: true,
    };
  }

  // ─── 3. Estimate gas ───
  const gasLimit    = await estimateGas(config, opportunity);
  const feeData     = await config.provider.getFeeData();
  const gasPrice    = feeData.gasPrice ?? ethers.parseUnits('0.1', 'gwei');
  const gasCostWei  = gasLimit * gasPrice;
  const gasCostEth  = ethers.formatEther(gasCostWei);

  logger.info(`Gas estimate: ${gasLimit} units (~${gasCostEth} ETH)`);

  // ─── 4. Cek profit masih worth it setelah gas ───
  const netAfterGas = opportunity.expectedProfit - gasCostWei;
  if (netAfterGas <= 0n) {
    return {
      success: false,
      error: `Gas cost (${gasCostEth} ETH) exceeds profit (${opportunity.expectedProfitEth} ETH)`,
      isDryRun: false,
    };
  }

  // ─── 5. LIVE: Kirim transaksi ───
  logger.warn('⚡ Sending LIVE transaction...');

  try {
    const contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      config.wallet
    );

    const tx = await contract.executeArbitrage(
      opportunity.flashloanAmount,
      opportunity.expectedProfit,
      {
        gasLimit,
        maxPriorityFeePerGas: config.maxPriorityFeeGwei,
        maxFeePerGas: gasPrice + config.maxPriorityFeeGwei,
      }
    );

    logger.info(`TX sent: ${tx.hash}`);
    logger.info('Waiting for confirmation...');

    const receipt = await tx.wait(1); // tunggu 1 konfirmasi

    if (!receipt || receipt.status === 0) {
      return {
        success: false,
        error: 'Transaction reverted on-chain',
        txHash: tx.hash,
        isDryRun: false,
      };
    }

    const actualGasCost = ethers.formatEther(
      receipt.gasUsed * receipt.gasPrice
    );

    logger.trade(tx.hash, opportunity.expectedProfitEth, false);

    return {
      success: true,
      txHash:          tx.hash,
      actualProfitEth: opportunity.expectedProfitEth,
      gasUsed:         receipt.gasUsed.toString(),
      gasCostEth:      actualGasCost,
      isDryRun:        false,
    };

  } catch (err: any) {
    logger.error('TX failed', err);
    return {
      success: false,
      error: err?.reason ?? String(err),
      isDryRun: false,
    };
  }
}

// ════════════════════════════════════════════════
// WITHDRAW PROFIT FROM CONTRACT
// ════════════════════════════════════════════════

/**
 * Withdraw accumulated profit dari contract ke wallet owner.
 * Dipanggil manual atau otomatis setelah N trades.
 */
export async function withdrawProfit(config: BotConfig): Promise<void> {
  if (config.isDryRun || !config.contractAddress) return;

  try {
    const contract = new ethers.Contract(
      config.contractAddress,
      CONTRACT_ABI,
      config.wallet
    );

    const pending = await contract.getPendingProfit();
    if (pending === 0n) {
      logger.info('No profit to withdraw');
      return;
    }

    logger.info(`Withdrawing ${ethers.formatEther(pending)} ETH from contract...`);
    const tx = await contract.withdrawProfit();
    await tx.wait(1);
    logger.success(`Withdrawn! TX: ${tx.hash}`);
  } catch (err) {
    logger.error('Withdraw failed', err);
  }
}
