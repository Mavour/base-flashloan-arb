import { ethers }   from 'hardhat';
import * as dotenv  from 'dotenv';
dotenv.config();

// ════════════════════════════════════════════════
// SCRIPT: WITHDRAW PROFIT
//
// Cara run:
//   npx hardhat run scripts/withdraw.ts --network base
//
// Fungsi:
// - Cek berapa profit yang ada di contract
// - Withdraw semua ke wallet owner
// ════════════════════════════════════════════════

const CONTRACT_ABI = [
  'function getPendingProfit() view returns (uint256)',
  'function withdrawProfit() external',
  'function withdrawToken(address token) external',
  'function owner() view returns (address)',
];

const WETH = '0x4200000000000000000000000000000000000006';

async function main() {
  const contractAddress = process.env.ARBITRAGE_CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error('ARBITRAGE_CONTRACT_ADDRESS not set in .env');
  }

  const [signer] = await ethers.getSigners();
  console.log('Wallet:', signer.address);

  const contract = new ethers.Contract(contractAddress, CONTRACT_ABI, signer);

  // ─── Cek owner ───
  const owner = await contract.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`You are not the owner! Owner is: ${owner}`);
  }

  // ─── Cek pending profit ───
  const pending = await contract.getPendingProfit();
  console.log(`\nPending profit: ${ethers.formatEther(pending)} ETH`);

  if (pending === 0n) {
    console.log('No profit to withdraw yet.');
    return;
  }

  // ─── Konfirmasi ───
  console.log(`\nWithdrawing ${ethers.formatEther(pending)} ETH to ${signer.address}...`);

  const tx = await contract.withdrawProfit();
  console.log(`TX sent: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait(1);
  console.log(`\n✅ Withdrawn successfully!`);
  console.log(`Gas used: ${receipt.gasUsed}`);
  console.log(`View on Basescan: https://basescan.org/tx/${tx.hash}`);

  // ─── Cek balance wallet setelah withdraw ───
  const wethAbi    = ['function balanceOf(address) view returns (uint256)'];
  const wethContract = new ethers.Contract(WETH, wethAbi, signer);
  const wethBalance  = await wethContract.balanceOf(signer.address);
  console.log(`\nWallet WETH balance: ${ethers.formatEther(wethBalance)} WETH`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
