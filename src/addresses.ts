// ════════════════════════════════════════════════
// BASE NETWORK ADDRESSES & CONSTANTS
// ════════════════════════════════════════════════

export const BASE = {

  // ─── Core Protocol Addresses ───
  AAVE_POOL:       '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  AAVE_ORACLE:     '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156',
  UNISWAP_ROUTER:  '0x2626664c2603336E57B271c5C0b26F421741e481',
  UNISWAP_FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',

  // ─── Token Addresses ───
  WETH:   '0x4200000000000000000000000000000000000006',
  USDC:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  USDBC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', // USDbC (old USDC)
  CBETH:  '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  WSTETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  DAI:    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',

  // ─── Aave aToken Addresses ───
  // aToken = receipt token dari Aave, redeemable 1:1
  AWETH:   '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7',
  AUSDC:   '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  ACBETH:  '0xcf3D55c10DB69a28fD32eC346A0e3dc13d0B8a13',
  AWSTETH: '0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D',

  // ─── Uniswap Pool Fee Tiers ───
  FEE: {
    LOW:    100,   // 0.01% — stablecoin pairs
    MEDIUM: 500,   // 0.05% — stable-ish pairs (WETH/cbETH)
    HIGH:   3000,  // 0.3%  — standard pairs
    ULTRA:  10000, // 1%    — exotic pairs
  },
};

// ─── ARB OPPORTUNITIES yang Dimonitor ───
export interface ArbPair {
  name: string;
  flashloanToken: string;    // Token yang dipinjam
  marketToken: string;       // Token yang dibeli di market (murah)
  aaveToken: string;         // aToken yang di-redeem di Aave
  poolFee: number;           // Uniswap fee tier
  description: string;
}

export const ARB_PAIRS: ArbPair[] = [
  {
    name:           'WETH/aWETH',
    flashloanToken: BASE.WETH,
    marketToken:    BASE.AWETH,
    aaveToken:      BASE.AWETH,
    poolFee:        BASE.FEE.MEDIUM,
    description:    'Beli aWETH murah di market, redeem 1:1 di Aave',
  },
  // {
  //   name:           'WETH/cbETH',
  //   flashloanToken: BASE.WETH,
  //   marketToken:    BASE.CBETH,
  //   aaveToken:      BASE.ACBETH,
  //   poolFee:        BASE.FEE.MEDIUM,
  //   description:    'Beli cbETH murah, redeem di Aave',
  // },
  // {
  //   name:           'WETH/wstETH',
  //   flashloanToken: BASE.WETH,
  //   marketToken:    BASE.WSTETH,
  //   aaveToken:      BASE.AWSTETH,
  //   poolFee:        BASE.FEE.MEDIUM,
  //   description:    'Beli wstETH murah, redeem di Aave',
  // },
  // {
  //   name:           'USDC/USDbC',
  //   flashloanToken: BASE.USDC,
  //   marketToken:    BASE.USDBC,
  //   aaveToken:      BASE.AUSDC,
  //   poolFee:        BASE.FEE.LOW,
  //   description:    'Stablecoin arb antara USDC dan USDbC',
  // },
];

// ERC20 ABI minimal
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Aave Pool ABI minimal
export const AAVE_POOL_ABI = [
  'function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))',
];

// Uniswap V3 Pool ABI minimal
export const UNISWAP_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
];

// Uniswap V3 Factory ABI
export const UNISWAP_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

// Contract ABI (FlashloanArbitrage)
export const CONTRACT_ABI = [
  'function executeArbitrage(uint256 flashloanAmount, uint256 minProfit) external',
  'function withdrawProfit() external',
  'function getPendingProfit() view returns (uint256)',
  'event ArbitrageExecuted(uint256 flashloanAmount, uint256 profit, uint256 timestamp)',
];
