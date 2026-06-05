import "server-only";
import { listFundQuotes } from "@/lib/db/queries/quotes";
import type { Transaction } from "@/lib/db/queries/transactions";
import { inferHoldingCurrency } from "@/lib/market/currency";
import { buildFxConverter } from "@/lib/market/fx";
import { type ContributionSummary, summarizeContributions } from "./contributions";
import {
  type BasisPoint,
  type CostBasisMethod,
  type LedgerTxn,
  type PositionState,
  type RealizedEvent,
  reduceLots,
  type TxnKind,
} from "./lots";
import { isTxnKind } from "./txn-import";
import { txnsToCashFlows, xirr } from "./xirr";

// Server-side orchestrator for the Activity ledger's analytics.
//
// This is the ONLY place the two-DB join happens: transactions come from app.db
// (passed in by the route), the terminal market value is priced from market.db
// (fund_quotes) and FX-converted into THB at today's rate. The pure helpers
// (reduceLots / xirr / summarizeContributions) stay DB- and network-free — they
// receive fully assembled data. Keep that boundary: never read a DB inside a
// pure helper.

export interface TransactionAnalytics {
  method: CostBasisMethod;
  realized: RealizedEvent[];
  realizedTotal: number;
  incomeTotal: number;
  expenseTotal: number;
  positions: PositionState[];
  basisTimeline: BasisPoint[];
  contributions: ContributionSummary;
  /** Current market value of still-held units in THB, or null if unpriced. */
  marketValue: number | null;
  /** Money-weighted (annualized) return as a decimal, or null when undefined. */
  irr: number | null;
  /** Why IRR is null, for the UI empty state (null when irr is present). */
  irrUnavailable: string | null;
  /** Currencies whose FX rate couldn't be resolved (terminal value degraded). */
  missingFx: string[];
}

// Day this analytics snapshot is "as of" (the terminal cash-flow date).
export interface AnalyticsOptions {
  method?: CostBasisMethod;
  /** ISO date for the terminal value; defaults handled by the caller (route). */
  asOf: string;
}

const MIN_IRR_DAYS = 28; // annualized XIRR over < ~1 month is meaningless

// Latest positive market_price per ticker, by trade date — the current price for
// a holding with no live NAV (a "manual" / custom asset). Prices come straight
// from the ledger: a Balance's current-price field, or a trade's execution price.
function latestMarketPriceByTicker(rows: readonly Transaction[]): Map<string, number> {
  const best = new Map<string, { date: string; price: number }>();
  for (const r of rows) {
    const price = r.marketPrice;
    if (price == null || price <= 0) continue;
    const cur = best.get(r.ticker);
    if (!cur || r.tradeDate > cur.date) best.set(r.ticker, { date: r.tradeDate, price });
  }
  const out = new Map<string, number>();
  for (const [ticker, v] of best) out.set(ticker, v.price);
  return out;
}

