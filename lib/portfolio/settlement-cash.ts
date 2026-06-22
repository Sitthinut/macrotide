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
// deliberately-parked stash as out-of-market. Recorded truth OVERRIDES it
// (issue #149) — explicit cash events the user enters:
//
//   • A `deposit` is an external inflow; a `withdraw` is an external outflow. They
//     move money across the portfolio boundary; the held-cash position's standing
//     value is folded separately (reduceLots), so withdraw is just the boundary flow.
//   • A `cash_balance` (Set balance) ASSERTS an account's balance. By DEFAULT the
//     change vs that account's prior asserted balance is money in/out (a
//     contribution/withdrawal). The "no money moved" override (`reconcile`) makes it a
//     pure restatement — no flow — and clears the bucket's in-transit lots, so the
//     asserted balance (now a held-cash position) absorbs deliberately-parked proceeds
//     and the 30-day heuristic can't retroactively withdraw them.
//
// A fund `buy` consumes only in-transit sell proceeds (the heuristic), NOT explicit
// cash — the app never silently debits a tracked account (which one, of several?).
// Funding a buy from tracked cash is recorded by the user (a withdraw, via the
// "funded from cash?" nudge) or reconciled at the next Set balance; either way the
// buy(+) and the cash-down(−) net to zero. See tmp/cash-prd.md §2c.
//
// Explicit cash's standing VALUE is a held-cash position folded by reduceLots (a
// `cash`-quote-source ticker priced at 1), not in-transit settlement cash — so it
// never enters `terminalCash` and is never double-counted on the value line.
//
// `dividend` (paid out), `fee`, `reinvest` (internal income), and fund anchors
// (position restatements, no cash flow) do not touch cash.
//
// The external-flow series is the chart's CONTRIBUTION line. It is NOT
// `reduceLots().netInvested`: that subtracts sale PROCEEDS (the right sign
// convention for XIRR) and so phantom-swings on every switch; this fold moves
// only when money actually enters or leaves the bucket.
//
// The fold ALSO emits a parallel `returnFlows` for the time-weighted return. It
// agrees with the contribution line everywhere EXCEPT a walked-away (expired) sell
// lot, where it removes the full proceeds rather than just the cost basis — so a
// realized gain that leaves the book doesn't read as a market loss in TWR. Unlike
// `reduceLots().netInvested` it still only moves on a genuine exit, never on a
// reinvested switch (a consumed lot pushes no flow in either series).

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
   * Signed THB capital: > 0 money entered the bucket (a buy funded from outside, a
   * deposit, or a Set-balance raise), < 0 capital left (a withdraw or a Set-balance
   * drop). An UNCONSUMED sell lot that expires past the window removes only its **cost
   * basis**, not the realized gain riding in the proceeds — so walking away from a
   * profitable sale returns net contribution toward 0, never past it. Explicit
   * deposit/withdraw/Set-balance flows move at FACE (cash carries no gain to split).
   */
  amount: number;
}

