import { describe, it, expect } from "vitest";
import { client, describePrivate } from "./setup.js";

describe("DeribitClient — public", () => {
  it("makes a public API call", async () => {
    const result = await client.callPublic("public/get_index_price", {
      index_name: "btc_usd",
    });
    expect(result).toHaveProperty("index_price");
    expect(typeof result.index_price).toBe("number");
    expect(result.index_price).toBeGreaterThan(0);
  });

  it("throws on invalid public method", async () => {
    await expect(
      client.callPublic("public/nonexistent_method")
    ).rejects.toThrow();
  });
});

describePrivate("DeribitClient — private", () => {
  it("authenticates and makes a private API call", async () => {
    const result = await client.callPrivate("private/get_account_summary", {
      currency: "BTC",
    });
    expect(result).toHaveProperty("equity");
    expect(result).toHaveProperty("balance");
    expect(result).toHaveProperty("currency");
    expect(result.currency).toBe("BTC");
  });
});
