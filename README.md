# ⚡ Base Flashloan Arbitrage Bot

> True zero-capital arbitrage on Base network.
> Menggunakan Aave V3 flashloan untuk eksekusi arb aWETH/WETH dalam **1 transaksi atomik**.
> Kalau rugi → seluruh tx revert. Kamu tidak bisa kehilangan modal.

![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)
![Base](https://img.shields.io/badge/Network-Base-orange)
![Aave](https://img.shields.io/badge/Flashloan-Aave%20V3-purple)

---

## 🧠 Cara Kerja (True Flashloan Atomik)

```
SATU TRANSAKSI — kalau gagal = revert, tidak rugi apapun:

1. Bot deteksi: aWETH dijual murah di Uniswap vs nilai Aave
2. Bot panggil contract.executeArbitrage()
3. Contract pinjam 10 WETH dari Aave (flashloan, gratis)
4. Contract swap WETH → aWETH di Uniswap (dapat lebih!)
5. Contract redeem aWETH → WETH di Aave (1:1)
6. Contract kembalikan 10 WETH + 0.09% premium ke Aave
7. Sisa profit tersimpan di contract
8. Bot withdraw profit ke wallet
```

### Contoh Nyata

```
Kondisi market:
  1 WETH = 1.0022 aWETH di Uniswap (aWETH lebih murah)
  1 aWETH = 1 WETH di Aave (redeem 1:1)

Eksekusi dengan 10 WETH flashloan:
  Pinjam:    10.0000 WETH (dari Aave)
  Swap:      10.0000 WETH → 10.0220 aWETH (Uniswap)
  Redeem:    10.0220 aWETH → 10.0220 WETH (Aave)
  Kembalikan: 10.0090 WETH (10 + 0.09% premium)
  ─────────────────────────────────────────────
  PROFIT:    0.0130 WETH (~$33)
  GAS:       ~$0.05 (Base network)
  NET:       ~$32.95
```

---

## 🗂 Struktur Project

```
base-flashloan-arb/
├── contracts/
│   └── FlashloanArbitrage.sol  → Smart contract (logika atomik)
├── scripts/
│   └── deploy.ts               → Deploy contract ke Base
├── src/
│   ├── index.ts                → Main loop
│   ├── config.ts               → Load env
│   ├── addresses.ts            → Token & protocol addresses
│   ├── priceMonitor.ts         → Scan harga Uniswap vs Aave
│   ├── executor.ts             → Trigger contract on-chain
│   ├── tracker.ts              → P&L logging
│   ├── notifications.ts        → Telegram alerts
│   ├── healthcheck.ts          → HTTP status server
│   └── utils/logger.ts         → Colored console
├── hardhat.config.ts           → Hardhat config (compile & deploy)
├── .env.example
└── package.json
```

---

## 🚀 Setup Lengkap

### Prerequisites

- Node.js v20+
- 0.01–0.05 ETH di **Base network** (untuk gas)
- Alchemy API key ([daftar gratis](https://alchemy.com))

### 1. Install

```bash
git clone https://github.com/USERNAME/base-flashloan-arb.git
cd base-flashloan-arb
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

Isi `.env`:

```env
WALLET_PRIVATE_KEY=your_private_key_hex
RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
DRY_RUN=true
MIN_PROFIT_ETH=0.0005
FLASHLOAN_AMOUNT_ETH=10
```

### 3. Compile Smart Contract

```bash
npm run compile
```

Output:
```
Compiled 1 Solidity file successfully
```

### 4. Test di Base Sepolia dulu (GRATIS)

```bash
# Deploy ke testnet
npm run deploy:test

# Jalankan bot (monitor only, no real tx)
npm run bot
```

Dapatkan testnet ETH gratis di:
- https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- https://faucet.quicknode.com/base/sepolia

### 5. Deploy ke Base Mainnet

```bash
npm run deploy
```

Output:
```
✅ FlashloanArbitrage deployed to: 0x1234...5678
Add this to your .env:
ARBITRAGE_CONTRACT_ADDRESS=0x1234...5678
```

Tambahkan address ke `.env`, lalu:

```bash
npm run bot
```

---

## ⚙️ Konfigurasi

| Variable | Default | Keterangan |
|---|---|---|
| `WALLET_PRIVATE_KEY` | — | Private key (hex) |
| `RPC_URL_BASE` | — | Alchemy Base RPC |
| `ARBITRAGE_CONTRACT_ADDRESS` | — | Diisi setelah deploy |
| `SCAN_INTERVAL_MS` | `2000` | Interval scan (ms) |
| `MIN_PROFIT_ETH` | `0.0005` | ~$1.25 minimum profit |
| `FLASHLOAN_AMOUNT_ETH` | `10` | Ukuran flashloan |
| `MAX_PRIORITY_FEE_GWEI` | `0.1` | Priority fee |
| `DRY_RUN` | `true` | true = simulasi |

---

## 📊 Pairs yang Dimonitor

| Pair | Strategy | Pool Fee |
|---|---|---|
| WETH/aWETH | Beli aWETH murah → redeem Aave | 0.05% |
| WETH/cbETH | Beli cbETH murah → redeem Aave | 0.05% |
| WETH/wstETH | Beli wstETH murah → redeem Aave | 0.05% |
| USDC/USDbC | Stablecoin arb | 0.01% |

---

## 📱 Telegram Setup

1. Buka [@BotFather](https://t.me/BotFather) → `/newbot` → dapat token
2. Start chat dengan bot kamu
3. Buka `https://api.telegram.org/bot<TOKEN>/getUpdates` → dapat chat_id
4. Isi `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=987654321
```

---

## 📊 Health Check

```bash
curl http://localhost:3001
```

```json
{
  "status": "running",
  "network": "Base Mainnet",
  "uptime": "2h 15m",
  "contract": "0x1234...",
  "today": {
    "trades": 5,
    "profitEth": "0.065000",
    "netProfitEth": "0.064750"
  }
}
```

---

## 🖥️ Deploy ke VPS

```bash
# Setup Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

# Clone & setup
git clone https://github.com/USERNAME/base-flashloan-arb.git
cd base-flashloan-arb
npm install
cp .env.example .env && nano .env

# Compile & deploy contract (sekali saja)
npm run compile
npm run deploy

# Run dengan PM2
npm install -g pm2
pm2 start npm --name "base-arb" -- run bot
pm2 save && pm2 startup
```

---

## 🔒 Security

- ❌ Jangan commit `.env`
- ✅ Gunakan wallet dedicated
- ✅ `withdrawProfit()` hanya bisa dipanggil owner
- ✅ `nonReentrant` modifier di semua fungsi kritis
- ✅ Simulasi sebelum eksekusi nyata
- ✅ `minProfit` parameter mencegah eksekusi tidak profitable

---

## ⚠️ Risiko & Disclaimer

- **Kompetisi:** Bot lain bisa frontrun transaksi kamu
- **Slippage:** Market bisa bergerak antara deteksi dan eksekusi
- **Gas:** Kadang gas naik tiba-tiba, profit bisa < gas cost
- **Contract bug:** Selalu test di testnet sebelum mainnet

Bot ini dibuat untuk edukasi. Gunakan dengan risiko sendiri.

---

## 📈 Roadmap

- [x] Smart contract flashloan atomik
- [x] Uniswap V3 price monitoring
- [x] Profit calculator (gross - premium - gas)
- [x] DRY RUN mode
- [x] Telegram notifications
- [x] Health check server
- [x] P&L tracker
- [x] Auto-withdraw profit
- [ ] Multi-pair parallel execution
- [ ] Flashbots bundle (anti-frontrun)
- [ ] More Aave pairs (USDC, cbETH)
- [ ] Dashboard web

---

## 📄 License

MIT
