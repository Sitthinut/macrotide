import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { getMarketDb, isDemoRequest } from "@/lib/db/context";
import { navHistory } from "@/lib/db/schema";
import { demoIndexSeries } from "@/lib/mock/demo-history-read";
import { findBenchmark } from "./benchmark-options";
import { getCachedSeries } from "./cache";
import type { SeriesRange } from "./providers/types";
import { benchmarkRangeStart } from "./range";

// Re-export the client-safe catalog so server callers can keep importing
// everything benchmark-related from this one module.
export { BENCHMARK_OPTIONS, type BenchmarkOption, findBenchmark } from "./benchmark-options";

export interface BenchmarkSeriesPoint {
  /** ISO YYYY-MM-DD */
  date: string;
  value: number;
}

/**
 * Real index series for a benchmark over `range`, from the market cache
 * (stale-tolerant). Returns `[]` when the key is unknown or the upstream is
 * cold / backing off — callers treat an empty series as "unavailable", never
 * as zero.
 */
export async function getBenchmarkSeries(
  key: string,
  range: SeriesRange = "6mo",
): Promise<BenchmarkSeriesPoint[]> {
  const b = findBenchmark(key);
  if (!b) return [];
  const since = benchmarkRangeStart(range);

  // DEMO MODE: serve the benchmark overlay from the committed ~5y fixture instead
  // of market.db. The benchmark `key` (set / sp500 / nasdaq / nikkei) is also the
  // fixture index key, so the lookup is direct. demoIndexSeries seeds a carry-in
  // on `since` so the overlay spans the full window. Owner mode reads the live
  // cache (with the same carry-in below). See lib/mock/demo-history.ts.
  if (isDemoRequest()) {
    return demoIndexSeries(key, since);
  }

  try {
    const cached = await getCachedSeries(b.source, b.ticker, range);
    const series = cached.series.map((p) => ({ date: p.date, value: p.close }));
    // CARRY-IN: if the cached series' first in-window point is after `since`
    // (the window opened on a non-trading day for this index), seed the left edge
    // with the most recent pre-window close, re-dated to `since`, so the overlay
    // spans the full window and the client rebases from the same start as the
    // portfolio line. Re-dating to `since` keeps the axis at the window start.
    if (series.length > 0 && series[0].date > since) {
      const carry = getMarketDb()
        .select({ nav: navHistory.nav })
        .from(navHistory)
        .where(and(eq(navHistory.ticker, `${b.source}:${b.ticker}`), lt(navHistory.date, since)))
        .orderBy(desc(navHistory.date))
        .limit(1)
        .get();
      if (carry) series.unshift({ date: since, value: carry.nav });
    }
    return series;
  } catch {
    return [];
  }
}

/**
 * Total return % for a benchmark over `range`. When `fromDate` is given, the
 * window starts at the first benchmark point on/after it — so a benchmark and a
 * portfolio can be compared over the *same* span. Returns `null` when there
 * isn't enough data.
 */
export async function getBenchmarkReturnPct(
  key: string,
  range: SeriesRange = "6mo",
  fromDate?: string,
): Promise<number | null> {
  const series = await getBenchmarkSeries(key, range);
  const pts = fromDate ? series.filter((p) => p.date >= fromDate) : series;
  if (pts.length < 2) return null;
  const first = pts[0].value;
  const last = pts[pts.length - 1].value;
  if (!first) return null;
  return (last / first - 1) * 100;
}
