import { it, expect } from "vitest";
import { client, describePrivate } from "./setup.js";

describePrivate("Private API tools", () => {
  it("get_account_summary — returns account info", async () => {
    const result = await client.callPrivate("private/get_account_summary", {
      currency: "BTC",
    });
    expect(result).toHaveProperty("currency", "BTC");
    expect(result).toHaveProperty("equity");
    expect(result).toHaveProperty("balance");
    expect(result).toHaveProperty("initial_margin");
    expect(result).toHaveProperty("maintenance_margin");
  });

  it("get_account_summary extended — includes P&L fields", async () => {
    const result = await client.callPrivate("private/get_account_summary", {
      currency: "BTC",
      extended: true,
    });
    expect(result).toHaveProperty("equity");
    expect(result).toHaveProperty("available_funds");
  });

  it("get_positions — returns array (possibly empty)", async () => {
    const result = await client.callPrivate("private/get_positions", {
      currency: "BTC",
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_positions — option filter works", async () => {
    const result = await client.callPrivate("private/get_positions", {
      currency: "BTC",
      kind: "option",
    });
    expect(Array.isArray(result)).toBe(true);
    // All returned positions should be options
    for (const pos of result) {
      expect(pos.kind).toBe("option");
    }
  });

  it("get_open_orders — returns array", async () => {
    const result = await client.callPrivate("private/get_open_orders_by_currency", {
      currency: "BTC",
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_user_trades — returns trades structure", async () => {
    const result = await client.callPrivate("private/get_user_trades_by_currency", {
      currency: "BTC",
      count: 5,
    });
    expect(result).toHaveProperty("trades");
    expect(result).toHaveProperty("has_more");
    expect(Array.isArray(result.trades)).toBe(true);
  });

  it("get_transaction_log — returns logs structure", async () => {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const result = await client.callPrivate("private/get_transaction_log", {
      currency: "BTC",
      start_timestamp: oneWeekAgo,
      end_timestamp: now,
      count: 5,
    });
    expect(result).toHaveProperty("logs");
    expect(Array.isArray(result.logs)).toBe(true);
  });

  it("get_margins — returns margin estimate", async () => {
    // Use BTC-PERPETUAL which always exists
    const ticker = await client.callPublic("public/ticker", {
      instrument_name: "BTC-PERPETUAL",
    });
    const result = await client.callPrivate("private/get_margins", {
      instrument_name: "BTC-PERPETUAL",
      amount: 10, // 10 USD for perpetual
      price: ticker.mark_price,
    });
    expect(result).toHaveProperty("buy");
    expect(result).toHaveProperty("sell");
    expect(typeof result.buy).toBe("number");
    expect(typeof result.sell).toBe("number");
  });
});
