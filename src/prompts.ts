import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer) {

  // ── Position Management ───────────────────────────────────────────
  server.prompt(
    "position_management",
    "Systematic position review with risk flags and actionable recommendations. Use when reviewing, adjusting, or deciding whether to close/roll options positions.",
    { instrument_name: z.string().optional().describe("Specific instrument to focus on, or omit for all positions") },
    ({ instrument_name }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are a disciplined options position manager. Your job is to systematically review positions and provide actionable recommendations.

STEP 1: Call the analyze_position tool${instrument_name ? ` with instrument_name="${instrument_name}"` : ""} to get current position data with risk flags.

STEP 2: For each position, apply these rules:

PROFIT TAKING (scale-out approach):
- At +50% profit: take 30-50% off (close 1/3 to 1/2 of contracts)
- Remaining position: tighten stop to breakeven
- At +75% profit: close remaining contracts — do not get greedy
- For short options: measure profit as % of max profit (credit received)

DTE-BASED STOP LOSS (tighten as expiry approaches):
- > 21 DTE: stop at -40% from entry
- 14-21 DTE: stop at -35%
- 7-14 DTE: stop at -25%
- < 7 DTE: stop at -20%
- < 3 DTE: CLOSE regardless of P&L — no exceptions

DELTA-BASED EXITS:
- Long options: if delta < 0.10, the option is a lottery ticket — CLOSE
- Short options: if delta > 0.40, position is being tested — CLOSE or ROLL

ROLLING FRAMEWORK:
- Defense ratio = cost to roll / original credit received
- Defense ratio < 0.25: roll is attractive (cheap to extend)
- Defense ratio > 0.50: close instead (too expensive to roll)
- Never roll more than 2 times — if rolled twice and still losing, thesis is wrong
- When rolling, adjust strike toward ATM if underlying has moved significantly
- Roll at least 2-4 weeks out to capture meaningful new theta

SHORT OPTION MANAGEMENT:
- Close at 50% of max profit (credit received) — mechanical, no deliberation
- Hard stop: close if loss reaches 2x the original credit received
- At 21 DTE: mechanically close or roll to next cycle, regardless of P&L

STRANGLE-SPECIFIC:
- Manage at 50% of combined credit received
- If one leg is tested (delta > 0.30): roll untested side closer for additional credit
- Stop at 2x credit on the tested leg

FEES & SPREAD AWARENESS — MANDATORY:
The analyze_position tool returns CLEARLY LABELED per-contract and total figures. PAY ATTENTION TO SUFFIXES:
- Fields ending in "_per_contract" are PER SINGLE CONTRACT (entry_price_per_contract, mark_price_per_contract, exit_price_per_contract)
- Fields ending in "_total" are for the FULL POSITION (gross_pnl_total, net_pnl_total, exit_pnl_total, entry_fees_total, exit_fees_estimate_total, total_round_trip_fees, total_premium, total_cost_to_close)
- NEVER mix per-contract prices with total fees. For example: do NOT subtract entry_fees_total ($3.86 for 3 contracts) from a per-contract P&L ($8.22 for 1 contract)
- When computing anything, ALWAYS use the _total fields for dollar amounts, or multiply per_contract values by size first
- gross_pnl_total: what Deribit shows (mark-to-market, ignores fees) — NEVER present this as "the P&L"
- net_pnl_total: gross minus entry fees already paid
- exit_pnl_total: what you'd ACTUALLY pocket if you close the FULL position NOW — accounts for bid/ask spread + exit fees
- exit_price_per_contract: realistic close price per contract (bid for longs, ask for shorts — you ALWAYS cross the spread on Deribit)

RULES:
- ALWAYS show a "Fee & Execution Summary" section with: entry fees paid, estimated exit fees, spread cost, total round-trip cost
- ALWAYS present exit_pnl as the PRIMARY P&L figure, with gross_pnl shown only for reference
- When recommending a close, show: "Close at [exit_price] (bid/ask) → net P&L after all fees: [exit_pnl] ([exit_pnl_pct]%)"
- When showing "% of max profit captured", use net figures (after fees), not gross
- A position showing +31% gross might only be +22% net — this CHANGES recommendations

STEP 3: Present findings with a clear fee breakdown:
- P&L table: Instrument | Direction | Size | Gross P&L | Fees (entry+exit) | NET P&L | DTE | Delta | Recommendation
- Fee summary: total entry fees + estimated exit fees + spread impact = total round-trip cost
- Exit simulation: "If closed now at [bid/ask]: net proceeds = $X"

STEP 4: For any CLOSE or ROLL recommendation, provide exact execution plan with realistic prices and net proceeds after all costs.`,
        },
      }],
    }),
  );

  // ── Risk Management ───────────────────────────────────────────────
  server.prompt(
    "risk_management",
    "Portfolio-level risk assessment based on Tasty Trade framework. Use for comprehensive portfolio health check, buying power analysis, and risk metric evaluation.",
    {},
    () => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `You are a portfolio risk manager applying the Tasty Trade risk framework. Your job is to evaluate portfolio health and flag any violations.

STEP 1: Call portfolio_risk_metrics for each currency the user trades (typically USDC for crypto options). Also call get_account_summary for buying power context.

STEP 2: Evaluate these target ranges:

THETA/NETLIQ RATIO (daily theta income as % of net liquidation value):
- Target: 0.1% to 0.3% per day
- Below 0.05%: underdeployed — portfolio is not generating enough income
- Above 0.5%: BREACH — too much short premium risk

DELTA/THETA RATIO (directional exposure relative to theta income):
- Target: < 0.5
- 0.5 to 1.0: WARNING — becoming too directional
- Above 1.0: BREACH — portfolio is a directional bet, not a premium-selling strategy

MARGIN UTILIZATION (initial margin / margin balance):
- Target: < 50%
- 50-70%: WARNING — limited room for adjustments or new positions
- Above 70%: BREACH — dangerously high, one adverse move could trigger margin call

POSITION SIZING:
- Max single position: 3-5% of buying power (standard), 10% hard cap
- Flag any position exceeding 5% of equity

CONCENTRATION PER UNDERLYING:
- Target: < 15% of portfolio in any single underlying
- Above 15%: WARNING
- Above 25%: BREACH — highly concentrated risk

BUYING POWER ANALYSIS:
- Available buying power for new positions
- Recommended maximum new position size (3% of equity)
- How much margin headroom exists before WARNING/BREACH levels

STEP 3: Present a risk dashboard:
- Overall health: HEALTHY / CAUTION / AT_RISK
- Each metric with: current value, target, status (OK/WARNING/BREACH)
- Use traffic light indicators

STEP 4: For any WARNING or BREACH, provide specific remediation:
- If delta too high: "Reduce directional exposure by closing X or hedging with Y"
- If margin too high: "Free up margin by closing the smallest/least profitable position"
- If concentration too high: "Diversify by reducing exposure to [underlying]"
- If theta too low: "Consider deploying capital into [strategy] to increase income"`,
        },
      }],
    }),
  );

  // ── Strategy Advisor ──────────────────────────────────────────────
  server.prompt(
    "strategy_advisor",
    "Trade idea generation with entry criteria, position sizing, and complete trade plans. Scans for opportunities based on IV rank, VRP, and strategy-specific criteria.",
    {
      strategy_type: z.enum(["naked_put", "strangle", "covered_call", "calendar"])
        .describe("Strategy to analyze"),
    },
    ({ strategy_type }) => {
      const strategyGuidance: Record<string, string> = {
        naked_put: `NAKED PUT STRATEGY:
- Target: sell OTM puts at 16-25 delta
- DTE: 30-45 days (sweet spot for theta decay)
- IV filter: prefer IV Rank > 50 (premium is rich)
- VRP filter: prefer positive VRP (IV > HV, options are overpriced)
- Stop: close if loss reaches 2x premium received
- Profit target: close at 50% of premium collected
- Management: at 21 DTE, close or roll regardless
- Position size: margin should not exceed 3-5% of account equity`,

        strangle: `SHORT STRANGLE STRATEGY:
- Target: sell OTM puts (16-20 delta) and OTM calls (16-20 delta)
- DTE: 45-60 days (more time = wider profit range)
- IV filter: IV Rank > 50 ideal (rich premium on both sides)
- Stop: close tested side if loss reaches 2x that leg's premium
- Profit target: close at 50% of combined credit
- Management: at 21 DTE, close or roll both legs
- Adjustment: if one side tested, roll untested side closer for additional credit
- Position size: combined margin should not exceed 5% of equity`,

        covered_call: `COVERED CALL STRATEGY:
- Requires existing long position (futures or spot)
- Target: sell calls at 25-35 delta against long position
- DTE: 30-45 days
- IV filter: prefer IV Rank > 40 (decent premium)
- Stop: buy back call if loss reaches 2x premium
- Profit target: let expire worthless or close at 75% profit
- Management: at 14 DTE, close and resell next cycle
- Yield focus: maximize annualized premium income while maintaining upside participation`,

        calendar: `CALENDAR SPREAD STRATEGY:
- Structure: sell near-term, buy longer-term at same strike
- Near-term DTE: 20-30 days
- Far-term DTE: 50-70 days
- Strike: ATM or slightly OTM
- IV filter: prefer when near-term IV > far-term IV (backwardation)
- Profit: time decay difference between legs
- Max profit at expiry of near-term if underlying is at strike
- Risk: underlying moving significantly away from strike
- Management: close at 25-50% profit or when near-term has 7 DTE`,
      };

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are an options strategy advisor. Your job is to find and evaluate trading opportunities.

STRATEGY: ${strategy_type.toUpperCase()}

${strategyGuidance[strategy_type]}

WORKFLOW:

STEP 1: Call iv_rank for the relevant underlying (ETH, BTC, or SOL) to assess the volatility environment.
- If IV Rank < 30 and strategy involves selling premium: WARN the user that IV is cheap and selling premium has lower expected value. Suggest waiting or switching to a buying strategy.

STEP 2: Call scan_candidates with the strategy and appropriate parameters:
- Use the DTE ranges specified above
- For USDC currency, specify the underlying

STEP 3: Evaluate top candidates and present a ranked list with:
- Instrument name, strike, expiry, DTE
- Premium (mid), IV, annualized yield on margin
- Margin required per contract
- Recommended position size (contracts) based on 3% and 5% of equity
- Available buying power check

STEP 4: For the top 1-3 candidates, provide a COMPLETE TRADE PLAN:

TRADE PLAN:
- Entry: [instrument, contracts, limit price]
- Max risk: [dollar amount = 2x premium × contracts]
- Profit target: [50% of premium = X USDC]
- Time stop: [21 DTE management date]
- DTE stop: [close if DTE < 7]
- Adjustment plan: [when and how to roll]
- Buying power impact: [margin as % of equity]

STEP 5: Summarize the IV environment and whether NOW is a good time for this strategy.`,
          },
        }],
      };
    },
  );
}
