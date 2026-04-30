// src/addresses.ts

// ─── Contract ABI (dipakai executor.ts) ──────────────────────────────────────
export const CONTRACT_ABI = [
  'function executeArbitrage(address flashloanToken, uint256 flashloanAmount, address tokenIn, address tokenOut, uint24 uniswapFee, bool aerodromeStable, string strategy, uint256 minProfit) external',
  'function getPendingProfit() view returns (uint256)',
  'function withdrawProfit() external',
  'function withdrawToken(address token) external',
  'function owner() view returns (address)',
];

// ─── Quoter V2 ABI (dipakai checkOpportunity.ts) ─────────────────────────────
export const QUOTER_V2_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

// ─── Aerodrome Router ABI ─────────────────────────────────────────────────────
export const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) external returns (uint256[] amounts)',
];

// ─── ERC20 ABI ────────────────────────────────────────────────────────────────
export const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

// ─── Addresses ────────────────────────────────────────────────────────────────
export const ADDRESSES = {
  // Aave V3 Base
  AAVE_POOL:              '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  AAVE_POOL_DATA_PROVIDER:'0x2d8A3C5677189723C4cB8873CfC9C8976dfe4C',

  // Tokens
  WETH:  '0x4200000000000000000000000000000000000006',
  USDC:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  DAI:   '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  DEGEN: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',

  // Uniswap V3 on Base
  UNISWAP_V3_QUOTER:  '0x3d4e44Eb1374240CE5F1B136041D2E09F4EB756c',
  QUOTER_V2:          '0x3d4e44Eb1374240CE5F1B136041D2E09F4EB756c',
  UNISWAP_V3_ROUTER:  '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNISWAP_V3_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',

  // Aerodrome (Base native DEX)
  AERODROME_ROUTER:  '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  AERODROME_QUOTER:  '0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0',
};

// ─── BASE alias (dipakai checkOpportunity.ts) ─────────────────────────────────
export const BASE = {
  ...ADDRESSES,
};

// ─── Pairs yang akan di-scan ──────────────────────────────────────────────────
export const ARB_PAIRS = [
  {
    name:            'WETH/USDC',
    description:     'Buy WETH on cheaper DEX, sell on more expensive DEX',
    tokenIn:         ADDRESSES.WETH,
    tokenOut:        ADDRESSES.USDC,
    uniswapFee:      500,
    decimalsIn:      18,
    decimalsOut:     6,
    flashloanToken:  ADDRESSES.WETH,
    flashloanAmount: '1',
    aerodromeStable: false,
  },
  {
    name:            'USDC/WETH',
    description:     'Buy USDC on cheaper DEX, sell on more expensive DEX',
    tokenIn:         ADDRESSES.USDC,
    tokenOut:        ADDRESSES.WETH,
    uniswapFee:      500,
    decimalsIn:      6,
    decimalsOut:     18,
    flashloanToken:  ADDRESSES.USDC,
    flashloanAmount: '2500',
    aerodromeStable: false,
  },
  {
    name:            'cbETH/WETH',
    description:     'Buy cbETH on Aerodrome, sell on Uniswap (LST spread)',
    tokenIn:         ADDRESSES.cbETH,
    tokenOut:        ADDRESSES.WETH,
    uniswapFee:      100,
    decimalsIn:      18,
    decimalsOut:     18,
    flashloanToken:  ADDRESSES.WETH,
    flashloanAmount: '1',
    aerodromeStable: false,
  },
];
