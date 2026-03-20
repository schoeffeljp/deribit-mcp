import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeribitClient } from "../deribit-client.js";

const CURRENCIES = ["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"] as const;

export function registerWorkflowTools(server: McpServer, client: DeribitClient) {
  // ── Get Expirations ───────────────────────────────────────────────
  server.tool(
    "get_expirations",
    "List all available expiration dates for a currency's options, sorted chronologically. Returns expiry strings (e.g. '28MAR25') and the number of strikes available for each.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
    },
    async ({ currency }) => {
      const instruments: any[] = await client.callPublic("public/get_instruments", {
        currency,
        kind: "option",
        expired: false,
      });

      const expiryMap = new Map<string, number>();
      for (const inst of instruments) {
        // instrument_name format: BTC-28MAR25-80000-C
        const parts = inst.instrument_name.split("-");
        const expiry = parts[1];
        expiryMap.set(expiry, (expiryMap.get(expiry) ?? 0) + 1);
      }

      // Sort by expiration_timestamp from instruments
      const expiryDates = new Map<string, number>();
      for (const inst of instruments) {
        const expiry = inst.instrument_name.split("-")[1];
        if (!expiryDates.has(expiry)) {
          expiryDates.set(expiry, inst.expiration_timestamp);
        }
      }

      const sorted = [...expiryMap.entries()]
        .sort((a, b) => (expiryDates.get(a[0]) ?? 0) - (expiryDates.get(b[0]) ?? 0))
        .map(([expiry, count]) => ({
          expiry,
          expiration_timestamp: expiryDates.get(expiry),
          num_strikes: Math.floor(count / 2), // calls + puts
        }));

      return {
        content: [{ type: "text", text: JSON.stringify(sorted, null, 2) }],
      };
    }
  );

  // ── Get Options Chain ─────────────────────────────────────────────
  server.tool(
    "get_options_chain",
    "Get the full options chain for a currency and expiration in a single call. Returns all strikes with bid/ask, mark price, IV, greeks (delta, gamma, vega, theta), and open interest for both calls and puts. This is the primary tool for options analysis.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
      expiry: z.string().describe("Expiration date string (e.g. '28MAR25'). Use get_expirations to list available dates."),
    },
    async ({ currency, expiry }) => {
      // Step 1: Get all option instruments for this currency
      const instruments: any[] = await client.callPublic("public/get_instruments", {
        currency,
        kind: "option",
        expired: false,
      });

      // Filter to the requested expiry
      const filtered = instruments.filter((inst) => {
        const parts = inst.instrument_name.split("-");
        return parts[1] === expiry;
      });

      if (filtered.length === 0) {
        return {
          content: [{ type: "text", text: `No options found for ${currency} expiry ${expiry}` }],
        };
      }

      // Step 2: Fetch tickers in parallel (batch of concurrent requests)
      const tickerPromises = filtered.map((inst) =>
        client.callPublic("public/ticker", { instrument_name: inst.instrument_name })
          .catch((err) => ({ instrument_name: inst.instrument_name, error: err.message }))
      );
      const tickers = await Promise.all(tickerPromises);

      // Step 3: Organize by strike into a chain structure
      const strikeMap = new Map<number, { call?: any; put?: any }>();
      for (const ticker of tickers) {
        if ((ticker as any).error) continue;
        const parts = ticker.instrument_name.split("-");
        const strike = Number(parts[2]);
        const type = parts[3]; // C or P

        if (!strikeMap.has(strike)) strikeMap.set(strike, {});
        const row = strikeMap.get(strike)!;

        const summary = {
          instrument_name: ticker.instrument_name,
          mark_price: ticker.mark_price,
          mark_iv: ticker.mark_iv,
          bid_price: ticker.best_bid_price,
          bid_amount: ticker.best_bid_amount,
          ask_price: ticker.best_ask_price,
          ask_amount: ticker.best_ask_amount,
          delta: ticker.greeks?.delta,
          gamma: ticker.greeks?.gamma,
          vega: ticker.greeks?.vega,
          theta: ticker.greeks?.theta,
          rho: ticker.greeks?.rho,
          open_interest: ticker.open_interest,
          volume: ticker.stats?.volume,
          underlying_price: ticker.underlying_price,
          underlying_index: ticker.underlying_index,
        };

        if (type === "C") row.call = summary;
        else row.put = summary;
      }

      // Sort by strike
      const chain = [...strikeMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([strike, { call, put }]) => ({ strike, call, put }));

      const result = {
        currency,
        expiry,
        expiration_timestamp: filtered[0].expiration_timestamp,
        num_strikes: chain.length,
        underlying_price: chain[0]?.call?.underlying_price ?? chain[0]?.put?.underlying_price,
        chain,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Find Options by Delta ─────────────────────────────────────────
  server.tool(
    "find_options_by_delta",
    "Find options closest to a target delta for a given currency and expiry. E.g., 'find the 25-delta put' or 'find the 50-delta call'. Returns the best matching options sorted by delta proximity.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
      expiry: z.string().describe("Expiration date string (e.g. '28MAR25')"),
      target_delta: z.number().describe("Target delta value (e.g. 0.25 for 25-delta call, -0.25 for 25-delta put). Calls are positive (0 to 1), puts are negative (-1 to 0)."),
      num_results: z.number().optional().describe("Number of closest matches to return (default 3)"),
    },
    async ({ currency, expiry, target_delta, num_results }) => {
      const limit = num_results ?? 3;

      // Get instruments for this expiry
      const instruments: any[] = await client.callPublic("public/get_instruments", {
        currency,
        kind: "option",
        expired: false,
      });

      const filtered = instruments.filter((inst) => {
        const parts = inst.instrument_name.split("-");
        return parts[1] === expiry;
      });

      // Further filter by type: if target_delta > 0 get calls, else puts
      const optionType = target_delta >= 0 ? "C" : "P";
      const typeFiltered = filtered.filter((inst) => inst.instrument_name.endsWith(`-${optionType}`));

      if (typeFiltered.length === 0) {
        return {
          content: [{ type: "text", text: `No ${optionType === "C" ? "call" : "put"} options found for ${currency} expiry ${expiry}` }],
        };
      }

      // Fetch tickers
      const tickerPromises = typeFiltered.map((inst) =>
        client.callPublic("public/ticker", { instrument_name: inst.instrument_name })
          .catch(() => null)
      );
      const tickers = (await Promise.all(tickerPromises)).filter(Boolean) as any[];

      // Sort by distance from target delta
      const withDelta = tickers
        .filter((t) => t.greeks?.delta != null)
        .map((t) => ({
          instrument_name: t.instrument_name,
          strike: Number(t.instrument_name.split("-")[2]),
          delta: t.greeks.delta,
          delta_distance: Math.abs(t.greeks.delta - target_delta),
          mark_price: t.mark_price,
          mark_iv: t.mark_iv,
          bid_price: t.best_bid_price,
          ask_price: t.best_ask_price,
          gamma: t.greeks.gamma,
          vega: t.greeks.vega,
          theta: t.greeks.theta,
          open_interest: t.open_interest,
          underlying_price: t.underlying_price,
        }))
        .sort((a, b) => a.delta_distance - b.delta_distance)
        .slice(0, limit);

      return {
        content: [{ type: "text", text: JSON.stringify(withDelta, null, 2) }],
      };
    }
  );

  // ── Get Volatility Surface ────────────────────────────────────────
  server.tool(
    "get_volatility_surface",
    "Get the implied volatility surface across all strikes and expirations for a currency. Returns a matrix of expiry × strike → IV, plus ATM IV and skew metrics per expiry. Essential for relative value analysis and vol trading.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
    },
    async ({ currency }) => {
      // Step 1: Get all option instruments
      const instruments: any[] = await client.callPublic("public/get_instruments", {
        currency,
        kind: "option",
        expired: false,
      });

      // Group by expiry
      const byExpiry = new Map<string, any[]>();
      for (const inst of instruments) {
        const expiry = inst.instrument_name.split("-")[1];
        if (!byExpiry.has(expiry)) byExpiry.set(expiry, []);
        byExpiry.get(expiry)!.push(inst);
      }

      // Step 2: For each expiry, get book summaries (lighter than individual tickers)
      // We'll use get_book_summary_by_currency and filter
      const allSummaries: any[] = await client.callPublic("public/get_book_summary_by_currency", {
        currency,
        kind: "option",
      });

      const summaryMap = new Map<string, any>();
      for (const s of allSummaries) {
        summaryMap.set(s.instrument_name, s);
      }

      // Step 3: Build the surface
      const expiryTimestamps = new Map<string, number>();
      for (const inst of instruments) {
        const expiry = inst.instrument_name.split("-")[1];
        if (!expiryTimestamps.has(expiry)) {
          expiryTimestamps.set(expiry, inst.expiration_timestamp);
        }
      }

      const surface = [...byExpiry.entries()]
        .sort((a, b) => (expiryTimestamps.get(a[0]) ?? 0) - (expiryTimestamps.get(b[0]) ?? 0))
        .map(([expiry, insts]) => {
          const strikes: { strike: number; type: string; iv: number | null; mark_price: number | null; open_interest: number | null }[] = [];

          for (const inst of insts) {
            const parts = inst.instrument_name.split("-");
            const strike = Number(parts[2]);
            const type = parts[3];
            const summary = summaryMap.get(inst.instrument_name);

            strikes.push({
              strike,
              type,
              iv: summary?.mark_iv ?? null,
              mark_price: summary?.mark_price ?? null,
              open_interest: summary?.open_interest ?? null,
            });
          }

          // Sort by strike
          strikes.sort((a, b) => a.strike - b.strike);

          // Compute ATM IV (closest strike to underlying)
          const callStrikes = strikes.filter((s) => s.type === "C" && s.iv != null);
          let atmIv: number | null = null;
          if (callStrikes.length > 0) {
            const underlying = allSummaries.find((s) => s.instrument_name.startsWith(`${currency}-${expiry}`))?.underlying_price;
            if (underlying) {
              const atm = callStrikes.reduce((closest, s) =>
                Math.abs(s.strike - underlying) < Math.abs(closest.strike - underlying) ? s : closest
              );
              atmIv = atm.iv;
            }
          }

          return {
            expiry,
            expiration_timestamp: expiryTimestamps.get(expiry),
            atm_iv: atmIv,
            strikes,
          };
        });

      return {
        content: [{ type: "text", text: JSON.stringify(surface, null, 2) }],
      };
    }
  );

  // ── Get Portfolio Greeks ──────────────────────────────────────────
  server.tool(
    "get_portfolio_greeks",
    "Get aggregated portfolio greeks across all open option positions for a currency. Shows total delta, gamma, vega, and theta exposure, plus per-position breakdown. Essential for understanding net risk.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
    },
    async ({ currency }) => {
      // Get all option positions
      const positions: any[] = await client.callPrivate("private/get_positions", {
        currency,
        kind: "option",
      });

      if (positions.length === 0) {
        return {
          content: [{ type: "text", text: JSON.stringify({ message: "No open option positions", currency, total: { delta: 0, gamma: 0, vega: 0, theta: 0 }, positions: [] }, null, 2) }],
        };
      }

      let totalDelta = 0;
      let totalGamma = 0;
      let totalVega = 0;
      let totalTheta = 0;

      const posDetails = positions.map((pos) => {
        const delta = (pos.delta ?? 0);
        const gamma = (pos.gamma ?? 0);
        const vega = (pos.vega ?? 0);
        const theta = (pos.theta ?? 0);

        totalDelta += delta;
        totalGamma += gamma;
        totalVega += vega;
        totalTheta += theta;

        return {
          instrument_name: pos.instrument_name,
          size: pos.size,
          direction: pos.direction,
          average_price: pos.average_price,
          mark_price: pos.mark_price,
          index_price: pos.index_price,
          realized_profit_loss: pos.realized_profit_loss,
          floating_profit_loss: pos.floating_profit_loss,
          total_profit_loss: pos.total_profit_loss,
          delta,
          gamma,
          vega,
          theta,
        };
      });

      const result = {
        currency,
        num_positions: positions.length,
        total: {
          delta: totalDelta,
          gamma: totalGamma,
          vega: totalVega,
          theta: totalTheta,
        },
        positions: posDetails,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ── Get Portfolio Summary ─────────────────────────────────────────
  server.tool(
    "get_portfolio_summary",
    "One-shot overview of your entire account for a currency: balances, margin usage, equity, all open positions with P&L, and all open orders. Saves multiple API calls into a single comprehensive snapshot.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
    },
    async ({ currency }) => {
      // Fetch all three in parallel
      const [account, positions, orders] = await Promise.all([
        client.callPrivate("private/get_account_summary", { currency, extended: true }),
        client.callPrivate("private/get_positions", { currency }),
        client.callPrivate("private/get_open_orders_by_currency", { currency }),
      ]);

      const result = {
        currency,
        account: {
          equity: account.equity,
          balance: account.balance,
          available_funds: account.available_funds,
          available_withdrawal_funds: account.available_withdrawal_funds,
          margin_balance: account.margin_balance,
          initial_margin: account.initial_margin,
          maintenance_margin: account.maintenance_margin,
          session_rpl: account.session_rpl,
          session_upl: account.session_upl,
          options_pl: account.options_pl,
          options_session_rpl: account.options_session_rpl,
          options_session_upl: account.options_session_upl,
          futures_pl: account.futures_pl,
          futures_session_rpl: account.futures_session_rpl,
          futures_session_upl: account.futures_session_upl,
          total_pl: account.total_pl,
          delta_total: account.delta_total,
          options_delta: account.options_delta,
          options_gamma: account.options_gamma,
          options_vega: account.options_vega,
          options_theta: account.options_theta,
        },
        positions: positions.map((p: any) => ({
          instrument_name: p.instrument_name,
          kind: p.kind,
          size: p.size,
          direction: p.direction,
          average_price: p.average_price,
          mark_price: p.mark_price,
          realized_profit_loss: p.realized_profit_loss,
          floating_profit_loss: p.floating_profit_loss,
          total_profit_loss: p.total_profit_loss,
          delta: p.delta,
          gamma: p.gamma,
          vega: p.vega,
          theta: p.theta,
        })),
        open_orders: orders.map((o: any) => ({
          order_id: o.order_id,
          instrument_name: o.instrument_name,
          direction: o.direction,
          order_type: o.order_type,
          price: o.price,
          amount: o.amount,
          filled_amount: o.filled_amount,
          order_state: o.order_state,
          time_in_force: o.time_in_force,
          label: o.label,
          creation_timestamp: o.creation_timestamp,
        })),
        summary: {
          num_positions: positions.length,
          num_open_orders: orders.length,
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
