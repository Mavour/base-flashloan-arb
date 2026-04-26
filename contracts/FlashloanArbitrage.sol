// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ════════════════════════════════════════════════════════════════
// INTERFACES
// ════════════════════════════════════════════════════════════════

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

// Uniswap V3 Router
interface IUniswapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external payable returns (uint256 amountOut);
}

// Aerodrome Router
interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    
    function getAmountsOut(
        uint256 amountIn,
        Route[] calldata routes
    ) external view returns (uint256[] memory amounts);
}

// ════════════════════════════════════════════════════════════════
// MAIN CONTRACT
// ════════════════════════════════════════════════════════════════

/**
 * @title FlashloanArbitrage
 * @notice Cross-DEX arbitrage antara Uniswap V3 dan Aerodrome di Base.
 *         Menggunakan Aave V3 flashloan — zero capital required.
 *
 * STRATEGY A: Buy on Uniswap, Sell on Aerodrome
 * STRATEGY B: Buy on Aerodrome, Sell on Uniswap
 *
 * Bot TypeScript mendeteksi strategy mana yang profitable,
 * lalu encode ke params sebelum panggil executeArbitrage().
 */
contract FlashloanArbitrage is IFlashLoanSimpleReceiver {

    // ─── Addresses (Base Mainnet) ───
    address public constant AAVE_POOL        = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public constant UNISWAP_ROUTER   = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    // Aerodrome pool factory
    address public constant AERO_FACTORY     = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    address public immutable owner;
    bool    private locked;

    // Strategy enum
    uint8 public constant STRATEGY_UNI_TO_AERO  = 1; // Buy Uniswap, Sell Aerodrome
    uint8 public constant STRATEGY_AERO_TO_UNI  = 2; // Buy Aerodrome, Sell Uniswap

    // ─── Events ───
    event ArbitrageExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint8   strategy,
        uint256 flashloanAmount,
        uint256 profit,
        uint256 timestamp
    );
    event ProfitWithdrawn(address token, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    // ════════════════════════════════════════════════════════════
    // ENTRY POINT
    // ════════════════════════════════════════════════════════════

    /**
     * @param flashloanToken  Token yang dipinjam (biasanya WETH atau USDC)
     * @param flashloanAmount Jumlah yang dipinjam (wei)
     * @param tokenOut        Token intermediate (yang diswap ke)
     * @param uniswapFee      Fee tier Uniswap pool (500, 3000, 10000)
     * @param isStablePool    Apakah Aerodrome pool-nya stable atau volatile
     * @param strategy        1=UniToAero, 2=AeroToUni
     * @param minProfit       Minimum profit yang diterima
     */
    function executeArbitrage(
        address flashloanToken,
        uint256 flashloanAmount,
        address tokenOut,
        uint24  uniswapFee,
        bool    isStablePool,
        uint8   strategy,
        uint256 minProfit
    ) external onlyOwner nonReentrant {
        bytes memory params = abi.encode(
            tokenOut,
            uniswapFee,
            isStablePool,
            strategy,
            minProfit
        );

        address[] memory assets  = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        uint256[] memory modes   = new uint256[](1);

        assets[0]  = flashloanToken;
        amounts[0] = flashloanAmount;
        modes[0]   = 0; // no debt

        IPool(AAVE_POOL).flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
    }

    // ════════════════════════════════════════════════════════════
    // FLASHLOAN CALLBACK
    // ════════════════════════════════════════════════════════════

    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL, "Caller not Aave");
        require(initiator == address(this), "Bad initiator");

        // Decode params
        (
            address tokenOut,
            uint24  uniswapFee,
            bool    isStablePool,
            uint8   strategy,
            uint256 minProfit
        ) = abi.decode(params, (address, uint24, bool, uint8, uint256));

        address tokenIn       = assets[0];
        uint256 amountIn      = amounts[0];
        uint256 premium       = premiums[0];
        uint256 totalDebt     = amountIn + premium;

        uint256 finalAmount;

        if (strategy == STRATEGY_UNI_TO_AERO) {
            // ─── Buy on Uniswap → Sell on Aerodrome ───
            // Step 1: Swap tokenIn → tokenOut via Uniswap
            uint256 tokenOutAmount = _swapUniswap(tokenIn, tokenOut, amountIn, uniswapFee);
            // Step 2: Swap tokenOut → tokenIn via Aerodrome
            finalAmount = _swapAerodrome(tokenOut, tokenIn, tokenOutAmount, isStablePool);

        } else if (strategy == STRATEGY_AERO_TO_UNI) {
            // ─── Buy on Aerodrome → Sell on Uniswap ───
            // Step 1: Swap tokenIn → tokenOut via Aerodrome
            uint256 tokenOutAmount = _swapAerodrome(tokenIn, tokenOut, amountIn, isStablePool);
            // Step 2: Swap tokenOut → tokenIn via Uniswap
            finalAmount = _swapUniswap(tokenOut, tokenIn, tokenOutAmount, uniswapFee);

        } else {
            revert("Invalid strategy");
        }

        // ─── Validasi profit ───
        require(finalAmount > totalDebt, "Not profitable");
        uint256 profit = finalAmount - totalDebt;
        require(profit >= minProfit, "Below min profit");

        // ─── Approve Aave ambil kembali ───
        IERC20(tokenIn).approve(AAVE_POOL, totalDebt);

        emit ArbitrageExecuted(tokenIn, tokenOut, strategy, amountIn, profit, block.timestamp);
        return true;
    }

    // ════════════════════════════════════════════════════════════
    // INTERNAL SWAP HELPERS
    // ════════════════════════════════════════════════════════════

    function _swapUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24  fee
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(UNISWAP_ROUTER, amountIn);
        amountOut = IUniswapRouter(UNISWAP_ROUTER).exactInputSingle(
            IUniswapRouter.ExactInputSingleParams({
                tokenIn:           tokenIn,
                tokenOut:          tokenOut,
                fee:               fee,
                recipient:         address(this),
                amountIn:          amountIn,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _swapAerodrome(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bool    stable
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(AERODROME_ROUTER, amountIn);

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from:    tokenIn,
            to:      tokenOut,
            stable:  stable,
            factory: AERO_FACTORY
        });

        uint256[] memory amounts = IAerodromeRouter(AERODROME_ROUTER).swapExactTokensForTokens(
            amountIn,
            0,
            routes,
            address(this),
            block.timestamp + 60
        );

        amountOut = amounts[amounts.length - 1];
    }

    // ════════════════════════════════════════════════════════════
    // OWNER FUNCTIONS
    // ════════════════════════════════════════════════════════════

    function withdrawToken(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "No balance");
        IERC20(token).transfer(owner, bal);
        emit ProfitWithdrawn(token, bal);
    }

    function getPendingProfit(address token) external view returns (uint256) {
        uint256 size;
        assembly { size := extcodesize(token) }
        if (size == 0) return 0;
        return IERC20(token).balanceOf(address(this));
    }

    receive() external payable {}
}
