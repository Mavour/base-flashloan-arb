import { ethers } from 'hardhat';

async function main() {
  console.log('Deploying FlashloanArbitrage to Base...');

  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  if (balance < ethers.parseEther('0.001')) {
    throw new Error('Insufficient ETH for deployment! Need at least 0.001 ETH');
  }

  // Deploy contract
  const Factory = await ethers.getContractFactory('FlashloanArbitrage');
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('\n✅ FlashloanArbitrage deployed to:', address);
  console.log('\nAdd this to your .env:');
  console.log(`ARBITRAGE_CONTRACT_ADDRESS=${address}`);
  console.log('\nVerify on Basescan:');
  console.log(`npx hardhat verify --network base ${address}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
