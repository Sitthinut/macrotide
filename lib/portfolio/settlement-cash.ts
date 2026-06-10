// Settlement-cash fold — pure, deterministic, DB- and network-free.
//
// The ledger records fund trades, not the cash between them. During a fund
// switch (sell A → buy B days later) the proceeds exist as cash the basket
// math can't see, so a naive Σ units × NAV chart craters for the transit days
// and recovers — a fake drawdown on every rebalance. This fold makes that cash
// explicit, per bucket, from the trades alone:
//
//   • A `sell` opens a CASH LOT (its proceeds, dated at the sell).
//   • A `buy` consumes live lots FIFO; whatever the lots can't cover is, by
//     definition, new money from outside — an EXTERNAL INFLOW at the buy date.
//   • A lot is consumable only within SETTLEMENT_WINDOW_DAYS of its sell.
//     Proceeds still unconsumed past the window are treated as WITHDRAWN —
//     retroactively at the SELL date, so the chart steps only on real event
//     dates, never on a windowless anniversary. Expired cash therefore never
//     appears on the chart at all.
//   • Lots younger than the window as of `today` haven't had their chance to
//     be reinvested yet — they stay as in-transit cash (no fabricated
//     withdrawal for a switch that is happening right now).
//
// The window is a foolproof-default heuristic: it keeps a sell-and-walk-away
// user's chart honest (no phantom wealth forever) at the cost of drawing a
// deliberately-parked stash as out-of-market. Recorded truth will override it
// once explicit cash events exist (issue #149).
//
// `dividend` (paid out), `fee`, `reinvest` (internal income), and anchors
// (position restatements, no cash flow) do not touch cash.
//
// The external-flow series is the chart's CONTRIBUTION line. It is NOT
// `reduceLots().netInvested`: that subtracts sale PROCEEDS (the right sign
// convention for XIRR) and so phantom-swings on every switch; this fold moves
// only when money actually enters or leaves the bucket.

import { compareTxns, type LedgerTxn } from "./lots";

/** Days a sell's proceeds stay consumable by later buys before they count as withdrawn. */
export const SETTLEMENT_WINDOW_DAYS = 30;

// Cash below this is dust (float residue after a fully-consumed lot).
const CASH_EPSILON = 1e-6;

export interface CashPoint {
  date: string;
  /** In-transit cash in the bucket from this date (until the next point). */
  cash: number;
}

export interface ExternalFlow {
  date: string;
  /**
   * Signed THB capital: > 0 money entered the bucket (a buy funded from outside),
   * < 0 capital left (a withdrawal). A withdrawal removes only the **cost basis**
   * of the proceeds, never the realized gain riding in them — so cashing out a
   * position at a profit returns net contribution toward 0, never past it. (The
   * value line still loses the full proceeds; the gain you withdrew simply leaves
   * the chart.)
   */
  amount: number;
}

export interface SettlementCashResult {
  /** Step series of the in-transit cash level; one point per change, date-ascending. */
  cashTimeline: CashPoint[];
  /** External flows in/out of the bucket, date-ascending (the contribution line's deltas). */
  externalFlows: ExternalFlow[];
  /** Cash still in transit as of `today` (sells younger than the window). */
  terminalCash: number;
}

interface CashLot {
  date: string;
  /** Cash still in the lot (proceeds), drives the value line. */
  remaining: number;
  /** Cost basis (return-of-capital) still in the lot, drives the contribution line. */
  costRemaining: number;
}

/** A span during which some cash amount was live: [from, to), to=null → still live. */
interface CashSpan {
  from: string;
  to: string | null;
  amount: number;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold ONE bucket's ledger into its in-transit-cash series and external flows.
 *
 * @param txns  the bucket's ledger rows (any order — sorted internally)
 * @param today ISO date used to keep recent, still-pending proceeds as cash
 * @param windowDays settlement window before unconsumed proceeds count as withdrawn
 * @param costBySellId per-sell cost basis (by txn id) — the capital portion of its
 *   proceeds. A withdrawal removes this, not the full proceeds, so realized gains
 *   don't drive net contribution negative. Falls back to proceeds when absent (an
 *   uncosted sell can't split capital from gain).
 */
export function foldSettlementCash(
  txns: readonly LedgerTxn[],
  today: string,
  windowDays: number = SETTLEMENT_WINDOW_DAYS,
  costBySellId?: ReadonlyMap<number, number>,
): SettlementCashResult {
  // Within a single date cash is fungible, so SELLS FOLD FIRST: a same-day
  // switch (sell A, buy B, equal amounts — the common broker pattern) must net
  // to zero regardless of row insertion order, never read as an external
  // deposit plus a later withdrawal.
  const sorted = [...txns].sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
    const rank = (t: LedgerTxn): number => (t.kind === "sell" ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return compareTxns(a, b);
  });

