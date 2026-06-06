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

// "manual" = a custom asset with no live provider; its current price comes from
// the latest market_price the user records in its ledger (see
// transaction-analytics). It has no registry Provider — valuation handles it.
export const QUOTE_SOURCES = ["market", "thai_mutual_fund", "manual"] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

export const QUOTE_SOURCE_LABELS: Record<QuoteSource, string> = {
  market: "Stock / ETF / Index",
  thai_mutual_fund: "Thai mutual fund",
  manual: "Custom (you set the price)",
};

export const DEFAULT_QUOTE_SOURCE: QuoteSource = "market";

export function isQuoteSource(value: unknown): value is QuoteSource {
  return typeof value === "string" && (QUOTE_SOURCES as readonly string[]).includes(value);
}

/**
 * The composite cache key for the `fund_quotes` / `nav_history` tables:
 * `${source}:${TICKER}`. The ticker is normalized to trimmed UPPER case so the
 * SAME row is hit no matter where the ticker came from — a lowercase-cataloged
 * fund (ttb SSF/RMF family) and the always-uppercased ledger ticker must resolve
 * to one key, or a value-only Balance can never find its NAV and silently drops
 * from holdings (#134). The source is a fixed lowercase taxonomy value and is
 * left as-is; only the ticker is normalized.
 *
 * Every writer and reader of those tables MUST build the key through here — the
 * casing only stays consistent if there is exactly one builder.
 */
export function quoteCacheKey(source: string, ticker: string): string {
  return `${source}:${ticker.trim().toUpperCase()}`;
}
