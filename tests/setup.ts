/**
 * Shared test setup: creates a real DeribitClient pointing at testnet.
 * Requires DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET env vars for private tests.
 */
import { config } from "dotenv";
config(); // load .env at project root

// Force testnet for tests
process.env.DERIBIT_TESTNET = "true";

import { DeribitClient } from "../src/deribit-client.js";

export const client = new DeribitClient();

/** Whether valid credentials are configured (for skipping private tests in CI). */
export const hasCredentials = !!(process.env.DERIBIT_CLIENT_ID && process.env.DERIBIT_CLIENT_SECRET);

/** Use in describe blocks: `describePrivate(...)` skips when no credentials. */
import { describe } from "vitest";
export const describePrivate = hasCredentials ? describe : describe.skip;

/** Helper: pick a valid BTC option expiry from the live instrument list. */
export async function getFirstBtcExpiry(): Promise<{ expiry: string; instrument: string }> {
  const instruments: any[] = await client.callPublic("public/get_instruments", {
    currency: "BTC",
    kind: "option",
    expired: false,
  });

  if (instruments.length === 0) throw new Error("No BTC options on testnet");

  // Pick the nearest expiry
  instruments.sort((a: any, b: any) => a.expiration_timestamp - b.expiration_timestamp);
  const first = instruments[0];
  const expiry = first.instrument_name.split("-")[1];
  return { expiry, instrument: first.instrument_name };
}
