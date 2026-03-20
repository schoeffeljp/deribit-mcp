import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeribitClient } from "../deribit-client.js";

export function registerPrivateTools(server: McpServer, client: DeribitClient) {
  // ── Get Account Summary ─────────────────────────────────────────────
  server.tool(
    "get_account_summary",
    "Get account balance, equity, margin usage, and P&L summary for a currency.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      extended: z.boolean().optional().describe("Include additional fields (default false)"),
    },
    async ({ currency, extended }) => {
      const params: Record<string, unknown> = { currency };
      if (extended !== undefined) params.extended = extended;

      const result = await client.callPrivate("private/get_account_summary", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Positions ───────────────────────────────────────────────────
  server.tool(
    "get_positions",
    "Get all open positions, including size, direction, P&L, average price, and greeks for options.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Filter by instrument type"),
    },
    async ({ currency, kind }) => {
      const params: Record<string, unknown> = { currency };
      if (kind) params.kind = kind;

      const result = await client.callPrivate("private/get_positions", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Open Orders ─────────────────────────────────────────────────
  server.tool(
    "get_open_orders",
    "List all open (unfilled) orders, optionally filtered by currency or instrument type.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Filter by instrument type"),
    },
    async ({ currency, kind }) => {
      const params: Record<string, unknown> = { currency };
      if (kind) params.kind = kind;

      const result = await client.callPrivate("private/get_open_orders_by_currency", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Buy ─────────────────────────────────────────────────────────────
  server.tool(
    "buy",
    "Place a buy order on Deribit. Supports limit, market, stop_limit, and stop_market order types. Use with caution — this places a real trade.",
    {
      instrument_name: z.string().describe("Instrument name (e.g. 'BTC-28MAR25-80000-C')"),
      amount: z.number().describe("Order size in contracts"),
      type: z.enum(["limit", "market", "stop_limit", "stop_market"]).optional().describe("Order type (default 'limit')"),
      price: z.number().optional().describe("Order price (required for limit orders)"),
      time_in_force: z.enum(["good_til_cancelled", "good_til_day", "fill_or_kill", "immediate_or_cancel"]).optional().describe("Time in force"),
      post_only: z.boolean().optional().describe("Post-only order (maker only)"),
      reduce_only: z.boolean().optional().describe("Reduce-only order"),
      label: z.string().optional().describe("User-defined label for the order"),
    },
    async ({ instrument_name, amount, type, price, time_in_force, post_only, reduce_only, label }) => {
      const params: Record<string, unknown> = { instrument_name, amount };
      if (type) params.type = type;
      if (price !== undefined) params.price = price;
      if (time_in_force) params.time_in_force = time_in_force;
      if (post_only !== undefined) params.post_only = post_only;
      if (reduce_only !== undefined) params.reduce_only = reduce_only;
      if (label) params.label = label;

      const result = await client.callPrivate("private/buy", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Sell ────────────────────────────────────────────────────────────
  server.tool(
    "sell",
    "Place a sell order on Deribit. Supports limit, market, stop_limit, and stop_market order types. Use with caution — this places a real trade.",
    {
      instrument_name: z.string().describe("Instrument name (e.g. 'BTC-28MAR25-80000-C')"),
      amount: z.number().describe("Order size in contracts"),
      type: z.enum(["limit", "market", "stop_limit", "stop_market"]).optional().describe("Order type (default 'limit')"),
      price: z.number().optional().describe("Order price (required for limit orders)"),
      time_in_force: z.enum(["good_til_cancelled", "good_til_day", "fill_or_kill", "immediate_or_cancel"]).optional().describe("Time in force"),
      post_only: z.boolean().optional().describe("Post-only order (maker only)"),
      reduce_only: z.boolean().optional().describe("Reduce-only order"),
      label: z.string().optional().describe("User-defined label for the order"),
    },
    async ({ instrument_name, amount, type, price, time_in_force, post_only, reduce_only, label }) => {
      const params: Record<string, unknown> = { instrument_name, amount };
      if (type) params.type = type;
      if (price !== undefined) params.price = price;
      if (time_in_force) params.time_in_force = time_in_force;
      if (post_only !== undefined) params.post_only = post_only;
      if (reduce_only !== undefined) params.reduce_only = reduce_only;
      if (label) params.label = label;

      const result = await client.callPrivate("private/sell", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Cancel Order ────────────────────────────────────────────────────
  server.tool(
    "cancel_order",
    "Cancel an open order by its order ID.",
    {
      order_id: z.string().describe("The order ID to cancel"),
    },
    async ({ order_id }) => {
      const result = await client.callPrivate("private/cancel", { order_id });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Cancel All Orders ───────────────────────────────────────────────
  server.tool(
    "cancel_all_orders",
    "Cancel all open orders, optionally filtered by currency and instrument type.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).optional().describe("Cancel only orders for this currency"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Filter by instrument type"),
    },
    async ({ currency, kind }) => {
      if (currency) {
        const params: Record<string, unknown> = { currency };
        if (kind) params.kind = kind;
        const result = await client.callPrivate("private/cancel_all_by_currency", params);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      const result = await client.callPrivate("private/cancel_all");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Edit Order ────────────────────────────────────────────────────
  server.tool(
    "edit_order",
    "Modify an existing open order's price, amount, or other parameters without cancelling and re-placing.",
    {
      order_id: z.string().describe("The order ID to edit"),
      amount: z.number().optional().describe("New order size"),
      price: z.number().optional().describe("New order price"),
      post_only: z.boolean().optional().describe("Post-only flag"),
      reduce_only: z.boolean().optional().describe("Reduce-only flag"),
      trigger_price: z.number().optional().describe("New trigger price for stop/take-profit orders"),
    },
    async ({ order_id, amount, price, post_only, reduce_only, trigger_price }) => {
      const params: Record<string, unknown> = { order_id };
      if (amount !== undefined) params.amount = amount;
      if (price !== undefined) params.price = price;
      if (post_only !== undefined) params.post_only = post_only;
      if (reduce_only !== undefined) params.reduce_only = reduce_only;
      if (trigger_price !== undefined) params.trigger_price = trigger_price;

      const result = await client.callPrivate("private/edit", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Close Position ────────────────────────────────────────────────
  server.tool(
    "close_position",
    "Close an existing position entirely. Places a market or limit order to flatten the position.",
    {
      instrument_name: z.string().describe("Instrument name of the position to close"),
      type: z.enum(["limit", "market"]).describe("Order type for closing"),
      price: z.number().optional().describe("Limit price (required if type is 'limit')"),
    },
    async ({ instrument_name, type, price }) => {
      const params: Record<string, unknown> = { instrument_name, type };
      if (price !== undefined) params.price = price;

      const result = await client.callPrivate("private/close_position", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get User Trades ───────────────────────────────────────────────
  server.tool(
    "get_user_trades",
    "Get recent trade executions/fills for a currency. Shows trade price, size, fees, P&L, and IV for options trades.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      kind: z.enum(["future", "option", "spot", "future_combo", "option_combo"]).optional().describe("Filter by instrument type"),
      count: z.number().optional().describe("Number of trades to return (1-1000, default 10)"),
      start_timestamp: z.number().optional().describe("Start timestamp in ms"),
      end_timestamp: z.number().optional().describe("End timestamp in ms"),
      sorting: z.enum(["asc", "desc", "default"]).optional().describe("Sort order"),
    },
    async ({ currency, kind, count, start_timestamp, end_timestamp, sorting }) => {
      const params: Record<string, unknown> = { currency };
      if (kind) params.kind = kind;
      if (count !== undefined) params.count = count;
      if (start_timestamp !== undefined) params.start_timestamp = start_timestamp;
      if (end_timestamp !== undefined) params.end_timestamp = end_timestamp;
      if (sorting) params.sorting = sorting;

      const result = await client.callPrivate("private/get_user_trades_by_currency", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Transaction Log ───────────────────────────────────────────
  server.tool(
    "get_transaction_log",
    "Get the full ledger of account transactions: trades, settlements, fees, funding payments, deposits, withdrawals, and transfers.",
    {
      currency: z.enum(["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"]).describe("Currency"),
      start_timestamp: z.number().describe("Start timestamp in milliseconds since epoch"),
      end_timestamp: z.number().describe("End timestamp in milliseconds since epoch"),
      query: z.enum(["trade", "maker", "taker", "open", "close", "liquidation", "buy", "sell", "withdrawal", "delivery", "settlement", "deposit", "transfer", "option", "future", "correction", "block_trade", "swap"]).optional().describe("Filter by transaction type"),
      count: z.number().optional().describe("Number of entries (default 100, max 250)"),
      continuation: z.number().optional().describe("Continuation token for pagination"),
    },
    async ({ currency, start_timestamp, end_timestamp, query, count, continuation }) => {
      const params: Record<string, unknown> = { currency, start_timestamp, end_timestamp };
      if (query) params.query = query;
      if (count !== undefined) params.count = count;
      if (continuation !== undefined) params.continuation = continuation;

      const result = await client.callPrivate("private/get_transaction_log", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Margins ───────────────────────────────────────────────────
  server.tool(
    "get_margins",
    "Estimate the margin required for a hypothetical trade before placing it. Returns margin for both buy and sell sides, plus min/max price bounds.",
    {
      instrument_name: z.string().describe("Instrument name"),
      amount: z.number().describe("Order size"),
      price: z.number().describe("Order price"),
    },
    async ({ instrument_name, amount, price }) => {
      const result = await client.callPrivate("private/get_margins", {
        instrument_name, amount, price,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
