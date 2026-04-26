// ════════════════════════════════════════════════
// BASE NETWORK ADDRESSES & CONSTANTS
// ════════════════════════════════════════════════

export const BASE = {
  // ─── Core Protocols ───
  AAVE_POOL:        '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  UNISWAP_ROUTER:   '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNISWAP_FACTORY:  '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  AERODROME_ROUTER: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
  AERODROME_FACTORY:'0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
  QUOTER_V2:        '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',

  // ─── Token Addresses ───
  WETH:   '0x4200000000000000000000000000000000000006',
  USDC:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDBC:  '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  CBETH:  '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  CBBTC:  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
  WSTETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  DAI:    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',

  // ─── Uniswap Fee Tiers ───
  FEE: {
    LOWEST: 100,   // 0.01%
    LOW:    500,   // 0.05%
    MEDIUM: 3000,  // 0.3%
    HIGH:   10000, // 1%
  },
};

// ════════════════════════════════════════════════
// CROSS-DEX ARB PAIRS
// ════════════════════════════════════════════════

export interface ArbPair {
  name: string;
  tokenIn: string;          // Token flashloan (WETH atau USDC)
  tokenOut: string;         // Token intermediate
  uniswapFee: number;       // Fee tier Uniswap
  aerodromeStable: boolean; // Pool stable atau volatile di Aerodrome
  flashloanAmountOverride?: string; // Override flashloan amount (optional)
  description: string;
}

export const ARB_PAIRS: ArbPair[] = [
  {
    name:            'WETH/USDC',
    tokenIn:         BASE.WETH,
    tokenOut:        BASE.USDC,
    uniswapFee:      BASE.FEE.LOWEST,  // 100 = 0.01%
    aerodromeStable: false,
    description:     'Cross-DEX: WETH/USDC antara Uniswap dan Aerodrome',
  },
  {
    name:            'USDC/WETH',
    tokenIn:         BASE.USDC,
    tokenOut:        BASE.WETH,
    uniswapFee:      BASE.FEE.LOWEST,  // 100 = 0.01%
    aerodromeStable: false,
    description:     'Cross-DEX: USDC/WETH antara Uniswap dan Aerodrome',
  },
  {
    name:            'WETH/cbETH',
    tokenIn:         BASE.WETH,
    tokenOut:        BASE.CBETH,
    uniswapFee:      BASE.FEE.LOW,     // 500 = 0.05%
    aerodromeStable: false,
    description:     'Cross-DEX: WETH/cbETH antara Uniswap dan Aerodrome',
  },
  {
    name:            'WETH/cbBTC',
    tokenIn:         BASE.WETH,
    tokenOut:        BASE.CBBTC,
    uniswapFee:      BASE.FEE.LOW,     // 500 = 0.05%
    aerodromeStable: false,
    description:     'Cross-DEX: WETH/cbBTC (aktif karena CEX/DEX arb)',
  },
  {
    name:            'USDC/USDbC',
    tokenIn:         BASE.USDC,
    tokenOut:        BASE.USDBC,
    uniswapFee:      BASE.FEE.LOWEST,  // 100 = 0.01%
    aerodromeStable: true,
    description:     'Stablecoin arb: USDC vs USDbC',
  },
];

// ABIs
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address, uint256) returns (bool)',
];

export const UNISWAP_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

export const UNISWAP_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
];

export const AERODROME_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) view returns (address)',
];

export const AERODROME_POOL_ABI = [
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function stable() view returns (bool)',
];

export const AERODROME_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, tuple(address from, address to, bool stable, address factory)[] routes) view returns (uint256[] amounts)',
];

export const QUOTER_V2_ABI = [
  'function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
];

export const CONTRACT_ABI = [
  'function executeArbitrage(address flashloanToken, uint256 flashloanAmount, address tokenOut, uint24 uniswapFee, bool isStablePool, uint8 strategy, uint256 minProfit) external',
  'function withdrawToken(address token) external',
  'function getPendingProfit(address token) view returns (uint256)',
  'event ArbitrageExecuted(address indexed tokenIn, address indexed tokenOut, uint8 strategy, uint256 flashloanAmount, uint256 profit, uint256 timestamp)',
];
