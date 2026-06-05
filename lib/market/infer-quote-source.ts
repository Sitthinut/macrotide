import { KNOWN_TICKERS } from "@/lib/data/known-funds";
import type { QuoteSource } from "@/lib/market/sources";

// Pure, client-safe quote-source inference. Lives outside ocr.ts (which is
// `server-only`) so both the API route and the Add-holdings table can default
// each row's price source. Its only data dependency, KNOWN_TICKERS, is already
// client-safe code-resident seed data.

// Authoritative source per known ticker (case-insensitive). The seed catalog
// carries an explicit `quote_source`, so membership beats any shape guess —
// this is what keeps e.g. PTT.BK / ^GSPC on market and K-FIXED-A on the fund feed.
const KNOWN_QUOTE_SOURCE = new Map<string, QuoteSource>(
  KNOWN_TICKERS.map((k) => [k.ticker.toUpperCase(), k.quote_source]),
);

// Thai AMC prefixes that appear on share-class codes WITHOUT a hyphen
// (e.g. SCBCOMP, KFS100SSFX) — the market source never carries these. Kept deliberately
// short and distinctive (and gated on length ≥ 5) so plain US tickers aren't
// mis-tagged; hyphen / "&" / parenthetical codes are already caught by shape.
const THAI_AMC_PREFIXES = ["SCB", "KFS"] as const;

/**
 * Decide where to fetch a ticker's price. Catalog membership is authoritative;
 * otherwise a shape heuristic. A Thai mutual-fund share-class code carries a
 * hyphen group (K-FIXED-A), an ampersand (SCBS&P500), or a parenthetical share
 * class (K-GOLD-A(A)); a longer all-caps code from a known Thai AMC (SCBCOMP)
 * is also a fund. Dotted / caret / equals symbols (PTT.BK, ^GSPC, THB=X) and
 * plain ETF tickers (SPY) are market. This only sets the *default* in the
 * editable confirmation table — the user can still flip the source per row.
 */
export function inferQuoteSource(ticker: string): QuoteSource {
  const t = ticker.trim().toUpperCase();
  const known = KNOWN_QUOTE_SOURCE.get(t);
  if (known) return known;
  if (/[-&]/.test(t) || /\([A-Z0-9]+\)$/.test(t)) return "thai_mutual_fund";
  if (t.length >= 5 && THAI_AMC_PREFIXES.some((p) => t.startsWith(p))) {
    return "thai_mutual_fund";
  }
  // Unknown symbols default to a CUSTOM (manual-priced) asset rather than the
  // stock/ETF chain — we can't reliably price an arbitrary ticker, so it's more
  // honest to let the user set the price than to assume a feed that returns
  // nothing. A real stock/ETF/index can still be tagged via the source badge.
  return "manual";
}
