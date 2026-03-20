import { describe, it, expect } from "vitest";
import { client } from "./setup.js";

describe("Public API tools", () => {
  it("get_currencies — returns a non-empty list", async () => {
    const result = await client.callPublic("public/get_currencies");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("currency");
  });

  it("get_instruments — lists BTC options", async () => {
    const result = await client.callPublic("public/get_instruments", {
      currency: "BTC",
      kind: "option",
      expired: false,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("instrument_name");
    expect(result[0].instrument_name).toContain("BTC");
  });

  it("get_ticker — returns quote data for BTC-PERPETUAL", async () => {
    const result = await client.callPublic("public/ticker", {
      instrument_name: "BTC-PERPETUAL",
    });
    expect(result).toHaveProperty("instrument_name", "BTC-PERPETUAL");
    expect(result).toHaveProperty("last_price");
    expect(result).toHaveProperty("best_bid_price");
    expect(result).toHaveProperty("best_ask_price");
    expect(result).toHaveProperty("mark_price");
  });

  it("get_order_book — returns bids and asks", async () => {
    const result = await client.callPublic("public/get_order_book", {
      instrument_name: "BTC-PERPETUAL",
      depth: 5,
    });
    expect(result).toHaveProperty("bids");
    expect(result).toHaveProperty("asks");
    expect(result).toHaveProperty("instrument_name", "BTC-PERPETUAL");
  });

  it("get_book_summary_by_currency — returns summaries", async () => {
    const result = await client.callPublic("public/get_book_summary_by_currency", {
      currency: "BTC",
      kind: "future",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("instrument_name");
  });

  it("get_index_price — returns a price", async () => {
    const result = await client.callPublic("public/get_index_price", {
      index_name: "btc_usd",
    });
    expect(result).toHaveProperty("index_price");
    expect(result.index_price).toBeGreaterThan(0);
  });

  it("get_historical_volatility — returns data points", async () => {
    const result = await client.callPublic("public/get_historical_volatility", {
      currency: "BTC",
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Each entry is [timestamp, value]
    expect(Array.isArray(result[0])).toBe(true);
  });

  it("get_volatility_index_data — returns DVOL candles", async () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const result = await client.callPublic("public/get_volatility_index_data", {
      currency: "BTC",
      start_timestamp: oneDayAgo,
      end_timestamp: now,
      resolution: "3600",
    });
    expect(result).toHaveProperty("data");
    expect(Array.isArray(result.data)).toBe(true);
  });

  it("get_tradingview_chart_data — returns OHLCV", async () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const result = await client.callPublic("public/get_tradingview_chart_data", {
      instrument_name: "BTC-PERPETUAL",
      start_timestamp: oneDayAgo,
      end_timestamp: now,
      resolution: "60",
    });
    expect(result).toHaveProperty("ticks");
    expect(result).toHaveProperty("open");
    expect(result).toHaveProperty("close");
    expect(result).toHaveProperty("volume");
  });

  it("get_funding_rate_history — returns funding data", async () => {
    const now = Date.now();
    const eightHoursAgo = now - 8 * 60 * 60 * 1000;
    const result = await client.callPublic("public/get_funding_rate_history", {
      instrument_name: "BTC-PERPETUAL",
      start_timestamp: eightHoursAgo,
      end_timestamp: now,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("get_delivery_prices — returns settlement history", async () => {
    const result = await client.callPublic("public/get_delivery_prices", {
      index_name: "btc_usd",
      count: 5,
    });
    expect(result).toHaveProperty("data");
    expect(Array.isArray(result.data)).toBe(true);
    expect(result).toHaveProperty("records_total");
  });
});