export async function computeTransactionAnalytics(
  rows: readonly Transaction[],
  opts: AnalyticsOptions,
): Promise<TransactionAnalytics> {
  const method = opts.method ?? "average";
  const txns = rows.map(toLedgerTxn);

  const lots = reduceLots(txns, method);
  const contributions = summarizeContributions(txns);

  // Price still-held positions → THB, to form the terminal cash flow.
  const held = lots.positions.filter((p) => p.units > 0);
  const sourceByTicker = new Map<string, string>();
  for (const r of rows) sourceByTicker.set(r.ticker, r.quoteSource);

  let marketValue: number | null = null;
  let irr: number | null = null;
  let irrUnavailable: string | null = null;
  const missingFx: string[] = [];

  if (held.length === 0) {
    // Fully exited — no synthetic terminal flow needed; IRR rests on real flows.
    marketValue = 0;
    ({ irr, irrUnavailable } = solveIrr(txns, null, opts.asOf));
  } else {
    const cacheKeys = held.map((p) => `${sourceByTicker.get(p.ticker) ?? "market"}:${p.ticker}`);
    const navByKey = new Map<string, number>();
    for (const q of listFundQuotes(cacheKeys)) {
      if (q.nav > 0) navByKey.set(q.ticker, q.nav);
    }
    // A "manual" holding has no live provider — it's priced from the LATEST
    // market_price the user recorded in its own ledger (the current-price field on
    // a Balance, or a trade's execution price). Known funds never use this.
    const manualPrice = latestMarketPriceByTicker(rows);

    const currencies = new Set<string>();
    for (const p of held) {
      currencies.add(inferHoldingCurrency(sourceByTicker.get(p.ticker) ?? "market", p.ticker));
    }
    const fx = await buildFxConverter(currencies, "1mo", [opts.asOf]);
    for (const c of fx.missing) missingFx.push(c);

    let total = 0;
    const unpriced: string[] = [];
    for (const p of held) {
      const source = sourceByTicker.get(p.ticker) ?? "market";
      const nav =
        source === "manual" ? manualPrice.get(p.ticker) : navByKey.get(`${source}:${p.ticker}`);
      const rate = fx.rateOn(inferHoldingCurrency(source, p.ticker), opts.asOf);
      if (nav === undefined || rate === null) {
        unpriced.push(p.ticker);
        continue;
      }
      total += p.units * nav * rate;
    }

    if (unpriced.length > 0) {
      // A missing price must NOT masquerade as a zero terminal value (that would
      // read as a total loss). Refuse to compute rather than mislead.
      marketValue = null;
      irrUnavailable =
        unpriced.length === 1
          ? "Waiting on a current price for 1 holding."
          : `Waiting on current prices for ${unpriced.length} holdings.`;
    } else {
      marketValue = total;
      ({ irr, irrUnavailable } = solveIrr(txns, { date: opts.asOf, amount: total }, opts.asOf));
    }
  }

  return {
    method,
    realized: lots.realized,
    realizedTotal: lots.realizedTotal,
    incomeTotal: lots.incomeTotal,
    expenseTotal: lots.expenseTotal,
    positions: lots.positions,
    basisTimeline: lots.basisTimeline,
    contributions,
    marketValue,
    irr,
    irrUnavailable,
    missingFx,
  };
}

function solveIrr(
  txns: LedgerTxn[],
  terminal: { date: string; amount: number } | null,
  asOf: string,
): { irr: number | null; irrUnavailable: string | null } {
  const flows = txnsToCashFlows(txns);
  if (terminal) flows.push(terminal);
  if (flows.length < 2)
    return { irr: null, irrUnavailable: "Not enough activity to compute a return yet." };

  // Gate on elapsed history: annualizing a sub-month window explodes the rate.
  const first = flows.reduce((min, f) => (f.date < min ? f.date : min), flows[0].date);
  const days = (Date.parse(asOf) - Date.parse(first)) / 86_400_000;
  if (days < MIN_IRR_DAYS) {
    return { irr: null, irrUnavailable: "Not enough activity to compute a return yet." };
  }

  const rate = xirr(flows);
  if (rate === null) {
    return { irr: null, irrUnavailable: "Not enough activity to compute a return yet." };
  }
  return { irr: rate, irrUnavailable: null };
}

/** Narrow a stored row to the pure-engine shape, defaulting an unknown kind to "buy". */
function toLedgerTxn(r: Transaction): LedgerTxn {
  const kind: TxnKind = isTxnKind(r.kind) ? r.kind : "buy";
  return {
    id: r.id,
    ticker: r.ticker,
    kind,
    tradeDate: r.tradeDate,
    units: r.units,
    // Anchors (opening/snapshot) carry their asserted avg cost here; the engine
    // ignores it for deltas.
    pricePerUnit: r.pricePerUnit,
    amount: r.amount,
    createdAt: r.createdAt,
  };
}
