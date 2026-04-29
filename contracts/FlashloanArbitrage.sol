// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ── Interfaces ──────────────────────────────────────────────────────────────

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params)
        external returns (uint256 amountOut);
}

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
}

// ── Contract ─────────────────────────────────────────────────────────────────

contract FlashloanArbitrage is FlashLoanSimpleReceiverBase, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Constants ────────────────────────────────────────────────────────────
    address public constant UNISWAP_ROUTER  = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address public constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address public constant AERODROME_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    // ── State ─────────────────────────────────────────────────────────────────
    address public immutable owner;
    uint256 public totalProfit;

    // ── Arb params (passed via executeOperation) ──────────────────────────────
    struct ArbParams {
        address tokenIn;
        address tokenOut;
        uint24  uniswapFee;
        bool    buyOnAero;    // true = beli di Aero jual di Uni, false = sebaliknya
        uint256 minProfit;
        bool    aeroStable;
    }

    // ── Events ────────────────────────────────────────────────────────────────
    event ArbExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 flashloanAmount,
        uint256 profit,
        bool    buyOnAero
    );

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address _addressProvider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
    {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── Entry point dari bot ──────────────────────────────────────────────────
    function executeArbitrage(
        address flashloanToken,
        uint256 flashloanAmount,
        ArbParams calldata params
    ) external onlyOwner nonReentrant {
        bytes memory encodedParams = abi.encode(params);
        POOL.flashLoanSimple(
            address(this),
            flashloanToken,
            flashloanAmount,
            encodedParams,
            0
        );
    }

    // ── Callback dari Aave ────────────────────────────────────────────────────
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller not Aave Pool");
        require(initiator == address(this), "Invalid initiator");

        ArbParams memory arbParams = abi.decode(params, (ArbParams));
        uint256 amountOwed = amount + premium;

        uint256 amountOut;

        if (arbParams.buyOnAero) {
            // Step 1: Beli tokenOut di Aerodrome dengan tokenIn (flashloan)
            amountOut = _swapAerodrome(
                asset,
                arbParams.tokenOut,
                amount,
                arbParams.aeroStable
            );
            // Step 2: Jual tokenOut di Uniswap, dapat tokenIn kembali
            uint256 returned = _swapUniswap(
                arbParams.tokenOut,
                asset,
                amountOut,
                arbParams.uniswapFee
            );
            require(returned > amountOwed + arbParams.minProfit, "Not profitable");
            uint256 profit = returned - amountOwed;
            totalProfit += profit;
            emit ArbExecuted(asset, arbParams.tokenOut, amount, profit, true);
        } else {
            // Step 1: Beli tokenOut di Uniswap
            amountOut = _swapUniswap(
                asset,
                arbParams.tokenOut,
                amount,
                arbParams.uniswapFee
            );
            // Step 2: Jual di Aerodrome, dapat tokenIn kembali
            uint256 returned = _swapAerodrome(
                arbParams.tokenOut,
                asset,
                amountOut,
                arbParams.aeroStable
            );
            require(returned > amountOwed + arbParams.minProfit, "Not profitable");
            uint256 profit = returned - amountOwed;
            totalProfit += profit;
            emit ArbExecuted(asset, arbParams.tokenOut, amount, profit, false);
        }

        // Approve Aave untuk ambil kembali
        IERC20(asset).safeIncreaseAllowance(address(POOL), amountOwed);
        return true;
    }

    // ── Internal: Swap di Uniswap V3 ─────────────────────────────────────────
    function _swapUniswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint24 fee
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeIncreaseAllowance(UNISWAP_ROUTER, amountIn);
        amountOut = IUniswapV3Router(UNISWAP_ROUTER).exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0, // slippage check ada di require profit
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ── Internal: Swap di Aerodrome ───────────────────────────────────────────
    function _swapAerodrome(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bool stable
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeIncreaseAllowance(AERODROME_ROUTER, amountIn);
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({
            from: tokenIn,
            to: tokenOut,
            stable: stable,
            factory: AERODROME_FACTORY
        });
        uint256[] memory amounts = IAerodromeRouter(AERODROME_ROUTER)
            .swapExactTokensForTokens(
                amountIn,
                0,
                routes,
                address(this),
                block.timestamp + 60
            );
        amountOut = amounts[amounts.length - 1];
    }

    // ── Withdraw profit ke owner ───────────────────────────────────────────────
    function withdrawProfit(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "No balance");
        IERC20(token).safeTransfer(owner, bal);
    }

    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    receive() external payable {}
}