  const lots: CashLot[] = []; // FIFO queue, oldest first
  const spans: CashSpan[] = [];
  const flows: ExternalFlow[] = [];

  // Drop every lot no longer consumable at `onDate`: its remainder was never
  // reinvested in time, so it left the bucket — recorded at the LOT's date. The
  // withdrawal removes the lot's COST basis (return of capital), not its cash.
  const expireBefore = (onDate: string): void => {
    while (lots.length > 0 && addDays(lots[0].date, windowDays) < onDate) {
      const lot = lots.shift() as CashLot;
      if (lot.costRemaining > CASH_EPSILON) {
        flows.push({ date: lot.date, amount: -lot.costRemaining });
      }
    }
  };

  for (const txn of sorted) {
    const magnitude = Math.abs(txn.amount);
    if (txn.kind === "sell") {
      if (magnitude > CASH_EPSILON) {
        // Cost basis of the proceeds (capital); the rest is realized gain. Unknown
        // → treat the whole proceeds as capital (can't split without a basis).
        const cost = txn.id != null ? (costBySellId?.get(txn.id) ?? magnitude) : magnitude;
        lots.push({
          date: txn.tradeDate,
          remaining: magnitude,
          costRemaining: Math.min(cost, magnitude),
        });
      }
      continue;
    }
    if (txn.kind !== "buy") continue; // reinvest/dividend/fee/anchors: no cash effect
    expireBefore(txn.tradeDate);
    let need = magnitude;
    while (need > CASH_EPSILON && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.remaining, need);
      // Consume cash and its capital share proportionally (reinvestment is
      // internal — no contribution change, but the lot's remaining cost shrinks).
      lot.costRemaining -= lot.costRemaining * (take / lot.remaining);
      spans.push({ from: lot.date, to: txn.tradeDate, amount: take });
      lot.remaining -= take;
      need -= take;
      if (lot.remaining <= CASH_EPSILON) lots.shift();
    }
    // Whatever live cash couldn't cover came from outside the bucket (new capital).
    if (need > CASH_EPSILON) flows.push({ date: txn.tradeDate, amount: need });
  }

  // Terminal sweep: lots past the window expired (capital withdrawn at their sell
  // date); younger lots are genuinely in transit and stay on the chart.
  let terminalCash = 0;
  for (const lot of lots) {
    if (lot.remaining <= CASH_EPSILON) continue;
    if (addDays(lot.date, windowDays) < today) {
      if (lot.costRemaining > CASH_EPSILON) {
        flows.push({ date: lot.date, amount: -lot.costRemaining });
      }
    } else {
      spans.push({ from: lot.date, to: null, amount: lot.remaining });
      terminalCash += lot.remaining;
    }
  }

  // Spans → step series: +amount at `from`, −amount at `to`, accumulated.
  const deltas = new Map<string, number>();
  for (const s of spans) {
    deltas.set(s.from, (deltas.get(s.from) ?? 0) + s.amount);
    if (s.to !== null) deltas.set(s.to, (deltas.get(s.to) ?? 0) - s.amount);
  }
  const cashTimeline: CashPoint[] = [];
  let level = 0;
  for (const date of Array.from(deltas.keys()).sort()) {
    level += deltas.get(date) ?? 0;
    cashTimeline.push({ date, cash: level > CASH_EPSILON ? level : 0 });
  }

  // Retroactive expiries land out of order — restore date order for consumers.
  flows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return { cashTimeline, externalFlows: flows, terminalCash };
}
