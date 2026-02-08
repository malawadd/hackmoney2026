# yellowX — x402 Payments on Yellow Network

**Autonomous agent payments with instant settlement, zero gas fees, powered by Yellow Network state channels**

[![Built for Yellow Network](https://img.shields.io/badge/Built%20for-Yellow%20Network-FFD803?style=for-the-badge)](https://yellow.org/)
[![x402 Protocol](https://img.shields.io/badge/Protocol-x402-001858?style=for-the-badge)](https://www.x402.org/)

---

## What is yellowX?

**yellowX** is an x402 API marketplace for AI agents that pay for API access autonomously — built from the ground up for **Yellow Network**.

It's the first x402 implementation designed specifically to leverage Yellow Network's state channels, enabling agents to make instant, gasless payments for API services.

### How It Works

```
Agent receives task
    ↓
API returns 402 Payment Required
    ↓
Agent pays via Yellow Network (instant, gasless)
    ↓
Service executes
    ↓
Atomic settlement (payment only if service succeeds)
```

### Who Is This For?

- **AI Agent Builders** — Enable your agents to pay for APIs autonomously
- **API Providers** — Monetize your APIs with instant USDC payments
- **Developers** — Explore agentic commerce and x402 micropayments

---

## Why Yellow Network?

yellowX is built for **Yellow Network** because traditional payment rails are too slow and expensive for autonomous agents.

### Yellow Network Strengths for yellowX

#### ⚡ Instant Payments
Sub-second settlement via state channels. No waiting for block confirmations. Agents execute tasks and pay instantly.

**Yellow Network:** <100ms payment latency  
**Traditional on-chain:** 1-2s payment latency  
**Result:** 5-10x faster

#### 💸 Zero Gas Fees
Off-chain payments eliminate gas costs entirely. Agents pay exactly what the API costs — nothing more.

**Yellow Network:** $0.000 gas per transaction  
**Traditional on-chain:** ~$0.001 gas per transaction  
**Result:** 9% cost savings per transaction

#### 🔄 State Channels
Scalable off-chain payment channels suitable for high-frequency micropayments. Perfect for agents making dozens or hundreds of API calls.

#### 🌐 x402-Native
HTTP 402 "Payment Required" + Yellow Network payment flow. Agents detect 402 responses, authorize payments via Yellow, and retry — all automatically.

#### 💵 USDC
Stable, programmable payments. No volatility, no surprises.

### How yellowX Uses Yellow Network

1. **402 responses include Yellow Network session info** — Agents know how to pay instantly
2. **Yellow Network is the default** — Agents prefer Yellow when available
3. **Off-chain verification** — Payments verified via `X-Yellow-Payment` header
4. **Automatic fallback** — On-chain payments when Yellow is unavailable

### Benefits for Agents

- **~5-10x faster** than on-chain payments
- **~9% cost savings** per transaction (no gas)
- **Better UX** for multi-step agent workflows
- **Scalable** to thousands of API calls per minute

---

## Quick Start

Get yellowX running in **under 5 minutes**:

```bash
# Install dependencies
cd gateway && npm install
cd ../frontend && npm install

# Start services (use 2 terminals)
cd gateway && npm run dev      # Terminal 1
cd frontend && npm run dev     # Terminal 2

# Open browser
# http://localhost:5173
```

### Environment Variables

**Backend** (`gateway/.env`):
```env
PORT=3001
DEMO_WALLET_ADDRESS=0x988530a4df2fe4590db57cfb8a6ad831c01c996a
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:3001
```

📖 **Full setup guide:** [QUICKSTART.md](./QUICKSTART.md)

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│          Frontend (yellowX)                     │
│   Agent Demo with "Use Yellow Network" toggle   │
└────────────────────┬────────────────────────────┘
                     │ POST /agent/x402
                     ▼
┌─────────────────────────────────────────────────┐
│          Gateway (x402)                         │
│   402 with payment_methods:                     │
│     - yellow_network (recommended)              │
│     - arc_network (fallback)                    │
└────────────────────┬────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────┐
│          Agent Payment Decision                 │
│   Prefers Yellow (instant) → fallback to        │
│   on-chain when needed                          │
└────────┬────────────────────────┬────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────┐    ┌──────────────────┐
│ Yellow Network   │    │  On-chain        │
│ (state channels) │    │  (fallback)      │
│ Instant, $0 gas  │    │  1-2s, ~$0.001   │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌───────────────────────┐
         │ Payment verified      │
         │ Service executes      │
         │ Atomic settlement     │
         └───────────────────────┘
```

---

## Key Features

- ⚡ **Instant agent payments** via Yellow Network state channels
- 💸 **Zero gas fees** for off-chain payments
- 🔒 **Atomic settlement** — payment only if service succeeds
- 🔄 **Automatic fallback** to on-chain when Yellow unavailable
- 📊 **Payment comparison** — real-time Yellow vs on-chain savings
- 🎨 **Neobrutalism UI** — bold, yellow-forward design
- 🤖 **x402 compliant** — standard HTTP payment protocol

---

## Project Structure

```
yellowX/
├── frontend/              # yellowX React app
│   ├── src/
│   │   ├── App.jsx       # Home + Agent Demo pages
│   │   ├── index.css     # Yellow neobrutalism styling
│   │   ├── components/
│   │   │   └── PaymentComparisonCard.jsx  # Savings visualization
│   │   └── hooks/
│   │       ├── useWallet.js
│   │       └── useYellowNetwork.js
│   └── package.json
│
├── gateway/               # x402 Gateway with dual payment support
│   ├── server.js         # Enhanced 402 responses, payment verification
│   ├── db.js             # SQLite with replay prevention
│   ├── services/
│   │   ├── yellowNetworkService.js  # Yellow payment verification
│   │   ├── arcExecutor.js           # On-chain fallback
│   │   └── x402Client.js            # x402 client
│   └── package.json
│
└── Documentation
    ├── README.md         # This file
    ├── QUICKSTART.md     # 5-minute setup guide
    ├── IMPLEMENTATION.md # Technical details
    ├── SUMMARY.md        # Complete feature overview
    └── YELLOWX_IMPLEMENTATION.md  # Frontend remake details
```

---

## Yellow Network Configuration

### Demo Mode (Default)

yellowX runs in **demo mode** by default — no Yellow Network ClearNode connection required. Perfect for testing and development.

- Simulates off-chain payments
- Full integration flow
- Same API, same behavior
- Ready for production Yellow Network when available

### Production Mode

To connect to a real Yellow Network ClearNode:

**Backend** (`gateway/.env`):
```env
YELLOW_CLEARNODE_URL=wss://clearnode.yellownetwork.io
YELLOW_WALLET_PRIVATE_KEY=0x...
```

📖 **Session setup guide:** [YELLOW_SESSION_SETUP.md](./YELLOW_SESSION_SETUP.md)

---

## Testing

### Test Yellow Network Payment

1. Navigate to Agent Demo page
2. Ensure **"Use Yellow Network"** toggle is checked ✅
3. Enter task: `What is the current Bitcoin price?`
4. Click **"Execute Task"**

**Expected results:**
- ⚡ Payment executes in <300ms
- "Yellow Network" badge appears
- Payment Comparison Card shows savings
- $0.000 gas fee

### Test On-chain Fallback

1. Uncheck **"Use Yellow Network"** toggle
2. Enter any task
3. Click **"Execute Task"**

**Expected results:**
- 🔗 On-chain payment (~1500ms)
- Transaction hash visible
- Gas fee shown (~$0.001)

---

## Performance Metrics

| Metric | Yellow Network | On-chain | Improvement |
|--------|----------------|----------|-------------|
| **Payment Latency** | 50-300ms | 1000-2000ms | **5-10x faster** |
| **Gas Cost** | $0.000 | ~$0.001 | **9% savings** |
| **Confirmation** | Instant | 1-2 seconds | **Immediate** |
| **Throughput** | 1000s/min | Limited | **Highly scalable** |

---

## API Endpoints

### Enhanced x402 Routes

All x402 routes support dual payments (Yellow + on-chain):

- `POST /agent/x402` — Smart agent payment with Yellow preference
- `POST /x402/*` — x402 protocol routes with dual payment
- `POST /proxy/:apiId` — API proxy with payment verification

### Yellow Network Stats

- `GET /yellow/stats` — Payment statistics and savings

### Response Format

All 402 responses include:

```json
{
  "error": "Payment Required",
  "price": "0.01",
  "payment_methods": {
    "yellow_network": {
      "session_id": "app_session_abc123",
      "instant": true,
      "gas_free": true
    },
    "arc_network": {
      "recipient": "0x742d...",
      "gas": "0.001"
    }
  },
  "recommended": "yellow_network"
}
```

---

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** — Get started in 5 minutes
- **[IMPLEMENTATION.md](./IMPLEMENTATION.md)** — Technical implementation details
- **[SUMMARY.md](./SUMMARY.md)** — Complete feature overview
- **[YELLOWX_IMPLEMENTATION.md](./YELLOWX_IMPLEMENTATION.md)** — Frontend remake details
- **[x402.org](https://www.x402.org/)** — x402 Protocol specification
- **[Yellow Network](https://yellow.com/)** — Learn about Yellow Network

---

## Security

- ✅ **Payment replay prevention** — Unique payment IDs tracked in database
- ✅ **Session validation** — Yellow Network session status verified
- ✅ **Atomic settlement** — Service executes first, payment records second
- ✅ **User fund protection** — Failed service = no payment executed

---

## Use Cases

### High-Frequency Trading Bot
- Opens Yellow channel with $100 allocation
- Makes 1000+ API calls per minute for price data
- All payments instant, off-chain, zero gas
- **Savings:** ~$1 in gas fees per 1000 calls

### AI Research Agent
- Pre-funds Yellow channel with $10
- Executes complex task requiring 50+ API calls
- Total time: <5 seconds vs 50-100 seconds on-chain
- **Benefit:** 10-20x faster execution

### Multi-Step Agent Workflow
- Agent breaks down complex task into sub-tasks
- Each sub-task requires different API calls
- Yellow Network enables seamless flow
- **Result:** Better UX, lower costs

---

## Tech Stack

- **Frontend:** React + Vite + Neobrutalism CSS
- **Backend:** Node.js + Express + x402
- **Payments:** Yellow Network (state channels) + on-chain fallback
- **Database:** SQLite (replay prevention)
- **Currency:** USDC

---

## Contributing

yellowX is open source! Contributions welcome.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

## License

MIT License

---

## Credits

**Built for HackMoney 2026**

First x402 implementation on Yellow Network. Demonstrating the future of autonomous agent commerce.

**Technologies:**
- [Yellow Network](https://yellow.com/) — Instant, gasless payments
- [x402 Protocol](https://www.x402.org/) — HTTP payment standard
- [USDC](https://www.circle.com/usdc) — Stable digital currency

---

## Support

- **Issues:** [GitHub Issues](https://github.com/ArcAgents/arcent/issues)
- **Docs:** See documentation links above
- **x402 Protocol:** [x402.org](https://www.x402.org/)
- **Yellow Network:** [yellow.com](https://yellow.com/)

---

**yellowX** — Where autonomous agents meet instant payments 🚀
