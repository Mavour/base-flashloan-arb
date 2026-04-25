// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ════════════════════════════════════════════════════════════════
// INTERFACES
// ════════════════════════════════════════════════════════════════

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IPool {
    /**
     * Aave V3 flashloan function.
     * Meminjam `amounts` dari `assets`, mengirim ke `receiverAddress`.
     * Setelah eksekusi, receiverAddress HARUS mengembalikan dana + premium.
     */
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes, // 0 = no open debt
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;

    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);
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

interface ISwapRouter {
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

// ════════════════════════════════════════════════════════════════
// MAIN CONTRACT
// ════════════════════════════════════════════════════════════════

/**
 * @title FlashloanArbitrage
 * @notice Eksekusi arbitrase aEthWETH/WETH menggunakan Aave V3 flashloan di Base.
 *
 * ALUR:
 * 1. Bot TypeScript deteksi peluang (aEthWETH < WETH)
 * 2. Bot panggil executeArbitrage()
 * 3. Contract pinjam WETH dari Aave via flashloan
 * 4. Swap WETH → aEthWETH (dapat lebih banyak)
 * 5. Withdraw aEthWETH → WETH dari Aave pool
 * 6. Kembalikan WETH + premium ke Aave
 * 7. Profit tersisa di contract → owner withdraw
 */
contract FlashloanArbitrage is IFlashLoanSimpleReceiver {

    // ─── Addresses (Base Mainnet) ───
    address public constant AAVE_POOL      = 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
    address public constant WETH           = 0x4200000000000000000000000000000000000006;
    address public constant AWETH          = 0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7; // aBasWETH
    address public constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481; // Uniswap V3 Base
    uint24  public constant POOL_FEE       = 500; // 0.05% fee tier

    address public immutable owner;
    bool    private locked; // reentrancy guard

    // ─── Events ───
    event ArbitrageExecuted(
        uint256 flashloanAmount,
        uint256 profit,
        uint256 timestamp
    );
    event ProfitWithdrawn(address token, uint256 amount);

    // ─── Modifiers ───
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor() {
        owner = msg.sender;
    }

    // ════════════════════════════════════════════════════════════
    // ENTRY POINT — dipanggil oleh bot TypeScript
    // ════════════════════════════════════════════════════════════

    /**
     * @notice Mulai eksekusi arbitrase.
     * @param flashloanAmount Jumlah WETH yang dipinjam (dalam wei)
     * @param minProfit Minimum profit yang diterima (dalam wei) — revert jika kurang
     */
    function executeArbitrage(
        uint256 flashloanAmount,
        uint256 minProfit
    ) external onlyOwner nonReentrant {
        // Encode parameter untuk dikirim ke executeOperation
        bytes memory params = abi.encode(minProfit);

        address[] memory assets  = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        uint256[] memory modes   = new uint256[](1);

        assets[0]  = WETH;
        amounts[0] = flashloanAmount;
        modes[0]   = 0; // no debt = harus dikembalikan dalam tx yang sama

        // Panggil Aave flashloan → akan callback ke executeOperation
        IPool(AAVE_POOL).flashLoan(
            address(this), // receiver = contract ini sendiri
            assets,
            amounts,
            modes,
            address(this),
            params,
            0 // referral code
        );
    }

    // ════════════════════════════════════════════════════════════
    // CALLBACK — dipanggil oleh Aave setelah flashloan dikirim
    // ════════════════════════════════════════════════════════════

    /**
     * @notice Aave memanggil fungsi ini setelah mengirim dana flashloan.
     *         Semua logika arbitrase ada di sini.
     *         HARUS mengembalikan amount + premium sebelum fungsi selesai.
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == AAVE_POOL, "Caller not Aave Pool");
        require(initiator == address(this), "Initiator not this contract");

        uint256 flashloanAmount = amounts[0];
        uint256 premium         = premiums[0];
        uint256 minProfit       = abi.decode(params, (uint256));

        // ─── Step 1: Deposit WETH ke Aave → dapat aWETH (1:1) ───
        IERC20(WETH).approve(AAVE_POOL, flashloanAmount);
        IPool(AAVE_POOL).supply(WETH, flashloanAmount, address(this), 0);

        // ─── Step 2: Swap aWETH → WETH di Uniswap (dapat lebih!) ───
        // aWETH dijual LEBIH MAHAL di Uniswap → dapat WETH lebih banyak
        uint256 aWethBalance = IERC20(AWETH).balanceOf(address(this));
        IERC20(AWETH).approve(UNISWAP_ROUTER, aWethBalance);

        uint256 wethReceived = ISwapRouter(UNISWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn:           AWETH,
                tokenOut:          WETH,
                fee:               POOL_FEE,
                recipient:         address(this),
                amountIn:          aWethBalance,
                amountOutMinimum:  0,
                sqrtPriceLimitX96: 0
            })
        );

        // ─── Step 3: Validasi profit ───
        uint256 totalDebt = flashloanAmount + premium;
        require(wethReceived > totalDebt, "Not profitable");

        uint256 profit = wethReceived - totalDebt;
        require(profit >= minProfit, "Profit below minimum");

        // ─── Step 4: Approve Aave ambil kembali flashloan ───
        IERC20(WETH).approve(AAVE_POOL, totalDebt);

        emit ArbitrageExecuted(flashloanAmount, profit, block.timestamp);
        return true;
    }

    // ════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS
    // ════════════════════════════════════════════════════════════

    /**
     * @notice Withdraw profit WETH ke wallet owner
     */
    function withdrawProfit() external onlyOwner {
        uint256 balance = IERC20(WETH).balanceOf(address(this));
        require(balance > 0, "No profit to withdraw");
        bool ok = IERC20(WETH).transfer(owner, balance);
        require(ok, "Transfer failed");
        emit ProfitWithdrawn(WETH, balance);
    }

    /**
     * @notice Withdraw token lain yang mungkin tersisa
     */
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "No balance");
        bool ok = IERC20(token).transfer(owner, balance);
        require(ok, "Transfer failed");
        emit ProfitWithdrawn(token, balance);
    }

    /**
     * @notice Cek profit yang sudah terkumpul di contract
     */
    function getPendingProfit() external view returns (uint256) {
        // Kalau WETH tidak ada (local test), return 0
        uint256 size;
        address weth = WETH;
        assembly { size := extcodesize(weth) }
        if (size == 0) return 0;
        return IERC20(WETH).balanceOf(address(this));
    }

    /**
     * @notice Terima ETH (diperlukan untuk unwrap WETH)
     */
    receive() external payable {}
}
