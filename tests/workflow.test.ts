import { describe, it, expect } from "vitest";
import { client, getFirstBtcExpiry, describePrivate } from "./setup.js";

describe("Workflow tools — public", () => {
  it("get_expirations — lists BTC option expiries", async () => {
    const instruments: any[] = await client.callPublic("public/get_instruments", {
      currency: "BTC",
      kind: "option",
      expired: false,
    });

    const expirySet = new Set<string>();
    for (const inst of instruments) {
      expirySet.add(inst.instrument_name.split("-")[1]);
    }

    expect(expirySet.size).toBeGreaterThan(0);
  });

  it("get_options_chain — returns strike/call/put structure", async () => {
    const { expiry } = await getFirstBtcExpiry();

    // Fetch instruments for this expiry
    const instruments: any[] = await client.callPublic("public/get_instruments", {
      currency: "BTC",
      kind: "option",
      expired: false,
    });

    const filtered = instruments.filter((i) => i.instrument_name.split("-")[1] === expiry);
    expect(filtered.length).toBeGreaterThan(0);

    // Fetch one ticker to validate data shape
    const ticker = await client.callPublic("public/ticker", {
      instrument_name: filtered[0].instrument_name,
    });
    expect(ticker).toHaveProperty("instrument_name");
    expect(ticker).toHaveProperty("mark_price");
    expect(ticker).toHaveProperty("greeks");
  });

  it("find_options_by_delta — ticker has greeks for delta search", async () => {
    const { expiry } = await getFirstBtcExpiry();

    const instruments: any[] = await client.callPublic("public/get_instruments", {
      currency: "BTC",
      kind: "option",
      expired: false,
    });

    const calls = instruments.filter(
      (i) => i.instrument_name.split("-")[1] === expiry && i.instrument_name.endsWith("-C")
    );
    expect(calls.length).toBeGreaterThan(0);

    // Fetch a ticker and check greeks exist
    const ticker = await client.callPublic("public/ticker", {
      instrument_name: calls[0].instrument_name,
    });
    expect(ticker.greeks).toBeDefined();
    expect(typeof ticker.greeks.delta).toBe("number");
  });

  it("get_volatility_surface — book summaries have IV data", async () => {
    const summaries: any[] = await client.callPublic("public/get_book_summary_by_currency", {
      currency: "BTC",
      kind: "option",
    });
    expect(summaries.length).toBeGreaterThan(0);
    // At least some should have mark_iv
    const withIv = summaries.filter((s) => s.mark_iv != null);
    expect(withIv.length).toBeGreaterThan(0);
  });

});

describePrivate("Workflow tools — private", () => {
  it("get_portfolio_greeks — positions endpoint works", async () => {
    const positions: any[] = await client.callPrivate("private/get_positions", {
      currency: "BTC",
      kind: "option",
    });
    expect(Array.isArray(positions)).toBe(true);
    for (const pos of positions) {
      expect(pos).toHaveProperty("instrument_name");
      expect(pos).toHaveProperty("size");
    }
  });

  it("get_portfolio_summary — parallel fetch works", async () => {
    const [account, positions, orders] = await Promise.all([
      client.callPrivate("private/get_account_summary", { currency: "BTC", extended: true }),
      client.callPrivate("private/get_positions", { currency: "BTC" }),
      client.callPrivate("private/get_open_orders_by_currency", { currency: "BTC" }),
    ]);

    expect(account).toHaveProperty("equity");
    expect(account).toHaveProperty("balance");
    expect(Array.isArray(positions)).toBe(true);
    expect(Array.isArray(orders)).toBe(true);
  });
});
