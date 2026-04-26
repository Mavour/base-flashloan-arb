import { expect }        from 'chai';
import { ethers }        from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

const WETH_ADDRESS  = '0x4200000000000000000000000000000000000006';
const USDC_ADDRESS  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AAVE_POOL     = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

describe('FlashloanArbitrage v2', () => {
  let contract: any;
  let owner: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  beforeEach(async () => {
    [owner, attacker] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('FlashloanArbitrage');
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  describe('Deployment', () => {
    it('should set correct owner', async () => {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it('should have correct AAVE_POOL address', async () => {
      expect(await contract.AAVE_POOL()).to.equal(AAVE_POOL);
    });

    it('should have correct AERODROME_ROUTER', async () => {
      expect(await contract.AERODROME_ROUTER()).to.not.equal(ethers.ZeroAddress);
    });

    it('should have correct UNISWAP_ROUTER', async () => {
      expect(await contract.UNISWAP_ROUTER()).to.not.equal(ethers.ZeroAddress);
    });

    it('should return zero pending profit', async () => {
      expect(await contract.getPendingProfit(WETH_ADDRESS)).to.equal(0n);
    });

    it('should have correct strategy constants', async () => {
      expect(await contract.STRATEGY_UNI_TO_AERO()).to.equal(1n);
      expect(await contract.STRATEGY_AERO_TO_UNI()).to.equal(2n);
    });
  });

  describe('Access Control', () => {
    it('should revert executeArbitrage if not owner', async () => {
      await expect(
        contract.connect(attacker).executeArbitrage(
          WETH_ADDRESS, ethers.parseEther('1'), USDC_ADDRESS,
          500, false, 1, ethers.parseEther('0.001')
        )
      ).to.be.revertedWith('Not owner');
    });

    it('should revert withdrawToken if not owner', async () => {
      await expect(
        contract.connect(attacker).withdrawToken(WETH_ADDRESS)
      ).to.be.revertedWith('Not owner');
    });

    it('should revert executeOperation if not called by Aave', async () => {
      await expect(
        contract.executeOperation(
          [WETH_ADDRESS], [ethers.parseEther('10')],
          [ethers.parseEther('0.005')], owner.address, '0x'
        )
      ).to.be.revertedWith('Caller not Aave');
    });
  });

  describe('Withdraw', () => {
    it('should revert withdrawToken if no balance', async () => {
      await expect(contract.withdrawToken(WETH_ADDRESS)).to.be.reverted;
    });
  });

  describe('ETH Receive', () => {
    it('should accept ETH transfers', async () => {
      const addr = await contract.getAddress();
      await owner.sendTransaction({ to: addr, value: ethers.parseEther('0.01') });
      expect(await ethers.provider.getBalance(addr)).to.equal(ethers.parseEther('0.01'));
    });
  });
});
