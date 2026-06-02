// Demo-mode read helpers over the committed NAV-history fixture
// (lib/mock/demo-history.ts).
//
// These mirror the SHAPE the live market.db read paths produce, so the demo
// branch in lib/db/queries/series.ts and lib/market/benchmarks.ts can swap in
// fixture data without changing their downstream logic (FX, date alignment,
// aggregation). The fixture stores compact [date, value] tuples at variable
// resolution (daily recent / weekly far-back); these helpers decode them and
// apply the caller's range-start filter, exactly as the DB paths filter
// nav_history rows.

import { DEMO_HOLDING_HISTORY, DEMO_INDEX_HISTORY, type EncodedPoint } from "./demo-history";
import type { HistoryPoint } from "./demo-history-transform";

/** Decode compact tuples → { date, value }[], optionally filtered to `since`. */
function decode(points: EncodedPoint[] | undefined, since?: string): HistoryPoint[] {
  if (!points) return [];
  const out: HistoryPoint[] = [];
  for (const [date, value] of points) {
    if (since && date < since) continue;
    out.push({ date, value });
  }
  return out;
}

/**
 * Per-holding NAV series for a demo holding, keyed by its runtime cache key
 * `${quoteSource}:${ticker}`. Returns null when the key is unmapped (caller
 * degrades gracefully, exactly as a market.db miss would). `value` here is the
 * holding's TOTAL value (units × NAV) in THB, already scaled to the seeded
 * current value — see demo-history-transform.buildHoldingSeries.
 */
export function demoHoldingSeries(cacheKey: string, since?: string): HistoryPoint[] | null {
  const raw = DEMO_HOLDING_HISTORY[cacheKey];
  if (!raw) return null;
  return decode(raw, since);
}

/**
 * Index series for a fixture index key (e.g. "sp500", "set"). Used by the
 * benchmark overlay's demo branch. Returns [] for an unknown key, matching
 * getBenchmarkSeries' "unavailable" contract.
 */
export function demoIndexSeries(indexKey: string, since?: string): HistoryPoint[] {
  return decode(DEMO_INDEX_HISTORY[indexKey], since);
}

/** True when the fixture has a series for this holding cache key. */
export function hasDemoHoldingSeries(cacheKey: string): boolean {
  return cacheKey in DEMO_HOLDING_HISTORY;
}
