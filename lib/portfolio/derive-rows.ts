import "server-only";
import { listFundQuotes } from "@/lib/db/queries/quotes";
import { type DerivedRow, deriveRow, type ExtractedRow, inferQuoteSource } from "./ocr";

// Shared NAV-derivation for extracted holding rows. Both the image-import route
// (POST /api/import/image) and the advisor's `propose_holdings_import` tool turn
// raw vision-extracted rows into NAV-derived rows for the confirmation table, so
// the units/avgCost math (and the cache-key lookup it depends on) lives here once
// rather than being duplicated. Pulls the latest NAV from market.db via
// listFundQuotes; rows we can't price come back with `needsUnits` set so the UI
// asks the user to fill them in. See deriveRow (lib/portfolio/ocr.ts) for the
// per-row precedence rules.

/**
 * Build the composite `${source}:${TICKER}` cache key used by `fund_quotes`
 * (lib/market/cache.ts) — the SAME key `deriveRow` consumers must look up by, so
 * the NAV lookup actually hits. Exported for tests.
 */
export function quoteCacheKey(ticker: string): string {
  return `${inferQuoteSource(ticker)}:${ticker.trim().toUpperCase()}`;
}

/**
 * Derive units/avgCost for each extracted row from the latest NAV on file.
 * Server-only — reads market.db through the request's DB context.
 */
export function deriveRowsWithNav(rows: ExtractedRow[]): DerivedRow[] {
  if (rows.length === 0) return [];

  // fund_quotes is keyed by the combined "source:ticker" cache key, not the bare
  // symbol — build the same key per row so the NAV lookup hits.
  const navByKey = new Map<string, number>();
  const keys = rows.map((r) => quoteCacheKey(r.ticker));
  for (const q of listFundQuotes(keys)) {
    if (q.nav > 0) navByKey.set(q.ticker, q.nav);
  }

  return rows.map((r) => deriveRow(r, navByKey.get(quoteCacheKey(r.ticker))));
}
