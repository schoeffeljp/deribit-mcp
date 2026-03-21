# Deribit MCP — Crypto Options Trading Companion

An MCP (Model Context Protocol) server that turns any AI assistant into a **crypto options trading companion**. Connects to [Deribit](https://www.deribit.com) for real-time market data, portfolio management, trade execution, and risk analysis — all through natural language.

Beyond raw API access, it includes **analytical tools** (fee-aware P&L, IV rank, portfolio risk metrics), **workflow tools** (options chains, volatility surfaces), and **built-in skills** (position management, risk assessment, strategy scanning) that any MCP client can discover and use automatically.

Works with **Claude Desktop**, **Claude Code**, **Stack AI**, or any MCP-compatible client. Supports both **stdio** (local) and **HTTP** (remote/cloud) transports.

## What you can do

- **Explore the options market** — list expirations, pull full options chains with greeks and IV, scan the volatility surface across all strikes and expiries
- **Find opportunities** — search by delta, compare implied vs historical vol (IV rank, VRP), check funding rates, scan for high-yield trades
- **Trade** — place/edit/cancel orders, close positions, estimate margin before trading
- **Monitor your portfolio** — one-shot account overview, aggregated greeks, full trade history per instrument with fees
- **Analyze positions** — fee-aware net P&L (including entry fees, exit simulation with bid/ask spread and taker fees), DTE-based risk flags, automated HOLD/CLOSE/ROLL recommendations
- **Manage risk** — Tasty Trade-style portfolio metrics (theta/netliq, delta/theta ratio, margin utilization, concentration), buying power analysis
- **Get strategy advice** — naked put, strangle, covered call, and calendar spread scanning with complete trade plans

## Quick start — Local (Claude Desktop / Claude Code)

### 1. Get Deribit API keys

- **Testnet** (recommended to start): [test.deribit.com/account/api](https://test.deribit.com/account/api)
- **Mainnet**: [deribit.com/account/api](https://www.deribit.com/account/api)

You need `read` + `trade` scopes for full functionality. Public market data works without credentials.

### 2. Clone and build

```bash
git clone https://github.com/schoeffeljp/deribit-mcp.git
cd deribit-mcp
npm install
npm run build
```

### 3. Add to Claude Desktop

Edit your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "deribit": {
      "command": "node",
      "args": ["/absolute/path/to/deribit-mcp/dist/index.js"],
      "env": {
        "DERIBIT_CLIENT_ID": "your_client_id",
        "DERIBIT_CLIENT_SECRET": "your_client_secret",
        "DERIBIT_TESTNET": "true"
      }
    }
  }
}
```

Restart Claude Desktop. The Deribit tools, analytics, and skills will appear automatically.

## Quick start — Cloud (Railway)

Deploy to Railway for remote access from Stack AI, custom apps, or any HTTP-based MCP client. Takes under 5 minutes.

### 1. Create a Railway project

1. Go to [railway.com](https://railway.com) and create a new project
2. Select **Deploy from GitHub repo** and connect `schoeffeljp/deribit-mcp`
3. Railway auto-detects Node.js, runs `npm run build`, and starts the server

### 2. Set environment variables

In the Railway service **Variables** tab, add:

```
DERIBIT_CLIENT_ID=your_client_id
DERIBIT_CLIENT_SECRET=your_client_secret
DERIBIT_TESTNET=false
MCP_TRANSPORT=http
MCP_API_KEY=generate_a_random_secret_here
```

Railway auto-sets `PORT`. The server will start in HTTP mode automatically.

### 3. Get your public URL

Railway assigns a URL like `https://your-service.up.railway.app`. Your MCP endpoint is:

```
https://your-service.up.railway.app/mcp
```

### 4. Connect your MCP client

**Stack AI**: Add a new MCP connection (API Key type), enter your Railway URL + API key.

**Any MCP client**:
```json
{
  "mcpServers": {
    "deribit": {
      "type": "streamable-http",
      "url": "https://your-service.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer your_mcp_api_key"
      }
    }
  }
}
```

**Custom app** (using MCP SDK):
```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "my-app" });
await client.connect(new StreamableHTTPClientTransport(
  new URL("https://your-service.up.railway.app/mcp"),
  { headers: { Authorization: "Bearer your_mcp_api_key" } }
));

// Discover all tools automatically
const { tools } = await client.listTools();

// Discover all skills (prompts) automatically
const { prompts } = await client.listPrompts();

// Call any tool
const result = await client.callTool({
  name: "get_options_chain",
  arguments: { currency: "USDC", underlying: "ETH", expiry: "24APR26" }
});
```

That's it. Every push to GitHub auto-deploys to Railway.

## Tools

### Market Data (12 tools — public, no auth needed)

| Tool | Description |
|------|-------------|
| `get_currencies` | List all available currencies on Deribit |
| `get_instruments` | List tradable instruments (options, futures, spots) for a currency |
| `get_ticker` | Real-time quote with greeks, IV, bid/ask, mark price |
| `get_order_book` | Bid/ask depth for an instrument |
| `get_book_summary_by_currency` | Market-wide summary (volume, OI, prices) for all instruments |
| `get_index_price` | Current index price (e.g. btc_usd, eth_usd) |
| `get_historical_volatility` | Historical volatility data points over time |
| `get_volatility_index` | DVOL (Deribit's VIX equivalent) OHLCV data |
| `get_tradingview_chart_data` | OHLCV candlestick data for any instrument |
| `get_funding_rate_history` | Perpetual funding rate history |
| `get_delivery_prices` | Historical settlement/delivery prices |

### Account & Trading (13 tools — private, requires auth)

| Tool | Description |
|------|-------------|
| `get_account_summary` | Balance, equity, margin usage, P&L |
| `get_positions` | All open positions with greeks and P&L |
| `get_open_orders` | Pending orders |
| `buy` / `sell` | Place orders (limit, market, stop). Use `amount` (base currency) or `contracts` |
| `edit_order` | Modify an existing order's price, amount, or parameters |
| `cancel_order` / `cancel_all_orders` | Cancel orders |
| `close_position` | Flatten a position with market or limit |
| `get_user_trades` | Trade fill history by currency, filterable by kind (option/future/spot) |
| `get_user_trades_by_instrument` | Full fill history for a specific instrument — includes timestamp, index price, IV at trade time. Essential for position entry analysis |
| `get_transaction_log` | Full ledger (trades, settlements, fees, funding, deposits, withdrawals) |
| `get_margins` | Estimate margin for a hypothetical trade before placing it |

### Workflow Tools (6 tools — composite, chain multiple API calls into one)

| Tool | Description |
|------|-------------|
| `get_expirations` | All available expiry dates with strike counts, sorted chronologically |
| `get_options_chain` | Full chain for an expiry: all strikes with bid/ask, IV, greeks, OI for calls and puts |
| `find_options_by_delta` | Find options closest to a target delta (e.g. "25-delta put") |
| `get_volatility_surface` | IV matrix across all strikes and expirations with ATM IV and skew per expiry |
| `get_portfolio_greeks` | Aggregated delta/gamma/vega/theta across all option positions |
| `get_portfolio_summary` | One-shot account overview: balances + all positions + all open orders |

### Analytics Tools (3 tools — compute derived metrics for decision-making)

| Tool | Description |
|------|-------------|
| `analyze_position` | **Fee-aware position analysis.** Returns gross P&L, net P&L (after actual entry fees from trade history), simulated exit P&L (at bid/ask with taker fees), DTE, moneyness, greeks, risk flags, and HOLD/CLOSE/ROLL/TAKE_PROFIT recommendation |
| `iv_rank` | IV rank and IV percentile over a configurable lookback period, plus current HV and VRP signal |
| `portfolio_risk_metrics` | Portfolio-level dollar greeks, theta/netliq ratio, delta/theta ratio, margin utilization, position concentration, and per-position breakdown with sizing flags |

## Skills (MCP Prompts)

Skills are **built-in prompt templates** registered on the MCP server. Any client that supports `prompts/list` and `prompts/get` discovers them automatically — **no client-side configuration needed**. They combine the right tool calls with a structured analysis framework.

| Skill | Trigger | What it does |
|-------|---------|-------------|
| `position_management` | "Review my positions", "Should I close this?" | Calls `analyze_position`, applies profit-taking rules (scale-out at 30/50/75%), DTE-based stops, delta exits, rolling framework. All recommendations use **net P&L after fees and spread** |
| `risk_management` | "Run a risk check", "How's my portfolio health?" | Calls `portfolio_risk_metrics`, evaluates Tasty Trade ratios (theta/netliq 0.1-0.3%, delta/theta < 0.5, margin < 50%), flags breaches, suggests remediation |
| `strategy_advisor` | "Find me a naked put", "Scan for strangles" | Accepts strategy type (naked_put / strangle / covered_call / calendar). Checks IV rank, scans candidates, ranks by yield, outputs complete trade plans with entry/stop/target/margin |

### How skills work

Skills live entirely on the MCP server. When a client calls `prompts/list`, it gets:

```json
[
  { "name": "position_management", "description": "Systematic position review with risk flags..." },
  { "name": "risk_management", "description": "Portfolio-level risk assessment..." },
  { "name": "strategy_advisor", "description": "Trade idea generation..." }
]
```

The client fetches a skill with `prompts/get("position_management")` and receives a structured prompt that tells the LLM exactly which tools to call and how to analyze the results. The client doesn't need to know anything about options trading — the skill contains the complete framework.

### Position management rules (built into the skill)

**Profit taking** (scale-out approach):
- +50% profit: close 1/3 to 1/2 of contracts
- Remaining: tighten stop to breakeven
- +75% profit: close remaining

**DTE-based stops** (tighten as expiry approaches):
- \> 21 DTE: stop at -40% | 14-21 DTE: -35% | 7-14 DTE: -25% | < 7 DTE: -20% | < 3 DTE: close all

**Fee awareness**: all P&L calculations include actual entry fees (from trade history) and simulated exit costs (bid/ask spread + ~$0.9/contract taker fee). A position showing +11% gross might only be +2% net.

## Example prompts

Once configured, try asking your AI assistant:

**Market data:**
- *"Show me all ETH option expirations"*
- *"Get the full options chain for ETH USDC April 24th expiry"*
- *"What's the BTC volatility surface?"*
- *"Compare 30-day historical volatility with implied volatility for ETH"*

**Portfolio:**
- *"Show me my positions with greeks"*
- *"What's my net delta and theta exposure?"*
- *"Pull the trade history for my ETH 2400 calls — when did I open them and at what underlying price?"*

**Analysis (triggers skills automatically):**
- *"Review my positions and tell me what to close or hold"*
- *"Run a risk check on my portfolio"*
- *"Find me the best naked put opportunity on ETH right now"*
- *"Scan for short strangles on ETH with IV rank above 50"*

**Trading:**
- *"Buy 0.05 ETH of the 2400 call for April at limit price $25"*
- *"Close my 1950 put position at market"*
- *"How much margin would I need for 3 contracts of the 2000 put?"*

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DERIBIT_CLIENT_ID` | For private tools | — | Deribit API key ID |
| `DERIBIT_CLIENT_SECRET` | For private tools | — | Deribit API secret |
| `DERIBIT_TESTNET` | No | `false` | Set `true` for testnet |
| `MCP_TRANSPORT` | No | `stdio` | `stdio` for local, `http` for cloud |
| `PORT` | No | `3000` | HTTP server port (Railway sets this automatically) |
| `MCP_API_KEY` | For HTTP mode | — | Bearer token for authentication |
| `MCP_CORS_ORIGIN` | No | `*` | Allowed CORS origin for HTTP mode |

## Architecture

```
src/
├── index.ts              # Entry — stdio or HTTP transport based on MCP_TRANSPORT
├── deribit-client.ts     # JSON-RPC client with auto-auth
├── prompts.ts            # Skills (position management, risk, strategy advisor)
└── tools/
    ├── public.ts         # 12 market data tools (no auth)
    ├── private.ts        # 13 account & trading tools (auth required)
    ├── workflow.ts       # 6 composite tools (chain multiple API calls)
    └── analytics.ts      # 3 analytical tools (derived metrics, risk scoring)
```

**Two transport modes:**
- **stdio** (default) — Claude Desktop spawns and manages the process. Zero setup.
- **HTTP** — standalone server with `/mcp` endpoint using Streamable HTTP transport. Deploy anywhere.

**Key design decisions:**
- Workflow tools compose multiple Deribit API calls into a single tool call (e.g. `get_options_chain` fetches instruments + tickers for all strikes)
- Analytics tools compute derived metrics (net P&L after fees, IV rank, portfolio risk ratios) that raw API data doesn't provide
- Skills are MCP prompts — they live on the server and are auto-discovered by any client. No client-side setup needed.
- USDC-settled instruments are listed under `currency: "USDC"`, not under `"ETH"` or `"BTC"` — this is a Deribit API quirk that the tools handle transparently

## Security

- **Always set `MCP_API_KEY`** in HTTP mode. Without it, anyone who finds the URL can use your Deribit credentials.
- **Never expose Deribit credentials** in client-side code. The MCP server holds them server-side.
- **Set `MCP_CORS_ORIGIN`** to your app's domain in production.
- Trading tools place real orders. Use testnet first.

## Running tests

```bash
# Public endpoint tests (no credentials needed)
npm test

# With valid testnet credentials, private endpoint tests also run
DERIBIT_CLIENT_ID=xxx DERIBIT_CLIENT_SECRET=yyy npm test
```

## Development

```bash
npm run dev          # Watch mode — recompiles on changes
npm run build        # One-time build
npm test             # Run test suite
npm run test:watch   # Watch mode for tests
```

## Switching to mainnet

Set `DERIBIT_TESTNET=false` in your `.env` or Claude Desktop config. **Use mainnet with caution — trading tools place real orders with real money.**

## Clients & Related Projects

This MCP server is designed to work with any MCP-compatible client. Here are purpose-built companions:

- **[deribit-telegram-agent](https://github.com/schoeffeljp/deribit-telegram-agent)** — Conversational Telegram bot powered by Claude. Connects to this MCP server as a client for two-way trading, portfolio analysis, and strategy discussion on the go.

## License

MIT
