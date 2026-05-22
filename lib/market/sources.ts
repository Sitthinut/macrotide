// Quote sources — the asset-class taxonomy that drives provider routing.
//
// A holding's `quote_source` column tells the registry which provider to call
// when fetching NAV / price. The values name the asset class, not the
// underlying provider — that way the registry's source→provider map can
// change (e.g. swap Yahoo for Alpha Vantage on US stocks) without re-tagging
// any holdings.
//
// The user-facing label is what the HoldingSheet's type selector shows.
// Update the label only; the wire value (string key) is a stable contract
// with the database.

export const QUOTE_SOURCES = ["yahoo", "thai_mutual_fund"] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

export const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  yahoo: "Stock / ETF / Index",
  thai_mutual_fund: "Thai mutual fund",
};

export const DEFAULT_QUOTE_SOURCE: QuoteSource = "yahoo";

export function isQuoteSource(value: unknown): value is QuoteSource {
  return typeof value === "string" && (QUOTE_SOURCES as readonly string[]).includes(value);
}
