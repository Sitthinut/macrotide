import "server-only";
import { isAnchorKind } from "@/lib/portfolio/txn-import";
import { deriveUnits } from "@/lib/portfolio/value-ledger";
import { listFundQuotes, navOnDate } from "./quotes";
import type { Transaction } from "./transactions";

// Facts-only ledger (ADR 0004): the ledger stores only the money fact the user gave
// — a read `units`, a Balance's ฿ `value`, or a trade's ฿ `amount`. This pre-pass
// turns the *missing* unit count into the fold's input WITHOUT writing it back:
//   • a value-only Balance  → units = value ÷ NAV(tradeDate)
//   • an amount-only trade  → units = amount ÷ (execution price ?? NAV(tradeDate))
// It runs on EVERY fold — every holdings rebuild AND every analytics read — so the
// derived units self-correct the moment that date's NAV lands or is corrected;
// nothing derived is ever frozen in the ledger. NAV(tradeDate) is preferred, the
// latest quote a fall-back (still self-correcting); a row with no NAV anywhere is
// left unresolved (held/recorded, units pending) rather than priced off a wrong NAV.

const DERIVABLE_TRADE = new Set(["buy", "sell", "reinvest"]);

const cacheKey = (r: Transaction): string => `${r.quoteSource}:${r.ticker.trim().toUpperCase()}`;

/** A row whose unit count is missing and must be derived from a money total. */
const needsUnits = (r: Transaction): boolean => {
  if (r.units != null && r.units > 0) return false;
  return isAnchorKind(r.kind)
    ? r.value != null && r.value > 0 // a value-only Balance
    : DERIVABLE_TRADE.has(r.kind) && Math.abs(r.amount) > 0; // an amount-only trade
};

/** The ฿ money fact a row's units derive from: a Balance's value, else the trade amount. */
const moneyTotal = (r: Transaction): number =>
  isAnchorKind(r.kind) ? (r.value ?? 0) : Math.abs(r.amount);

/**
 * Resolve every row whose units must be derived (value-only Balances + amount-only
 * trades) into folded inputs. Returns a new array; rows that already carry a read
 * unit count pass through untouched. Server-only — reads NAV from the shared
 * market.db. Call before mapping rows into the pure lot engine (`reduceLots`).
 */
export function resolveDerivedUnits(rows: readonly Transaction[]): Transaction[] {
  const targets = rows.filter(needsUnits);
  if (targets.length === 0) return [...rows];

  const keys = [...new Set(targets.map(cacheKey))];
  const latest = new Map<string, number>();
  for (const q of listFundQuotes(keys)) if (q.nav > 0) latest.set(q.ticker, q.nav);
  const navByDate = new Map<string, Map<string, number>>();
  for (const date of new Set(targets.map((r) => r.tradeDate)))
    navByDate.set(date, navOnDate(keys, date));

  return rows.map((r) => {
    if (!needsUnits(r)) return r;
    const key = cacheKey(r);
    const nav = navByDate.get(r.tradeDate)?.get(key) ?? latest.get(key) ?? null;
    const anchor = isAnchorKind(r.kind);
    // Balance: value ÷ NAV(date). Trade: amount ÷ (execution price ?? NAV(date)).
    const units = deriveUnits({
      units: null,
      total: moneyTotal(r),
      price: anchor ? null : (r.pricePerUnit ?? null),
      navOnDate: nav,
    }).units;
    if (units == null) return r; // no NAV anywhere → leave unresolved (units pending)
    if (!anchor) return { ...r, units }; // a trade's cost basis is its `amount`; no avg cost to set
    // A Balance's cost basis can ride in as a ฿ TOTAL (the signed `amount`, −cost) OR
    // as a per-unit fact (`pricePerUnit`). Derive whichever is missing from the other
    // — the per-unit avg cost from amount ÷ units, or the cost magnitude from
    // pricePerUnit × units — so an opening's cash always reaches XIRR and the figures
    // agree. An uncosted value anchor (no amount, no price) stays cost-unknown; a
    // restatement (snapshot) moves no cash, so its amount stays 0.
    const costBasis = Math.abs(r.amount);
    const pricePerUnit = r.pricePerUnit ?? (costBasis > 0 ? costBasis / units : null);
    const amount =
      costBasis === 0 && pricePerUnit != null && r.kind === "opening"
        ? -(units * pricePerUnit)
        : r.amount;
    return { ...r, units, pricePerUnit, amount };
  });
}

/**
 * The fold-ready event set: resolve derived units, then DROP any anchor whose units
 * still couldn't be derived (no NAV anywhere). An unresolved anchor folded as zero
 * units would WIPE the position (an anchor asserts an ABSOLUTE balance); dropping it
 * leaves the prior position intact, and it self-corrects into view the moment that
 * date's NAV lands. A delta TRADE with unknown units is kept — its cash (`amount`)
 * is still real and additive, never destructive. Call this (not raw resolve) before
 * folding into positions/analytics.
 */
export function foldableEvents(rows: readonly Transaction[]): Transaction[] {
  return resolveDerivedUnits(rows).filter((r) => !(isAnchorKind(r.kind) && r.units == null));
}
