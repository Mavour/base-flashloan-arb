import { ethers } from 'ethers';
import { CONTRACT_ABI, ADDRESSES } from './addresses';
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
// SIMULATE TX — hanya untuk LIVE mode
// ════════════════════════════════════════════════

async function simulateTx(
  config: BotConfig,
  opp: ArbOpportunity
): Promise<{ success: boolean; error?: string }> {
  if (!config.contractAddress) {
    return { success: false, error: 'Contract not deployed' };
  }

  try {
    const contract = new ethers.Contract(
      config.contractAddress, CONTRACT_ABI, config.wallet
    );

    await contract.executeArbitrage.staticCall(
      opp.pair.flashloanToken,
      opp.flashloanAmount,
      opp.pair.tokenIn,
      opp.pair.tokenOut,
      opp.pair.uniswapFee,
      opp.pair.aerodromeStable ?? false,
      opp.strategy ?? opp.direction,
      opp.expectedProfit ?? 0n,
    );

    return { success: true };
  } catch (err: any) {
    const msg = err?.reason ?? err?.shortMessage ?? err?.message ?? String(err);
    return { success: false, error: msg };
  }
}

// ════════════════════════════════════════════════
// ESTIMATE GAS
// ════════════════════════════════════════════════

async function estimateGas(
  config: BotConfig,
  opp: ArbOpportunity
): Promise<bigint> {
  try {
    const contract = new ethers.Contract(
      config.contractAddress, CONTRACT_ABI, config.wallet
    );
    const gas = await contract.executeArbitrage.estimateGas(
      opp.pair.flashloanToken,
      opp.flashloanAmount,
      opp.pair.tokenIn,
      opp.pair.tokenOut,
      opp.pair.uniswapFee,
      opp.pair.aerodromeStable ?? false,
      opp.strategy ?? opp.direction,
      opp.expectedProfit ?? 0n,
    );
    return (gas * 130n) / 100n;
  } catch {
    return 600_000n;
  }
}

// ════════════════════════════════════════════════
// EXECUTE
// ════════════════════════════════════════════════

export async function executeArbitrage(
  config: BotConfig,
  opp: ArbOpportunity
): Promise<ExecutionResult> {
  // Label token untuk logging
  const tokenLabel =
    opp.pair.flashloanToken?.toLowerCase() === ADDRESSES.WETH.toLowerCase() ? 'WETH' :
    opp.pair.flashloanToken?.toLowerCase() === ADDRESSES.USDC.toLowerCase() ? 'USDC' : 'TOKEN';

  logger.info(`Executing: ${opp.pair.name} [${opp.strategyName}]`);
  logger.info(`Flashloan: ${ethers.formatEther(opp.flashloanAmount)} ${tokenLabel}`);
  logger.info(`Min profit: ${opp.expectedProfitEth} ETH`);
  logger.info(`Spread: ${(opp.profitBps / 100).toFixed(2)}%`);

  // ─── DRY RUN: skip simulation, langsung return ────────────────────────────
  if (config.isDryRun) {
    logger.info('[DRY RUN] Skipping simulation — would execute:');
    logger.info(`[DRY RUN] ${opp.pair.name} ${opp.strategyName} profit~${opp.expectedProfitEth} ETH`);

    return {
      success: true,
      txHash: 'DRY_RUN',
      actualProfitEth: opp.expectedProfitEth,
      isDryRun: true,
    };
  }

  // ─── LIVE: Simulate dulu ──────────────────────────────────────────────────
  logger.info('Simulating...');
  const sim = await simulateTx(config, opp);

  if (!sim.success) {
    logger.warn(`Sim failed: ${sim.error}`);
    return { success: false, error: `Sim failed: ${sim.error}`, isDryRun: false };
  }
  logger.success('Simulation passed!');

  // ─── Estimate gas & cek profitability ────────────────────────────────────
  const gasLimit   = await estimateGas(config, opp);
  const feeData    = await config.provider.getFeeData();
  const gasPrice   = feeData.gasPrice ?? ethers.parseUnits('0.1', 'gwei');
  const gasCostWei = gasLimit * gasPrice;

  if ((opp.expectedProfit ?? 0n) <= gasCostWei) {
    return {
      success: false,
      error: `Gas cost (${ethers.formatEther(gasCostWei)} ETH) exceeds profit`,
      isDryRun: false,
    };
  }

  // ─── LIVE TX ──────────────────────────────────────────────────────────────
  logger.warn('⚡ Sending LIVE transaction...');

  try {
    const contract = new ethers.Contract(
      config.contractAddress, CONTRACT_ABI, config.wallet
    );

    const tx = await contract.executeArbitrage(
      opp.pair.flashloanToken,
      opp.flashloanAmount,
      opp.pair.tokenIn,
      opp.pair.tokenOut,
      opp.pair.uniswapFee,
      opp.pair.aerodromeStable ?? false,
      opp.strategy ?? opp.direction,
      opp.expectedProfit ?? 0n,
      {
        gasLimit,
        maxPriorityFeePerGas: config.maxPriorityFeeGwei,
        maxFeePerGas: gasPrice + config.maxPriorityFeeGwei,
      }
    );

    logger.info(`TX sent: ${tx.hash}`);
    const receipt = await tx.wait(1);

    if (!receipt || receipt.status === 0) {
      return { success: false, error: 'TX reverted', txHash: tx.hash, isDryRun: false };
    }

    const gasCostEth = ethers.formatEther(receipt.gasUsed * receipt.gasPrice);
    logger.trade(tx.hash, opp.expectedProfitEth, false);

    return {
      success: true,
      txHash:          tx.hash,
      actualProfitEth: opp.expectedProfitEth,
      gasUsed:         receipt.gasUsed.toString(),
      gasCostEth,
      isDryRun:        false,
    };
  } catch (err: any) {
    logger.error('TX failed', err);
    return { success: false, error: err?.reason ?? String(err), isDryRun: false };
  }
}

// ════════════════════════════════════════════════
// WITHDRAW PROFIT
// ════════════════════════════════════════════════

export async function withdrawProfit(
  config: BotConfig,
  token: string
): Promise<void> {
  if (config.isDryRun || !config.contractAddress) return;

  try {
    const contract = new ethers.Contract(
      config.contractAddress, CONTRACT_ABI, config.wallet
    );

    const pending = await contract.getPendingProfit();
    if (pending === 0n) {
      logger.info(`No profit to withdraw for ${token}`);
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
