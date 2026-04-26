import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config();

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL_BASE!);
const FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
const ABI = ['function getPool(address,address,uint24) view returns (address)'];

const WETH  = '0x4200000000000000000000000000000000000006';
const USDC  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const CBETH = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22';
const CBBTC = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';

async function check(tA: string, tB: string, fee: number, name: string) {
  const f = new ethers.Contract(FACTORY, ABI, provider);
  const pool = await f.getPool(tA, tB, fee);
  const exists = pool !== ethers.ZeroAddress;
  console.log(`${exists ? '✅' : '❌'} ${name} fee=${fee}: ${exists ? pool.slice(0,20)+'...' : 'NOT FOUND'}`);
}

async function main() {
  console.log('Checking Uniswap V3 pools on Base...\n');
  await check(WETH, USDC,  100,  'WETH/USDC');
  await check(WETH, USDC,  500,  'WETH/USDC');
  await check(WETH, USDC,  3000, 'WETH/USDC');
  await check(WETH, CBETH, 500,  'WETH/cbETH');
  await check(WETH, CBETH, 3000, 'WETH/cbETH');
  await check(WETH, CBBTC, 500,  'WETH/cbBTC');
  await check(WETH, CBBTC, 3000, 'WETH/cbBTC');
}

main().catch(console.error);