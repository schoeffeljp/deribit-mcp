import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeribitClient } from "../deribit-client.js";

export function registerPublicTools(server: McpServer, client: DeribitClient) {
  // ── Get Currencies ──────────────────────────────────────────────────
  server.tool(
    "get_currencies",
    "List all available currencies on Deribit",
    {},
    async () => {
      const result = await client.callPublic("public/get_currencies");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Instruments ─────────────────────────────────────────────────
  server.tool(
    "get_instruments",
    "List tradable instruments (options, futures, spots) for a currency. Returns instrument names, strike prices, expiration dates, and contract details. Essential for discovering available options chains.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency to get instruments for"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Instrument type filter"),
      expired: z.boolean().optional().describe("Include expired instruments (default false)"),
    },
    async ({ currency, kind, expired }) => {
      const params: Record<string, unknown> = { currency };
      if (kind) params.kind = kind;
      if (expired !== undefined) params.expired = expired;

      const result = await client.callPublic("public/get_instruments", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Ticker ──────────────────────────────────────────────────────
  server.tool(
    "get_ticker",
    "Get real-time quote data for an instrument. For options, includes greeks (delta, gamma, vega, theta, rho), implied volatility, mark price, bid/ask, open interest, and volume.",
    {
      instrument_name: z.string().describe("Instrument name (e.g. 'BTC-28MAR25-80000-C', 'BTC-PERPETUAL')"),
    },
    async ({ instrument_name }) => {
      const result = await client.callPublic("public/ticker", { instrument_name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Order Book ──────────────────────────────────────────────────
  server.tool(
    "get_order_book",
    "Get the order book (bids and asks) for an instrument, including best bid/ask, mark price, and funding rate for perpetuals.",
    {
      instrument_name: z.string().describe("Instrument name"),
      depth: z.number().optional().describe("Number of price levels (1, 5, 10, 20, 50, 100, 1000, 10000)"),
    },
    async ({ instrument_name, depth }) => {
      const params: Record<string, unknown> = { instrument_name };
      if (depth !== undefined) params.depth = depth;

      const result = await client.callPublic("public/get_order_book", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Book Summary by Currency ────────────────────────────────────
  server.tool(
    "get_book_summary_by_currency",
    "Get summary info (volume, open interest, bid/ask, mark price) for all instruments of a currency. Useful for scanning the entire options or futures market at a glance.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Instrument type filter"),
    },
    async ({ currency, kind }) => {
      const params: Record<string, unknown> = { currency };
      if (kind) params.kind = kind;

      const result = await client.callPublic("public/get_book_summary_by_currency", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Index Price ─────────────────────────────────────────────────
  server.tool(
    "get_index_price",
    "Get the current index price for a given underlying index (e.g. btc_usd, eth_usd).",
    {
      index_name: z.string().describe("Index name (e.g. 'btc_usd', 'eth_usd', 'sol_usd')"),
    },
    async ({ index_name }) => {
      const result = await client.callPublic("public/get_index_price", { index_name });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Historical Volatility ─────────────────────────────────────
  server.tool(
    "get_historical_volatility",
    "Get historical volatility data points for a currency index over time.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
    },
    async ({ currency }) => {
      const result = await client.callPublic("public/get_historical_volatility", { currency });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Volatility Index (DVOL) ───────────────────────────────────
  server.tool(
    "get_volatility_index",
    "Get DVOL (Deribit Volatility Index) OHLCV data — Deribit's equivalent of the VIX. Shows implied volatility trend over time.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      start_timestamp: z.number().describe("Start timestamp in milliseconds since epoch"),
      end_timestamp: z.number().describe("End timestamp in milliseconds since epoch"),
      resolution: z.enum(["1", "60", "3600", "43200", "1D"]).describe("Resolution: 1s, 1min, 1h, 12h, or 1D"),
    },
    async ({ currency, start_timestamp, end_timestamp, resolution }) => {
      const result = await client.callPublic("public/get_volatility_index_data", {
        currency, start_timestamp, end_timestamp, resolution,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get TradingView Chart Data (OHLCV) ────────────────────────────
  server.tool(
    "get_tradingview_chart_data",
    "Get OHLCV candlestick data for any instrument. Useful for price charts, technical analysis, and historical price research.",
    {
      instrument_name: z.string().describe("Instrument name (e.g. 'BTC-PERPETUAL', 'ETH-28MAR25-2000-C')"),
      start_timestamp: z.number().describe("Start timestamp in milliseconds since epoch"),
      end_timestamp: z.number().describe("End timestamp in milliseconds since epoch"),
      resolution: z.enum(["1", "3", "5", "10", "15", "30", "60", "120", "180", "360", "720", "1D"]).describe("Candle resolution in minutes, or '1D' for daily"),
    },
    async ({ instrument_name, start_timestamp, end_timestamp, resolution }) => {
      const result = await client.callPublic("public/get_tradingview_chart_data", {
        instrument_name, start_timestamp, end_timestamp, resolution,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Funding Rate History ──────────────────────────────────────
  server.tool(
    "get_funding_rate_history",
    "Get historical funding rate data for a perpetual instrument. Shows hourly funding rates, index prices, and interest rates.",
    {
      instrument_name: z.string().describe("Perpetual instrument name (e.g. 'BTC-PERPETUAL')"),
      start_timestamp: z.number().describe("Start timestamp in milliseconds since epoch"),
      end_timestamp: z.number().describe("End timestamp in milliseconds since epoch"),
    },
    async ({ instrument_name, start_timestamp, end_timestamp }) => {
      const result = await client.callPublic("public/get_funding_rate_history", {
        instrument_name, start_timestamp, end_timestamp,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Delivery Prices ───────────────────────────────────────────
  server.tool(
    "get_delivery_prices",
    "Get historical settlement/delivery prices for an index. Useful for backtesting and understanding past expiry outcomes.",
    {
      index_name: z.string().describe("Index name (e.g. 'btc_usd', 'eth_usd')"),
      offset: z.number().optional().describe("Pagination offset (default 0)"),
      count: z.number().optional().describe("Number of records (1-1000, default 10)"),
    },
    async ({ index_name, offset, count }) => {
      const params: Record<string, unknown> = { index_name };
      if (offset !== undefined) params.offset = offset;
      if (count !== undefined) params.count = count;

      const result = await client.callPublic("public/get_delivery_prices", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
