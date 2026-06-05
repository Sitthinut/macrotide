// Seed list of publicly-known tickers used to power Manual-entry autocomplete
// in AddHoldingsSheet. Code-resident static data — not a DB table.
//
// Contents are public, vendor-neutral references only:
// - Thai mutual fund share-class codes registered with the SEC (sec.or.th).
//   The codes are public; their inclusion here does not imply that anyone in
//   particular holds them.
// - Yahoo-style symbols for major indices and well-known ETFs.
//
// `quote_source` maps to the values in lib/market/sources.ts.
//
// If you add an entry, keep `name` short (one line in the dropdown) and
// prefer the fund-house's official English label.

import type { QuoteSource } from "@/lib/market/sources";

export interface KnownTicker {
  ticker: string;
  name: string;
  quote_source: QuoteSource;
}

export const KNOWN_TICKERS: readonly KnownTicker[] = [
  // ── Thai mutual funds — Kasikorn Asset Management (KAsset) ──
  { ticker: "K-FIXED-A", name: "K Fixed Income Fund — A", quote_source: "thai_mutual_fund" },
  { ticker: "K-USA-A(A)", name: "K USA Equity Fund — A (Accum.)", quote_source: "thai_mutual_fund" },
  { ticker: "K-CHANGE-A(A)", name: "K Positive Change Equity — A", quote_source: "thai_mutual_fund" },
  { ticker: "K-GLOBE-A(A)", name: "K Global Equity — A", quote_source: "thai_mutual_fund" },
  { ticker: "K-VIETNAM", name: "K Vietnam Equity Fund", quote_source: "thai_mutual_fund" },
  { ticker: "K-CHINA-A(A)", name: "K China Equity Fund — A", quote_source: "thai_mutual_fund" },
  { ticker: "K-GHEALTH", name: "K Global Healthcare Equity", quote_source: "thai_mutual_fund" },
  { ticker: "K-PROPI", name: "K Property Infra Flexible Fund", quote_source: "thai_mutual_fund" },

  // ── Thai mutual funds — SCB Asset Management (SCBAM) ──
  { ticker: "SCBS&P500", name: "SCB US Equity (S&P 500) Fund", quote_source: "thai_mutual_fund" },
  { ticker: "SCBLT1", name: "SCB Long Term Equity Fund 1", quote_source: "thai_mutual_fund" },
  { ticker: "SCBGOLDH", name: "SCB Gold Hedged Fund", quote_source: "thai_mutual_fund" },
  { ticker: "SCBINDIA", name: "SCB India Equity Fund", quote_source: "thai_mutual_fund" },
  { ticker: "SCBSE", name: "SCB Selects Equity Fund", quote_source: "thai_mutual_fund" },

  // ── Thai mutual funds — Bualuang BBL Asset (BBLAM) ──
  { ticker: "B-GLOBAL", name: "Bualuang Global Equity Fund", quote_source: "thai_mutual_fund" },
  { ticker: "B-INNOTECH", name: "Bualuang Innovation Technology", quote_source: "thai_mutual_fund" },
  { ticker: "BCAP-USBOND", name: "BCAP US Aggregate Bond Fund", quote_source: "thai_mutual_fund" },

  // ── Thai mutual funds — Krungsri Asset (KSAM) ──
  { ticker: "KFGBRAND-A", name: "Krungsri Global Brands Equity — A", quote_source: "thai_mutual_fund" },
  { ticker: "KFHTECH-A", name: "Krungsri Global Tech Equity — A", quote_source: "thai_mutual_fund" },
  { ticker: "KFAFIX-A", name: "Krungsri Active Fixed Income — A", quote_source: "thai_mutual_fund" },

  // ── Thai mutual funds — MFC / Eastspring / TMBAM ──
  { ticker: "M-S50", name: "MFC SET50 Index Fund", quote_source: "thai_mutual_fund" },
  { ticker: "ES-USTECH", name: "Eastspring US Technology Fund", quote_source: "thai_mutual_fund" },
  { ticker: "TMB50", name: "TMB SET50 Index Fund", quote_source: "thai_mutual_fund" },

  // ── Yahoo: Thai market indices and well-known SET listings ──
  { ticker: "^SET.BK", name: "SET Index (Thailand)", quote_source: "market" },
  { ticker: "PTT.BK", name: "PTT Public Company Limited", quote_source: "market" },
  { ticker: "AOT.BK", name: "Airports of Thailand", quote_source: "market" },
  { ticker: "CPALL.BK", name: "CP All", quote_source: "market" },

  // ── Yahoo: global indices and large ETFs ──
  { ticker: "^GSPC", name: "S&P 500 Index", quote_source: "market" },
  { ticker: "^DJI", name: "Dow Jones Industrial Average", quote_source: "market" },
  { ticker: "^IXIC", name: "Nasdaq Composite", quote_source: "market" },
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", quote_source: "market" },
  { ticker: "VT", name: "Vanguard Total World Stock ETF", quote_source: "market" },
  { ticker: "QQQ", name: "Invesco QQQ Trust (Nasdaq-100)", quote_source: "market" },
  { ticker: "AAPL", name: "Apple Inc.", quote_source: "market" },
  { ticker: "MSFT", name: "Microsoft Corporation", quote_source: "market" },

  // ── Yahoo: FX ──
  { ticker: "THB=X", name: "USD / THB Exchange Rate", quote_source: "market" },
];

export interface TickerSuggestion extends KnownTicker {
  // Whether this entry came from the user's own holdings (vs. the static seed).
  fromHoldings?: boolean;
}

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Case-insensitive substring filter over ticker OR name.
 *
 * - Empty / whitespace-only query returns the input list unchanged.
 * - Matches are ranked: ticker-prefix matches first, then ticker-substring,
 *   then name-substring. User-holdings entries break ties (so prior entries
 *   surface first). The `limit` caps the dropdown so it stays scannable.
 */
export function filterKnownTickers(
  list: readonly TickerSuggestion[],
  query: string,
  limit = 8,
): TickerSuggestion[] {
  const q = normalize(query);
  if (!q) return list.slice(0, limit);

  const scored: { entry: TickerSuggestion; score: number }[] = [];
  for (const entry of list) {
    const ticker = normalize(entry.ticker);
    const name = normalize(entry.name);
    let score = -1;
    if (ticker.startsWith(q)) score = 0;
    else if (ticker.includes(q)) score = 1;
    else if (name.includes(q)) score = 2;
    if (score === -1) continue;
    // Holdings tie-break: subtract a tiny epsilon so they sort ahead within tier.
    if (entry.fromHoldings) score -= 0.5;
    scored.push({ entry, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.entry);
}

/**
 * Merge the static `KNOWN_TICKERS` list with distinct tickers already in
 * the user's holdings. Holdings entries surface first and carry their
 * persisted `englishName` / `quote_source`.
 */
export function mergeWithHoldings(
  holdings: readonly { ticker: string; englishName: string; quoteSource: string }[],
): TickerSuggestion[] {
  const seen = new Set<string>();
  const merged: TickerSuggestion[] = [];

  for (const h of holdings) {
    const key = h.ticker.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      ticker: h.ticker,
      name: h.englishName,
      // The holdings table column is text; defensively narrow to our union.
      quote_source: (h.quoteSource === "thai_mutual_fund" ? "thai_mutual_fund" : "market"),
      fromHoldings: true,
    });
  }

  for (const k of KNOWN_TICKERS) {
    const key = k.ticker.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(k);
  }

  return merged;
}
