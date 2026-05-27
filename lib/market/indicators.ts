// The Markets-screen indicator catalog.
//
// macrotide serves a globally-diversified, Thai-based index investor, so the
// DEFAULT set leads with global performance (US + global equity, gold) plus
// USD/THB — the FX rate that converts global returns into baht — and keeps a
// Thai gauge as one (non-headline) row. Users can edit their own list (add /
// remove / reorder) from this catalog; see lib/db/queries/market-indicators.ts.
//
// IMPORTANT — why most equities are ETF proxies, not index symbols: on the
// Twelve Data FREE tier the raw index symbols (S&P 500, Nasdaq-100, SET, …) are
// not available (Grow/Pro plan only), but their US-listed tracking ETFs ARE.
// So we fetch the ETF (SPY for the S&P 500, QQQ for the Nasdaq-100, THD for
// Thailand, …). The daily % move — what this screen is about — matches the
// index; the absolute value shown is the ETF's price. `name` notes the proxy.
//
// `symbol` is the canonical ticker the provider chain resolves (quote_source
// "yahoo" → Twelve Data → Frankfurter → Yahoo). `tier` is a data-reliability /
// cost hint surfaced in the manage UI so users understand why a row may be empty:
//   - "keyless"  — no key needed, reliable (Frankfurter ECB FX)
//   - "free-key" — needs TWELVE_DATA_API_KEY (free tier; verified to return data)
//   - "paid"     — needs a paid Twelve Data plan

export type IndicatorTier = "keyless" | "free-key" | "paid";

export type IndicatorGroup = "Global equity" | "Thai" | "Commodities" | "FX" | "Crypto" | "Rates";

export interface IndicatorDef {
  /** Canonical ticker resolved by the market provider chain. */
  symbol: string;
  /** Short display label (e.g. "S&P 500"). */
  label: string;
  /** Secondary descriptor (notes the ETF proxy where applicable). */
  name: string;
  group: IndicatorGroup;
  tier: IndicatorTier;
  /** Rendered as a percent (yields / FX shown without thousands styling). */
  isYield?: boolean;
  /** In the out-of-the-box default set (and its order among defaults). */
  defaultOrder?: number;
}

// One entry per addable indicator. `defaultOrder` marks the six shown before a
// user edits their list; everything else is opt-in from the "add" picker.
// Equity rows use free-tier ETF proxies (verified to return on the free plan).
export const INDICATOR_CATALOG: IndicatorDef[] = [
  // ─ Default set: global-first + USD/THB + a Thai gauge ─
  {
    symbol: "SPY",
    label: "S&P 500",
    name: "US large-cap · SPY",
    group: "Global equity",
    tier: "free-key",
    defaultOrder: 1,
  },
  {
    symbol: "QQQ",
    label: "Nasdaq-100",
    name: "US tech · QQQ",
    group: "Global equity",
    tier: "free-key",
    defaultOrder: 2,
  },
  {
    symbol: "ACWI",
    label: "MSCI ACWI",
    name: "Global equity · ACWI",
    group: "Global equity",
    tier: "free-key",
    defaultOrder: 3,
  },
  {
    symbol: "GC=F",
    label: "Gold",
    name: "XAU/USD spot",
    group: "Commodities",
    tier: "free-key",
    defaultOrder: 4,
  },
  {
    symbol: "THB=X",
    label: "USD/THB",
    name: "Currency (ECB)",
    group: "FX",
    tier: "keyless",
    isYield: true,
    defaultOrder: 5,
  },
  {
    symbol: "THD",
    label: "Thailand",
    name: "MSCI Thailand · THD",
    group: "Thai",
    tier: "free-key",
    defaultOrder: 6,
  },

  // ─ Optional adds: global equity (all free-tier ETF proxies) ─
  {
    symbol: "DIA",
    label: "Dow Jones",
    name: "US blue-chip · DIA",
    group: "Global equity",
    tier: "free-key",
  },
  {
    symbol: "IWM",
    label: "Russell 2000",
    name: "US small-cap · IWM",
    group: "Global equity",
    tier: "free-key",
  },
  {
    symbol: "EFA",
    label: "MSCI EAFE",
    name: "Developed ex-US · EFA",
    group: "Global equity",
    tier: "free-key",
  },
  {
    symbol: "EWJ",
    label: "Japan",
    name: "MSCI Japan · EWJ",
    group: "Global equity",
    tier: "free-key",
  },
  {
    symbol: "MCHI",
    label: "China",
    name: "MSCI China · MCHI",
    group: "Global equity",
    tier: "free-key",
  },

  // ─ Optional adds: commodities ─
  { symbol: "SI=F", label: "Silver", name: "XAG/USD spot", group: "Commodities", tier: "free-key" },
  { symbol: "CL=F", label: "WTI Crude", name: "US oil", group: "Commodities", tier: "free-key" },
  {
    symbol: "BZ=F",
    label: "Brent Crude",
    name: "Global oil",
    group: "Commodities",
    tier: "free-key",
  },

  // ─ Optional adds: FX (USD-base, keyless via ECB) ─
  {
    symbol: "JPY=X",
    label: "USD/JPY",
    name: "Currency (ECB)",
    group: "FX",
    tier: "keyless",
    isYield: true,
  },
  {
    symbol: "CNY=X",
    label: "USD/CNY",
    name: "Currency (ECB)",
    group: "FX",
    tier: "keyless",
    isYield: true,
  },
  {
    symbol: "EUR=X",
    label: "USD/EUR",
    name: "Currency (ECB)",
    group: "FX",
    tier: "keyless",
    isYield: true,
  },

  // ─ Optional adds: crypto ─
  { symbol: "BTC-USD", label: "Bitcoin", name: "BTC/USD", group: "Crypto", tier: "free-key" },
  { symbol: "ETH-USD", label: "Ethereum", name: "ETH/USD", group: "Crypto", tier: "free-key" },
];

const BY_SYMBOL = new Map(INDICATOR_CATALOG.map((d) => [d.symbol, d]));

/** Catalog lookup by canonical symbol. */
export function indicatorBySymbol(symbol: string): IndicatorDef | undefined {
  return BY_SYMBOL.get(symbol);
}

/** True when `symbol` is a known, addable indicator. */
export function isKnownIndicator(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/** Default indicator symbols, in display order, shown before a user edits. */
export const DEFAULT_INDICATOR_SYMBOLS: string[] = INDICATOR_CATALOG.filter(
  (d) => d.defaultOrder !== undefined,
)
  .sort((a, b) => (a.defaultOrder ?? 0) - (b.defaultOrder ?? 0))
  .map((d) => d.symbol);