export interface SettlementCashResult {
  /** Step series of the in-transit cash level; one point per change, date-ascending. */
  cashTimeline: CashPoint[];
  /** External flows in/out of the bucket, date-ascending (the contribution line's deltas). */
  externalFlows: ExternalFlow[];
  /**
   * Flows for the TIME-WEIGHTED return, date-ascending. Identical to `externalFlows`
   * except an unconsumed sell lot that EXPIRES (proceeds walked away) leaves at its
   * **full proceeds**, not just its cost basis. TWR strips external flows to measure
   * the return earned while invested — so a profitable exit must remove the whole
   * market value that left; counting only cost basis (as `externalFlows` does, to keep
   * the money-weighted contribution line from going negative) makes the realized gain
   * read as a phantom loss. The two series therefore differ ONLY at a walk-away sale.
   */
  returnFlows: ExternalFlow[];
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
 *   proceeds. When an unconsumed sell lot EXPIRES past the window, only this capital
 *   is removed (not the realized gain), so walking away from a profitable sale doesn't
 *   drive net contribution negative. Falls back to proceeds when absent (an uncosted
 *   sell can't split capital from gain).
 */
export function foldSettlementCash(
  txns: readonly LedgerTxn[],
  today: string,
  windowDays: number = SETTLEMENT_WINDOW_DAYS,
  costBySellId?: ReadonlyMap<number, number>,
): SettlementCashResult {
  // Within a single date cash is fungible, so the fold order is fixed by kind, not
  // row insertion: SELL (0) opens proceeds first so a same-day switch nets to zero;
  // DEPOSIT (1) / WITHDRAW (2) move explicit cash; CASH_BALANCE (3) asserts the level
  // AFTER those moves (so a same-day deposit+Set-balance double-counts nothing) and a
  // reconcile clears the still-open sell lots; BUY (4) draws last.
  const rankKind = (t: LedgerTxn): number => {
    switch (t.kind) {
      case "sell":
        return 0;
      case "deposit":
        return 1;
      case "withdraw":
        return 2;
      case "cash_balance":
        return 3;
      case "buy":
        return 4;
      default:
        return 5;
    }
  };
  const sorted = [...txns].sort((a, b) => {
    if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
    if (rankKind(a) !== rankKind(b)) return rankKind(a) - rankKind(b);
    return compareTxns(a, b);
  });

  const lots: CashLot[] = []; // FIFO queue, oldest first
  const spans: CashSpan[] = [];
  const flows: ExternalFlow[] = [];
  // The TWR variant — same as `flows` except an expired (walked-away) lot leaves
  // at its full PROCEEDS, not just its cost basis (see SettlementCashResult).
  const returnFlows: ExternalFlow[] = [];

  // Drop every lot no longer consumable at `onDate`: its remainder was never
  // reinvested in time, so it left the bucket — recorded at the LOT's date. The
  // contribution withdrawal removes the lot's COST basis (return of capital); the
  // TWR withdrawal removes the lot's full proceeds (the realized gain also left).
  const expireBefore = (onDate: string): void => {
    while (lots.length > 0 && addDays(lots[0].date, windowDays) < onDate) {
      const lot = lots.shift() as CashLot;
      if (lot.costRemaining > CASH_EPSILON) {
        flows.push({ date: lot.date, amount: -lot.costRemaining });
      }
      if (lot.remaining > CASH_EPSILON) {
        returnFlows.push({ date: lot.date, amount: -lot.remaining });
      }
    }
  };

  // Draw up to `need` cash from live heuristic lots FIFO, closing each consumed
  // lot's in-transit span at `onDate`. Returns the cash drawn and its capital
  // (cost) share — the caller decides whether that capital is an external outflow
  // (a withdraw) or an internal reinvestment (a buy, no contribution change).
  const drawCash = (need: number, onDate: string): { drawn: number; costDrawn: number } => {
    let drawn = 0;
    let costDrawn = 0;
    while (need > CASH_EPSILON && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.remaining, need);
      const costTake = lot.costRemaining * (take / lot.remaining);
      lot.costRemaining -= costTake;
      spans.push({ from: lot.date, to: onDate, amount: take });
      lot.remaining -= take;
      drawn += take;
      costDrawn += costTake;
      need -= take;
      if (lot.remaining <= CASH_EPSILON) lots.shift();
    }
    return { drawn, costDrawn };
  };

  for (const txn of sorted) {
    const magnitude = Math.abs(txn.amount);
    switch (txn.kind) {
      case "sell": {
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
        break;
      }
      // deposit / withdraw move no in-transit lots — their CONTRIBUTION flows come from
      // `cashContributionFlows` (the shared definition), merged in after this loop.
      case "cash_balance": {
        // A "no money moved" Set balance (reconcile) asserts that any in-transit proceeds
        // are now held cash: close their spans and drop the lots, so the 30-day heuristic
        // can't retroactively withdraw deliberately-parked proceeds (issue #149). The
        // contribution flow itself (the delta, when NOT a reconcile) is produced by
        // `cashContributionFlows` — keep that ONE definition, don't duplicate it here.
        if (txn.reconcile) {
          for (const lot of lots) {
            if (lot.remaining > CASH_EPSILON) {
              spans.push({ from: lot.date, to: txn.tradeDate, amount: lot.remaining });
            }
          }
          lots.length = 0;
        }
        break;
      }
      case "buy": {
        expireBefore(txn.tradeDate);
        const { drawn } = drawCash(magnitude, txn.tradeDate);
        // Whatever live cash couldn't cover came from outside the bucket (new capital).
        const shortfall = magnitude - drawn;
        if (shortfall > CASH_EPSILON) {
          flows.push({ date: txn.tradeDate, amount: shortfall });
          returnFlows.push({ date: txn.tradeDate, amount: shortfall });
        }
        break;
      }
      default:
        break; // reinvest/dividend/fee/fund anchors: no cash effect
    }
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
      returnFlows.push({ date: lot.date, amount: -lot.remaining });
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

  // Merge the explicit-cash contribution flows from the SHARED definition (deposit /
  // withdraw / Set-balance delta), so the chart line, XIRR, and the summary can't diverge.
  // Explicit cash moves at face (no realized gain to split), so both series get them.
  const cashFlows = cashContributionFlows(txns);
  flows.push(...cashFlows);
  returnFlows.push(...cashFlows);

  // Retroactive expiries + merged cash flows land out of order — restore date order.
  const byDate = (a: ExternalFlow, b: ExternalFlow) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  flows.sort(byDate);
  returnFlows.sort(byDate);

  return { cashTimeline, externalFlows: flows, returnFlows, terminalCash };
}

// Cash-event ordering within a date: deposit/withdraw settle before a Set balance, so a
// same-day "deposit then Set balance" counts only the un-deposited change.
const cashEventRank = (kind: LedgerTxn["kind"]): number =>
  kind === "deposit" ? 0 : kind === "withdraw" ? 1 : 2; // cash_balance last

/**
 * The boundary CONTRIBUTION flows from explicit cash events (#149) — the SINGLE
 * definition shared by the settlement-cash chart line, the XIRR cash flows, and the
 * contribution summary, so the three never silently diverge (PRD §6 review trap #3).
 *
 * Sign (chart convention): > 0 money ENTERED the portfolio (a deposit, or a Set-balance
 * raise), < 0 it LEFT (a withdraw, or a Set-balance drop). A `reconcile` Set balance moves
 * no money → no flow. XIRR negates these (money in = a negative, out-of-pocket flow).
 *
 * Per-account running balance: a Set balance's delta is measured against THAT account's
 * prior level (THB = native units × `fxToThb`), not a bucket-wide total — several cash
 * accounts can share a bucket.
 */
export function cashContributionFlows(
  txns: readonly LedgerTxn[],
  /**
   * Cash account tickers whose contributions are EXCLUDED — a `reserved` account (#149)
   * is set aside, so its deposits / Set-balance changes are not portfolio contributions
   * and its rows produce no flows. (Its value still counts in net worth, just not in the
   * return — the terminal-side exclusion is the caller's job.)
   */
  excludeTickers?: ReadonlySet<string>,
): ExternalFlow[] {
  const sorted = txns
    .filter(
      (t) =>
        (t.kind === "deposit" || t.kind === "withdraw" || t.kind === "cash_balance") &&
        !excludeTickers?.has(t.ticker),
    )
    .sort((a, b) => {
      if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
      if (cashEventRank(a.kind) !== cashEventRank(b.kind)) {
        return cashEventRank(a.kind) - cashEventRank(b.kind);
      }
      return compareTxns(a, b);
    });

  const balanceByTicker = new Map<string, number>();
  const flows: ExternalFlow[] = [];
  for (const txn of sorted) {
    const magnitude = Math.abs(txn.amount);
    if (txn.kind === "deposit") {
      if (magnitude > CASH_EPSILON) flows.push({ date: txn.tradeDate, amount: magnitude });
      balanceByTicker.set(txn.ticker, (balanceByTicker.get(txn.ticker) ?? 0) + magnitude);
    } else if (txn.kind === "withdraw") {
      if (magnitude > CASH_EPSILON) flows.push({ date: txn.tradeDate, amount: -magnitude });
      balanceByTicker.set(
        txn.ticker,
        Math.max(0, (balanceByTicker.get(txn.ticker) ?? 0) - magnitude),
      );
    } else {
      // cash_balance: the change vs this account's prior asserted balance is the flow,
      // unless it's a "no money moved" reconcile.
      const assertedThb = (txn.units ?? 0) * (txn.fxToThb ?? 1);
      const prior = balanceByTicker.get(txn.ticker) ?? 0;
      const delta = assertedThb - prior;
      balanceByTicker.set(txn.ticker, assertedThb);
      if (!txn.reconcile && Math.abs(delta) > CASH_EPSILON) {
        flows.push({ date: txn.tradeDate, amount: delta });
      }
    }
  }
  return flows;
}
