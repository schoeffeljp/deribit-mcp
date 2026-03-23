import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DeribitClient } from "../deribit-client.js";

const CURRENCIES = ["BTC", "ETH", "SOL", "USDC", "USDT", "EURR"] as const;

// ── Shared Helpers ────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** Parse "27MAR26" → { expiryDate, dte } */
export function parseExpiry(expiryStr: string): { expiryDate: Date; dte: number } {
  const day = parseInt(expiryStr.slice(0, expiryStr.length - 5), 10);
  const mon = MONTHS[expiryStr.slice(-5, -2).toUpperCase()];
  const yr = 2000 + parseInt(expiryStr.slice(-2), 10);
  // Deribit options expire at 08:00 UTC
  const expiryDate = new Date(Date.UTC(yr, mon, day, 8, 0, 0));
  const dte = Math.max(0, (expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  return { expiryDate, dte };
}

/** Parse "ETH_USDC-27MAR26-2400-C" → parts */
export function parseInstrumentName(name: string) {
  const parts = name.split("-");
  if (parts.length < 4) return null;
  const base = parts[0]; // e.g. "ETH_USDC" or "ETH"
  const expiry = parts[1]; // e.g. "27MAR26"
  const strike = parseFloat(parts[2]);
  const type = parts[3] as "C" | "P";
  const { expiryDate, dte } = parseExpiry(expiry);
  return { base, expiry, strike, type, expiryDate, dte };
}

/** DTE-based stop loss thresholds */
function getStopLossThreshold(dte: number): number {
  if (dte > 21) return -0.40;
  if (dte > 14) return -0.35;
  if (dte > 7) return -0.25;
  return -0.20;
}

/** Estimated taker fee per contract in USDC on Deribit options (~0.03% of notional, varies by instrument) */
const TAKER_FEE_PER_CONTRACT = 0.65;

/** Determine the index name for a currency (for dollar conversion) */
function indexNameForCurrency(currency: string): string | null {
  switch (currency) {
    case "BTC": return "btc_usd";
    case "ETH": return "eth_usd";
    case "SOL": return "sol_usd";
    default: return null; // USDC/USDT are already dollar-denominated
  }
}

/** Core IV rank computation — reusable by iv_rank tool and scan_candidates */
export async function computeIvRank(
  client: DeribitClient,
  currency: string,
  periodDays = 365,
): Promise<{
  currency: string;
  period_days: number;
  current_iv: number | null;
  iv_high: number | null;
  iv_low: number | null;
  iv_rank: number | null;
  hv30: number | null;
  vrp: number | null;
  signal: string;
}> {
  const now = Date.now();
  const start = now - periodDays * 24 * 60 * 60 * 1000;

  const [dvolResult, hvResult] = await Promise.all([
    client.callPublic("public/get_volatility_index_data", {
      currency,
      start_timestamp: start,
      end_timestamp: now,
      resolution: "1D",
    }).catch(() => null),
    client.callPublic("public/get_historical_volatility", { currency }).catch(() => null),
  ]);

  let currentIv: number | null = null;
  let ivHigh: number | null = null;
  let ivLow: number | null = null;
  let ivRank: number | null = null;

  if (dvolResult?.data?.length > 0) {
    const closes = dvolResult.data.map((d: number[]) => d[4]); // close prices
    currentIv = closes[closes.length - 1];
    ivHigh = Math.max(...closes);
    ivLow = Math.min(...closes);
    if (ivHigh > ivLow) {
      ivRank = ((currentIv! - ivLow) / (ivHigh - ivLow)) * 100;
    }
  }

  let hv30: number | null = null;
  if (Array.isArray(hvResult) && hvResult.length > 0) {
    const lastPoint = hvResult[hvResult.length - 1];
    hv30 = Array.isArray(lastPoint) ? lastPoint[1] : lastPoint;
  }

  const vrp = currentIv !== null && hv30 !== null ? currentIv - hv30 : null;

  let signal = "UNKNOWN";
  if (ivRank !== null) {
    if (ivRank > 50) signal = "IV_RICH";
    else if (ivRank >= 30) signal = "IV_FAIR";
    else signal = "IV_CHEAP";
  }

  return {
    currency,
    period_days: periodDays,
    current_iv: currentIv,
    iv_high: ivHigh,
    iv_low: ivLow,
    iv_rank: ivRank !== null ? Math.round(ivRank * 10) / 10 : null,
    hv30,
    vrp: vrp !== null ? Math.round(vrp * 10) / 10 : null,
    signal,
  };
}

// ── Tool Registration ─────────────────────────────────────────────────

export function registerAnalyticsTools(server: McpServer, client: DeribitClient) {

  // ── analyze_position ──────────────────────────────────────────────
  server.tool(
    "analyze_position",
    "PREFERRED tool for position analysis — returns fee-aware NET P&L (after actual entry fees from trade history + estimated exit fees at ~$0.9/contract taker), realistic exit simulation at bid/ask (not mark), DTE, greeks, moneyness, risk flags, and HOLD/TAKE_PROFIT/CLOSE/ROLL recommendations. Always use this instead of get_positions + get_ticker when analyzing positions.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
      instrument_name: z.string().optional().describe("Specific instrument to analyze. If omitted, analyzes all option positions."),
    },
    async ({ currency, instrument_name }) => {
      const positions: any[] = await client.callPrivate("private/get_positions", {
        currency,
        kind: "option",
      });

      const filtered = instrument_name
        ? positions.filter((p: any) => p.instrument_name === instrument_name)
        : positions;

      if (filtered.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              currency,
              num_positions: 0,
              message: instrument_name
                ? `No position found for ${instrument_name}`
                : "No open option positions",
            }),
          }],
        };
      }

      // Fetch tickers for bid/ask spread data (parallel)
      const tickerPromises = filtered.map((p: any) =>
        client.callPublic("public/ticker", { instrument_name: p.instrument_name }).catch(() => null)
      );
      const tickers = await Promise.all(tickerPromises);
      const tickerMap = new Map<string, any>();
      for (let i = 0; i < filtered.length; i++) {
        if (tickers[i]) tickerMap.set(filtered[i].instrument_name, tickers[i]);
      }

      const analyses = [];

      for (const p of filtered) {
        const parsed = parseInstrumentName(p.instrument_name);
        if (!parsed) continue;

        const direction = p.direction; // "buy" or "sell"
        const size = p.size; // positive for long, negative for short
        const absSize = Math.abs(size);
        const isShort = direction === "sell";
        const entryPrice = p.average_price ?? 0;
        const markPrice = p.mark_price ?? 0;
        const floatingPnl = p.floating_profit_loss ?? 0;
        const delta = p.delta ?? 0;
        const gamma = p.gamma ?? 0;
        const theta = p.theta ?? 0;
        const vega = p.vega ?? 0;
        const indexPrice = p.index_price ?? 0;

        // ── Fees from trade history ──
        let entryFees = 0;
        let dit: number | null = null;
        try {
          const trades = await client.callPrivate("private/get_user_trades_by_instrument", {
            instrument_name: p.instrument_name,
            count: 100,
            sorting: "asc",
            historical: true,
          });
          const tradeList = trades?.trades ?? trades;
          if (Array.isArray(tradeList) && tradeList.length > 0) {
            // DIT from first trade
            dit = Math.round((Date.now() - tradeList[0].timestamp) / (24 * 60 * 60 * 1000));
            // Sum all fees paid on this instrument
            for (const t of tradeList) {
              entryFees += Math.abs(t.fee ?? 0);
            }
          }
        } catch { /* non-critical */ }

        // ── Bid/Ask from ticker ──
        const ticker = tickerMap.get(p.instrument_name);
        const bestBid = ticker?.best_bid_price ?? markPrice;
        const bestAsk = ticker?.best_ask_price ?? markPrice;
        const spread = bestAsk - bestBid;

        // ── Exit simulation ──
        // To close: shorts buy back at ask, longs sell at bid
        const exitPrice = isShort ? bestAsk : bestBid;
        const exitFeesEstimate = absSize * TAKER_FEE_PER_CONTRACT;

        // Gross P&L (mark-based, what Deribit shows)
        const grossPnl = floatingPnl;

        // Net P&L = gross P&L - entry fees already paid
        const netPnl = grossPnl - entryFees;

        // Simulated exit P&L = what you'd actually pocket if you close NOW
        // For shorts: (entry - exit) * size - entry fees - exit fees
        // For longs: (exit - entry) * size - entry fees - exit fees
        const exitPnl = isShort
          ? (entryPrice - exitPrice) * absSize - entryFees - exitFeesEstimate
          : (exitPrice - entryPrice) * absSize - entryFees - exitFeesEstimate;

        // P&L % based on net P&L
        const costBasis = Math.abs(entryPrice * absSize);
        const grossPnlPct = costBasis > 0 ? (grossPnl / costBasis) * 100 : 0;
        const netPnlPct = costBasis > 0 ? (netPnl / costBasis) * 100 : 0;
        const exitPnlPct = costBasis > 0 ? (exitPnl / costBasis) * 100 : 0;

        // For short options: % of max profit captured (net of fees)
        let maxProfitPct: number | null = null;
        if (isShort && entryPrice > 0) {
          // Net max profit = entry credit * size - entry fees - exit fees (at 0)
          const grossMaxProfit = entryPrice * absSize;
          const netMaxProfit = grossMaxProfit - entryFees - exitFeesEstimate;
          const currentNetProfit = (entryPrice - exitPrice) * absSize - entryFees - exitFeesEstimate;
          maxProfitPct = netMaxProfit > 0
            ? Math.round((currentNetProfit / netMaxProfit) * 100 * 10) / 10
            : null;
        }

        // Moneyness
        let otmPct = 0;
        if (indexPrice > 0) {
          if (parsed.type === "C") {
            otmPct = ((parsed.strike - indexPrice) / indexPrice) * 100;
          } else {
            otmPct = ((indexPrice - parsed.strike) / indexPrice) * 100;
          }
        }

        // ── Risk flags (use NET P&L for decisions) ──
        const flags: string[] = [];
        const stopThreshold = getStopLossThreshold(parsed.dte);

        // Profit target reached (based on net)
        if (isShort && maxProfitPct !== null && maxProfitPct >= 50) {
          flags.push("profit_target_reached");
        }
        if (!isShort && netPnlPct >= 50) {
          flags.push("profit_target_reached");
        }

        // Stop loss zone (based on net)
        if (netPnlPct < stopThreshold * 100) {
          flags.push("stop_loss_zone");
        }

        // Delta-based
        if (!isShort && Math.abs(delta) < 0.10 && parsed.dte < 21) {
          flags.push("low_delta");
        }
        if (isShort && Math.abs(delta) > 0.40) {
          flags.push("high_delta");
        }

        // Expiry warnings
        if (parsed.dte < 3) flags.push("expiry_critical");
        else if (parsed.dte < 7) flags.push("expiry_warning");

        // Recommendation (based on net P&L and exit simulation)
        let recommendation = "HOLD";
        if (flags.includes("expiry_critical") || flags.includes("stop_loss_zone")) {
          recommendation = "CLOSE";
        } else if (flags.includes("low_delta") || flags.includes("high_delta")) {
          recommendation = "CLOSE";
        } else if (flags.includes("profit_target_reached")) {
          recommendation = "TAKE_PROFIT";
        } else if (parsed.dte < 21 && netPnlPct < -10 && netPnlPct > stopThreshold * 100) {
          recommendation = "ROLL";
        }

        // Totals for clarity (all $ figures are TOTAL for the full position, not per-contract)
        const totalPremium = entryPrice * absSize;
        const totalCostToClose = exitPrice * absSize;

        analyses.push({
          instrument_name: p.instrument_name,
          direction,
          size: absSize,
          // Per-contract prices
          entry_price_per_contract: entryPrice,
          mark_price_per_contract: markPrice,
          exit_price_per_contract: Math.round(exitPrice * 10000) / 10000,
          best_bid_per_contract: Math.round(bestBid * 10000) / 10000,
          best_ask_per_contract: Math.round(bestAsk * 10000) / 10000,
          spread_per_contract: Math.round(spread * 10000) / 10000,
          // TOTAL position values (all $ amounts below are for ALL contracts combined)
          total_premium: Math.round(totalPremium * 100) / 100,
          total_cost_to_close: Math.round(totalCostToClose * 100) / 100,
          gross_pnl_total: Math.round(grossPnl * 100) / 100,
          gross_pnl_pct: Math.round(grossPnlPct * 10) / 10,
          entry_fees_total: Math.round(entryFees * 100) / 100,
          exit_fees_estimate_total: Math.round(exitFeesEstimate * 100) / 100,
          total_round_trip_fees: Math.round((entryFees + exitFeesEstimate) * 100) / 100,
          net_pnl_total: Math.round(netPnl * 100) / 100,
          net_pnl_pct: Math.round(netPnlPct * 10) / 10,
          // Exit simulation (TOTAL if you close the full position now)
          exit_pnl_total: Math.round(exitPnl * 100) / 100,
          exit_pnl_pct: Math.round(exitPnlPct * 10) / 10,
          max_profit_pct: maxProfitPct,
          dte: Math.round(parsed.dte * 10) / 10,
          dit,
          strike: parsed.strike,
          type: parsed.type,
          underlying_price: indexPrice,
          otm_pct: Math.round(otmPct * 10) / 10,
          delta: Math.round(delta * 10000) / 10000,
          gamma: Math.round(gamma * 10000) / 10000,
          theta: Math.round(theta * 10000) / 10000,
          vega: Math.round(vega * 10000) / 10000,
          risk_flags: flags,
          recommendation,
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            currency,
            num_positions: analyses.length,
            positions: analyses,
          }),
        }],
      };
    },
  );

  // ── portfolio_risk_metrics ────────────────────────────────────────
  server.tool(
    "portfolio_risk_metrics",
    "Portfolio-level risk dashboard with dollar greeks, theta/netliq ratio, delta/theta ratio, margin utilization, concentration per underlying, and health status (HEALTHY/CAUTION/AT_RISK). Based on Tasty Trade risk framework.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
    },
    async ({ currency }) => {
      const [account, positions] = await Promise.all([
        client.callPrivate("private/get_account_summary", { currency, extended: true }),
        client.callPrivate("private/get_positions", { currency }),
      ]);

      const equity = account.equity ?? 0;
      const marginBalance = account.margin_balance ?? 0;
      const initialMargin = account.initial_margin ?? 0;
      const availableFunds = account.available_funds ?? 0;

      // For BTC/ETH/SOL, get index price for dollar conversion
      const indexName = indexNameForCurrency(currency);
      let dollarMultiplier = 1;
      if (indexName) {
        try {
          const idx = await client.callPublic("public/get_index_price", { index_name: indexName });
          dollarMultiplier = idx.index_price ?? 1;
        } catch { /* fall back to 1 */ }
      }

      // Sum per-position greeks (standard deltas, not dollar delta from account)
      let netDelta = 0, netGamma = 0, netVega = 0, netTheta = 0;
      for (const p of positions) {
        netDelta += p.delta ?? 0;
        netGamma += p.gamma ?? 0;
        netVega += p.vega ?? 0;
        netTheta += p.theta ?? 0;
      }

      // IMPORTANT: For ETH/BTC/SOL options, Deribit already returns greeks in USD terms.
      // - theta = USD/day (not ETH/day)
      // - delta = USD per $1 move
      // So netTheta, netDelta, netGamma, netVega are ALREADY in USD. No multiplication needed.
      // dollarMultiplier is only needed to convert equity from ETH to USD.
      const dollarDelta = netDelta; // Already in USD from Deribit
      const dollarTheta = netTheta; // Already in USD from Deribit
      const dollarGamma = netGamma; // Already in USD from Deribit
      const dollarVega = netVega;   // Already in USD from Deribit
      const equityUsd = equity * dollarMultiplier; // Convert ETH equity to USD

      // Metrics
      const thetaNetliqPct = equityUsd > 0 ? (Math.abs(dollarTheta) / equityUsd) * 100 : 0;
      const deltaThetaRatio = Math.abs(netTheta) > 0.0001 ? Math.abs(netDelta) / Math.abs(netTheta) : 0;
      const marginUtilPct = marginBalance > 0 ? (initialMargin / marginBalance) * 100 : 0;

      // Concentration per underlying
      const underlyingMap = new Map<string, number>();
      for (const p of positions) {
        const name = p.instrument_name as string;
        const underlying = name.split("-")[0]; // "ETH_USDC" or "ETH"
        const posValue = Math.abs((p.mark_price ?? 0) * (p.size ?? 0));
        underlyingMap.set(underlying, (underlyingMap.get(underlying) ?? 0) + posValue);
      }
      const concentration = Array.from(underlyingMap.entries()).map(([underlying, value]) => ({
        underlying,
        value_pct: equity > 0 ? Math.round((value / equity) * 100 * 10) / 10 : 0,
      })).sort((a, b) => b.value_pct - a.value_pct);

      // Status evaluation
      type Status = "OK" | "WARNING" | "BREACH";
      const metrics: Array<{ name: string; value: number; target: string; status: Status }> = [];

      // Theta/netliq
      let thetaStatus: Status = "OK";
      if (thetaNetliqPct > 0.5) thetaStatus = "BREACH";
      else if (thetaNetliqPct < 0.05 || thetaNetliqPct > 0.3) thetaStatus = "WARNING";
      metrics.push({ name: "theta_netliq_pct", value: Math.round(thetaNetliqPct * 1000) / 1000, target: "0.1% - 0.3%", status: thetaStatus });

      // Delta/theta ratio
      let dtStatus: Status = "OK";
      if (deltaThetaRatio > 1.0) dtStatus = "BREACH";
      else if (deltaThetaRatio > 0.5) dtStatus = "WARNING";
      metrics.push({ name: "delta_theta_ratio", value: Math.round(deltaThetaRatio * 100) / 100, target: "< 0.5", status: dtStatus });

      // Margin utilization
      let marginStatus: Status = "OK";
      if (marginUtilPct > 70) marginStatus = "BREACH";
      else if (marginUtilPct > 50) marginStatus = "WARNING";
      metrics.push({ name: "margin_utilization_pct", value: Math.round(marginUtilPct * 10) / 10, target: "< 50%", status: marginStatus });

      // Concentration
      let concStatus: Status = "OK";
      const maxConc = concentration.length > 0 ? concentration[0].value_pct : 0;
      if (maxConc > 25) concStatus = "BREACH";
      else if (maxConc > 15) concStatus = "WARNING";
      metrics.push({ name: "max_concentration_pct", value: maxConc, target: "< 15%", status: concStatus });

      // Overall health
      const hasBreaches = metrics.some((m) => m.status === "BREACH");
      const hasWarnings = metrics.some((m) => m.status === "WARNING");
      const health = hasBreaches ? "AT_RISK" : hasWarnings ? "CAUTION" : "HEALTHY";

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            currency,
            health,
            equity: Math.round(equity * 100) / 100,
            equity_usd: Math.round(equityUsd * 100) / 100,
            available_buying_power: Math.round(availableFunds * 100) / 100,
            dollar_greeks: {
              delta: Math.round(dollarDelta * 100) / 100,
              theta: Math.round(dollarTheta * 100) / 100,
              gamma: Math.round(dollarGamma * 100) / 100,
              vega: Math.round(dollarVega * 100) / 100,
            },
            position_greeks: {
              delta: Math.round(netDelta * 10000) / 10000,
              theta: Math.round(netTheta * 10000) / 10000,
              gamma: Math.round(netGamma * 10000) / 10000,
              vega: Math.round(netVega * 10000) / 10000,
            },
            metrics,
            concentration,
            num_positions: positions.length,
          }),
        }],
      };
    },
  );

  // ── iv_rank ───────────────────────────────────────────────────────
  server.tool(
    "iv_rank",
    "Get IV Rank, IV Percentile, HV30, and Volatility Risk Premium (VRP) for a cryptocurrency. IV Rank > 50 = rich (good for selling premium), < 30 = cheap (good for buying).",
    {
      currency: z.enum(["BTC", "ETH", "SOL"]).describe("Underlying currency"),
      period: z.number().optional().describe("Lookback period in days (default 365)"),
    },
    async ({ currency, period }) => {
      const result = await computeIvRank(client, currency, period ?? 365);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ── scan_candidates ───────────────────────────────────────────────
  server.tool(
    "scan_candidates",
    "Scan for option trading opportunities by strategy (naked_put, strangle, covered_call). Returns ranked candidates with premium, delta, IV, margin, annualized yield, and position sizing recommendations.",
    {
      currency: z.enum(CURRENCIES).describe("Currency"),
      strategy: z.enum(["naked_put", "strangle", "covered_call"]).describe("Strategy to scan for"),
      underlying: z.enum(["ETH", "BTC", "SOL"]).optional().describe("Filter by underlying (required for USDC)"),
      min_dte: z.number().optional().describe("Minimum DTE (default 30)"),
      max_dte: z.number().optional().describe("Maximum DTE (default 60)"),
      min_iv_rank: z.number().optional().describe("Minimum IV rank to proceed (default 0)"),
    },
    async ({ currency, strategy, underlying, min_dte = 30, max_dte = 60, min_iv_rank = 0 }) => {
      // 1. Check IV rank (for underlying currencies)
      const ivCurrency = underlying ?? (["BTC", "ETH", "SOL"].includes(currency) ? currency : null);
      let ivContext = null;
      if (ivCurrency) {
        try {
          ivContext = await computeIvRank(client, ivCurrency as string, 365);
          if (min_iv_rank > 0 && ivContext.iv_rank !== null && ivContext.iv_rank < min_iv_rank) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  message: `IV Rank (${ivContext.iv_rank.toFixed(1)}) is below minimum threshold (${min_iv_rank}). Not a good time to sell premium.`,
                  iv_context: ivContext,
                  candidates: [],
                }),
              }],
            };
          }
        } catch { /* non-critical, continue without IV context */ }
      }

      // 2. Get account for position sizing
      const account = await client.callPrivate("private/get_account_summary", { currency, extended: true });
      const equity = account.equity ?? 0;

      // 3. Get instruments and filter by DTE
      const instruments: any[] = await client.callPublic("public/get_instruments", {
        currency,
        kind: "option",
        expired: false,
      });

      const now = Date.now();
      const minDteMs = min_dte * 24 * 60 * 60 * 1000;
      const maxDteMs = max_dte * 24 * 60 * 60 * 1000;

      const inRange = instruments.filter((inst) => {
        const timeToExpiry = inst.expiration_timestamp - now;
        if (timeToExpiry < minDteMs || timeToExpiry > maxDteMs) return false;
        if (underlying) {
          if (!inst.instrument_name.split("-")[0].startsWith(underlying)) return false;
        }
        return true;
      });

      // 4. Get book summaries (one call for all instruments, efficient)
      const summaries: any[] = await client.callPublic("public/get_book_summary_by_currency", {
        currency,
        kind: "option",
      });
      const summaryMap = new Map<string, any>();
      for (const s of summaries) {
        summaryMap.set(s.instrument_name, s);
      }

      // 5. Strategy-specific scanning
      const candidates: any[] = [];

      if (strategy === "naked_put") {
        // Find puts with delta between -0.30 and -0.16
        for (const inst of inRange) {
          if (!inst.instrument_name.endsWith("-P")) continue;
          const summary = summaryMap.get(inst.instrument_name);
          if (!summary) continue;

          const mid = summary.mid_price ?? ((summary.bid_price ?? 0) + (summary.ask_price ?? 0)) / 2;
          if (mid <= 0) continue;

          // Estimate delta from mark_iv if available (we'll get precise delta from top candidates later)
          const parsed = parseInstrumentName(inst.instrument_name);
          if (!parsed) continue;

          candidates.push({
            instrument_name: inst.instrument_name,
            strike: parsed.strike,
            dte: Math.round(parsed.dte * 10) / 10,
            expiry: parsed.expiry,
            premium_mid: mid,
            mark_iv: summary.mark_iv,
            open_interest: summary.open_interest ?? 0,
            volume_24h: summary.volume ?? 0,
            underlying_price: summary.underlying_price,
          });
        }
      } else if (strategy === "strangle") {
        // Group by expiry, find best put + call pairs
        const expiryGroups = new Map<string, { puts: any[]; calls: any[] }>();
        for (const inst of inRange) {
          const parsed = parseInstrumentName(inst.instrument_name);
          if (!parsed) continue;
          const summary = summaryMap.get(inst.instrument_name);
          if (!summary) continue;

          const mid = summary.mid_price ?? ((summary.bid_price ?? 0) + (summary.ask_price ?? 0)) / 2;
          if (mid <= 0) continue;

          if (!expiryGroups.has(parsed.expiry)) {
            expiryGroups.set(parsed.expiry, { puts: [], calls: [] });
          }
          const group = expiryGroups.get(parsed.expiry)!;
          const entry = {
            instrument_name: inst.instrument_name,
            strike: parsed.strike,
            dte: Math.round(parsed.dte * 10) / 10,
            expiry: parsed.expiry,
            premium_mid: mid,
            mark_iv: summary.mark_iv,
            underlying_price: summary.underlying_price,
          };
          if (parsed.type === "P") group.puts.push(entry);
          else group.calls.push(entry);
        }

        // For each expiry, find OTM puts and calls near 16-20 delta range
        // Without precise delta, use ~15-25% OTM as proxy
        for (const [, group] of expiryGroups) {
          const spot = group.puts[0]?.underlying_price ?? group.calls[0]?.underlying_price ?? 0;
          if (spot <= 0) continue;

          const otmPuts = group.puts
            .filter((p) => p.strike < spot && (spot - p.strike) / spot > 0.05 && (spot - p.strike) / spot < 0.25)
            .sort((a, b) => b.premium_mid - a.premium_mid);

          const otmCalls = group.calls
            .filter((c) => c.strike > spot && (c.strike - spot) / spot > 0.05 && (c.strike - spot) / spot < 0.25)
            .sort((a, b) => b.premium_mid - a.premium_mid);

          if (otmPuts.length > 0 && otmCalls.length > 0) {
            const bestPut = otmPuts[0];
            const bestCall = otmCalls[0];
            candidates.push({
              strategy: "strangle",
              expiry: bestPut.expiry,
              dte: bestPut.dte,
              put_leg: bestPut,
              call_leg: bestCall,
              combined_premium: Math.round((bestPut.premium_mid + bestCall.premium_mid) * 10000) / 10000,
              underlying_price: spot,
            });
          }
        }
      } else if (strategy === "covered_call") {
        // Get existing long positions (futures/spot)
        const longPositions = await client.callPrivate("private/get_positions", { currency });
        const longs = longPositions.filter((p: any) =>
          p.direction === "buy" && (p.kind === "future" || p.kind === "spot"),
        );

        if (longs.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                message: "No long futures or spot positions found. Covered calls require a long underlying position.",
                iv_context: ivContext,
                candidates: [],
              }),
            }],
          };
        }

        // Scan calls at 20-35% OTM for each expiry
        for (const inst of inRange) {
          if (!inst.instrument_name.endsWith("-C")) continue;
          const parsed = parseInstrumentName(inst.instrument_name);
          if (!parsed) continue;
          const summary = summaryMap.get(inst.instrument_name);
          if (!summary) continue;

          const mid = summary.mid_price ?? ((summary.bid_price ?? 0) + (summary.ask_price ?? 0)) / 2;
          if (mid <= 0) continue;
          const spot = summary.underlying_price ?? 0;
          if (spot <= 0) continue;

          const otmPct = (parsed.strike - spot) / spot;
          if (otmPct < 0.05 || otmPct > 0.35) continue;

          candidates.push({
            instrument_name: inst.instrument_name,
            strike: parsed.strike,
            dte: Math.round(parsed.dte * 10) / 10,
            expiry: parsed.expiry,
            premium_mid: mid,
            mark_iv: summary.mark_iv,
            otm_pct: Math.round(otmPct * 1000) / 10,
            underlying_price: spot,
          });
        }
      }

      // 6. Sort by premium (best yield first) and limit
      candidates.sort((a, b) => {
        const premA = a.combined_premium ?? a.premium_mid ?? 0;
        const premB = b.combined_premium ?? b.premium_mid ?? 0;
        return premB - premA;
      });
      const topCandidates = candidates.slice(0, 15);

      // 7. Get margins for top candidates (limit API calls)
      for (const c of topCandidates.slice(0, 10)) {
        const instrName = c.instrument_name ?? c.put_leg?.instrument_name;
        if (!instrName) continue;
        try {
          const margins = await client.callPrivate("private/get_margins", {
            instrument_name: instrName,
            amount: 1,
            price: c.premium_mid ?? c.put_leg?.premium_mid ?? 0,
          });
          c.margin_per_contract = margins.sell ?? margins.buy ?? null;

          // Annualized yield
          const dte = c.dte ?? c.put_leg?.dte ?? 30;
          const premium = c.combined_premium ?? c.premium_mid ?? 0;
          if (c.margin_per_contract && c.margin_per_contract > 0 && dte > 0) {
            c.annualized_yield_pct = Math.round((premium / c.margin_per_contract) * (365 / dte) * 100 * 10) / 10;
          }

          // Position sizing: max contracts at 3% and 5% of equity
          if (c.margin_per_contract > 0 && equity > 0) {
            c.max_contracts_3pct = Math.floor((equity * 0.03) / c.margin_per_contract);
            c.max_contracts_5pct = Math.floor((equity * 0.05) / c.margin_per_contract);
          }
        } catch { /* non-critical */ }
      }

      // Re-sort by annualized yield if available
      topCandidates.sort((a, b) => (b.annualized_yield_pct ?? 0) - (a.annualized_yield_pct ?? 0));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            currency,
            strategy,
            iv_context: ivContext,
            equity: Math.round(equity * 100) / 100,
            available_buying_power: Math.round((account.available_funds ?? 0) * 100) / 100,
            num_candidates: topCandidates.length,
            candidates: topCandidates,
          }),
        }],
      };
    },
  );
}
