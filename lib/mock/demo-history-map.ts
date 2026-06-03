// (assetClass, region) → real public index, for the demo NAV-history fixture.
//
// Each demo holding is synthesised from a PUBLIC index it broadly tracks (see
// lib/mock/demo-history-transform.ts for why we don't use real fund NAVs). This
// module is the single source of truth for that mapping, shared by the refresh
// script (which pulls each referenced index) and the demo read path (which looks
// up the right fixture series for a holding).
//
// `indexKey` values are the keys under which series are stored in the fixture
// (lib/mock/demo-history.ts → indices). Benchmark-overlay keys (set / sp500 /
// nasdaq / nikkei) double as both holding sources AND the Portfolio "VS"
// overlay, so they appear here and in BENCHMARK_OPTIONS.

/** A real index the fixture pulls and stores a monthly series for. */
export interface DemoIndexDef {
  /** Fixture key (also the benchmark `key` when it doubles as an overlay). */
  indexKey: string;
  /** Provider source (quote_source taxonomy). */
  source: string;
  /** Canonical ticker the provider chain resolves. `null` = synthetic. */
  ticker: string | null;
  /** Human label for docs / logs. */
  label: string;
  /**
   * Annual growth for SYNTHETIC indices (no free real series): the script
   * generates a smooth monthly series at this rate. Used for Thai bonds and
   * cash, where no free index exists in the provider chain.
   */
  syntheticAnnualPct?: number;
}

/**
 * Every index the fixture needs. The four overlay benchmarks (set/sp500/
 * nasdaq/nikkei) use real provider data; acwi + gold are real proxies; thai_bond
 * and cash are synthetic (no free real index in the chain — see notes below).
 *
 * History depth note: FMP serves ~5y of the real S&P 500 (^GSPC); EODHD's free
 * tier caps at ~1y, so for the other indices we pull the Twelve Data ETF PROXY
 * (full ~5y) instead of the EODHD index — the proxy tracks the index shape,
 * which is all the demo chart needs (values are rebased + rescaled anyway).
 */
export const DEMO_INDICES: DemoIndexDef[] = [
  { indexKey: "sp500", source: "yahoo", ticker: "^GSPC", label: "S&P 500" },
  { indexKey: "nasdaq", source: "yahoo", ticker: "^IXIC", label: "Nasdaq Composite" },
  { indexKey: "nikkei", source: "yahoo", ticker: "^N225", label: "Nikkei 225" },
  {
    indexKey: "set",
    source: "yahoo",
    ticker: "^SET.BK",
    label: "SET (Stock Exchange of Thailand)",
  },
  { indexKey: "acwi", source: "yahoo", ticker: "ACWI", label: "MSCI ACWI (global equity)" },
  { indexKey: "gold", source: "yahoo", ticker: "GC=F", label: "Gold (XAU/USD)" },
  {
    indexKey: "thai_bond",
    source: "yahoo",
    ticker: null,
    label: "Thai government bonds (synthetic)",
    syntheticAnnualPct: 2.6,
  },
  {
    indexKey: "cash",
    source: "yahoo",
    ticker: null,
    label: "Thai short-rate / cash (synthetic)",
    syntheticAnnualPct: 1.4,
  },
];

export const DEMO_INDEX_BY_KEY: Record<string, DemoIndexDef> = Object.fromEntries(
  DEMO_INDICES.map((d) => [d.indexKey, d]),
);

/**
 * Map a holding's (assetClass, region) to a fixture index key. Falls back to a
 * sensible default per asset class, then to global equity (acwi), so an unmapped
 * holding degrades gracefully rather than dropping off the chart.
 */
export function indexKeyForHolding(assetClass: string | null, region: string | null): string {
  const ac = (assetClass ?? "").toLowerCase();
  const rg = (region ?? "").toLowerCase();

  if (ac === "cash") return "cash";
  if (ac === "bond") return rg === "thailand" ? "thai_bond" : "thai_bond";
  if (ac === "alternative") return "gold"; // gold / income-style alts track gold/commodity-ish

  // Equity (and anything else) → region.
  if (rg === "us") return "sp500";
  if (rg === "thailand") return "set";
  if (rg === "global") return "acwi";
  if (rg === "em") return "acwi"; // no free EM/India index in the chain → global proxy
  if (rg === "japan") return "nikkei";
  return "acwi";
}

/** Tracking-wobble amplitude by TER: pricier (active) funds wobble more. */
export function wobbleAmpForTer(terPct: number): number {
  // Index funds (~0.4% TER) ≈ ±0.6%; active funds (~1.8% TER) ≈ ±1.6%.
  return Math.min(0.02, 0.004 + (terPct / 100) * 0.7);
}
