import type { SeriesPoint } from "@/lib/static/types";

// Pure, DB/network-free chart helper: align a benchmark series onto a
// portfolio's date labels and rebase it so both lines start from the same base.
//
// TH and US trading calendars rarely produce equal-length series, so a
// `length === length` gate silently dropped the benchmark whenever they
// differed (almost always). Instead we intersect by date: forward-fill the
// benchmark across the portfolio's points, find the FIRST date where both have
// a value (the common anchor), and rebase the benchmark to the portfolio's
// value on that date. The benchmark then shares the portfolio's scale and
// renders whenever any overlap exists.

/** A benchmark point whose value may be absent before the first common date. */
export interface RebasedPoint {
  d: string;
  /** Rebased value; `null` before the first overlapping date. */
  v: number | null;
}

/**
 * Rebase `benchmark` onto `portfolio`'s date space. Returns one point per
 * portfolio point (so the two arrays index-align for plotting):
 * - at/after the first common date, the rebased benchmark value;
 * - before it (no benchmark data yet), `null` — callers either render a gap
 *   (recharts) or hold the value flat at the rebased start (SVG).
 *
 * Returns `null` when there's nothing to draw (no portfolio points, empty
 * benchmark, no overlapping date, or a zero base).
 */
export function rebaseBenchmark(
  portfolio: SeriesPoint[],
  benchmark: SeriesPoint[] | null | undefined,
): RebasedPoint[] | null {
  if (!portfolio || portfolio.length === 0) return null;
  if (!benchmark || benchmark.length === 0) return null;

  const byLabel = new Map(benchmark.map((b) => [b.d, b.v]));
  let lastBench: number | null = null;
  const aligned = portfolio.map((p) => {
    const bv = byLabel.get(p.d);
    if (bv !== undefined) lastBench = bv;
    return lastBench;
  });

  const anchor = aligned.findIndex((b) => b != null);
  if (anchor < 0) return null;

  const portfolioStart = portfolio[anchor].v;
  const benchStart = aligned[anchor] as number;
  if (!benchStart) return null;

  return portfolio.map((p, i) => ({
    d: p.d,
    v: aligned[i] != null ? ((aligned[i] as number) / benchStart) * portfolioStart : null,
  }));
}
