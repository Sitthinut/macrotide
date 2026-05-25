// Client-safe benchmark catalogue. No server-only imports here so both the
// browser (the Portfolio "VS" selector) and the server (read_performance,
// the /api/market/benchmark route) can share one list. The async series
// fetchers live in ./benchmarks (server-only).

export interface BenchmarkOption {
  /** Stable slug used as the selection key + API param. */
  key: string;
  /** UI label. */
  label: string;
  /** Provider source (matches the quote_source taxonomy). */
  source: string;
  /** Provider symbol. */
  ticker: string;
}

/**
 * Selectable benchmarks. The SET is first — it's the core "match your index"
 * reference for a Thai investor. Goal-based / user-added benchmarks build on
 * this list.
 */
export const BENCHMARK_OPTIONS: BenchmarkOption[] = [
  { key: "set", label: "SET", source: "yahoo", ticker: "^SET.BK" },
  { key: "sp500", label: "S&P 500", source: "yahoo", ticker: "^GSPC" },
  { key: "nasdaq", label: "Nasdaq", source: "yahoo", ticker: "^IXIC" },
  { key: "nikkei", label: "Nikkei", source: "yahoo", ticker: "^N225" },
];

export function findBenchmark(key: string): BenchmarkOption | undefined {
  return BENCHMARK_OPTIONS.find((b) => b.key === key);
}
