import "server-only";
import { findBenchmark } from "./benchmark-options";
import { getCachedSeries } from "./cache";
import type { SeriesRange } from "./providers/types";

// Re-export the client-safe catalogue so server callers can keep importing
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
  try {
    const cached = await getCachedSeries(b.source, b.ticker, range);
    return cached.series.map((p) => ({ date: p.date, value: p.close }));
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
