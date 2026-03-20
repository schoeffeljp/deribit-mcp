# deribit-mcp

An MCP (Model Context Protocol) server that connects AI assistants to the [Deribit](https://www.deribit.com) cryptocurrency derivatives exchange. Get options chains, analyze volatility surfaces, manage positions, and execute trades — all through natural language.

Works with Claude Desktop, Claude Code, or any MCP-compatible client.

## What you can do

- **Explore the options market** — list expirations, pull full options chains with greeks and IV, scan the volatility surface
- **Find opportunities** — search by delta, compare implied vs historical vol, check funding rates
- **Trade** — place/edit/cancel orders, close positions, estimate margin before trading
- **Monitor your portfolio** — one-shot account overview, aggregated greeks, P&L, transaction history

## Quick start

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

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
DERIBIT_CLIENT_ID=your_client_id
DERIBIT_CLIENT_SECRET=your_client_secret
DERIBIT_TESTNET=true
```

### 4. Add to Claude Desktop

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

Restart Claude Desktop. The deribit tools will appear in your conversation.

## Tools

### Market Data (public — no auth needed)

| Tool | Description |
|------|-------------|
| `get_currencies` | List all available currencies on Deribit |
| `get_instruments` | List tradable instruments (options, futures, spots) for a currency |
| `get_ticker` | Real-time quote with greeks, IV, bid/ask, mark price |
| `get_order_book` | Bid/ask depth for an instrument |
| `get_book_summary_by_currency` | Market-wide summary (volume, OI, prices) for all instruments |
| `get_index_price` | Current index price (e.g. btc_usd) |
| `get_historical_volatility` | Historical volatility data points over time |
| `get_volatility_index` | DVOL (Deribit's VIX) OHLCV data |
| `get_tradingview_chart_data` | OHLCV candlestick data for any instrument |
| `get_funding_rate_history` | Perpetual funding rate history |
| `get_delivery_prices` | Historical settlement/delivery prices |

### Account & Trading (private — requires auth)

| Tool | Description |
|------|-------------|
| `get_account_summary` | Balance, equity, margin usage, P&L |
| `get_positions` | All open positions with greeks and P&L |
| `get_open_orders` | Pending orders |
| `buy` / `sell` | Place orders (limit, market, stop) |
| `edit_order` | Modify an existing order |
| `cancel_order` / `cancel_all_orders` | Cancel orders |
| `close_position` | Flatten a position with market or limit |
| `get_user_trades` | Trade execution/fill history |
| `get_transaction_log` | Full ledger (trades, settlements, fees, funding, deposits) |
| `get_margins` | Estimate margin for a hypothetical trade |

### Workflow Tools (composite — chain multiple API calls)

| Tool | Description |
|------|-------------|
| `get_expirations` | All available expiry dates with strike counts |
| `get_options_chain` | Full chain for an expiry: all strikes with bid/ask, IV, greeks, OI |
| `find_options_by_delta` | Find options closest to a target delta (e.g. "25-delta put") |
| `get_volatility_surface` | IV across all strikes and expirations with ATM IV per expiry |
| `get_portfolio_greeks` | Aggregated delta/gamma/vega/theta across all option positions |
| `get_portfolio_summary` | One-shot account overview: balances + positions + orders |

## Example prompts

Once configured, try asking Claude:

- *"Show me all BTC option expirations and how many strikes each has"*
- *"Get the full options chain for BTC March expiry"*
- *"Find the 25-delta put for ETH nearest expiry"*
- *"What's the current BTC volatility surface look like?"*
- *"Give me a full portfolio summary for my BTC account"*
- *"What's my total delta and vega exposure across all positions?"*
- *"How much margin would I need to buy 1 BTC-PERPETUAL at market?"*
- *"Show me BTC-PERPETUAL funding rates for the last 24 hours"*

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

## Architecture

```
src/
├── index.ts              # MCP server entry point (stdio transport)
├── deribit-client.ts     # JSON-RPC client with auto-auth
└── tools/
    ├── public.ts         # Market data tools (no auth)
    ├── private.ts        # Account & trading tools (auth required)
    └── workflow.ts       # Composite tools (chain multiple calls)
```

The server uses stdio transport — Claude Desktop spawns and manages the process automatically. All Deribit communication is over HTTPS to the JSON-RPC v2 API.

## Switching to mainnet

Set `DERIBIT_TESTNET=false` (or remove it) in your `.env` or Claude Desktop config. **Use mainnet with caution — trading tools place real orders with real money.**

## License

MIT
