import "server-only";
import { and, inArray, lte, sql } from "drizzle-orm";
import { getMarketDb } from "../context";
import { fundQuotes, navHistory } from "../schema";

export type FundQuote = typeof fundQuotes.$inferSelect;
export type FundQuoteInsert = typeof fundQuotes.$inferInsert;

export function listFundQuotes(tickers?: string[]): FundQuote[] {
  const q = getMarketDb().select().from(fundQuotes);
  return (tickers?.length ? q.where(inArray(fundQuotes.ticker, tickers)) : q).all();
}

/**
 * NAV on or before `date` for each cache key — the most recent `nav_history` row
 * with `date <= date`. The divisor for deriving units from a dated value (#130):
 * a holding's unit count is fixed to its date, so a value stated for a past date
 * must divide by THAT date's NAV, never today's moving NAV (pairing them makes
 * the unit count drift). A "right now" Balance's date is today, so this returns
 * the latest historical NAV — the same rule, no special case.
 *
 * Keys are the combined `${source}:${ticker}` cache keys (see lib/market/cache.ts).
 * Missing keys are simply absent from the map; callers fall back to the latest
 * quote (fund_quotes) or flag the row needs-units.
 */
export function navOnDate(keys: string[], date: string): Map<string, number> {
  const out = new Map<string, number>();
  if (keys.length === 0) return out;
  // One grouped query: max(date) ≤ target per ticker, with its bare `nav` (SQLite's
  // documented "bare column travels with the aggregate's row" rule — same pattern
  // as the series carry-in read).
  const rows = getMarketDb()
    .select({
      ticker: navHistory.ticker,
      date: sql<string>`max(${navHistory.date})`.as("d"),
      nav: navHistory.nav,
    })
    .from(navHistory)
    .where(and(inArray(navHistory.ticker, keys), lte(navHistory.date, date)))
    .groupBy(navHistory.ticker)
    .all();
  for (const r of rows) if (r.nav > 0) out.set(r.ticker, r.nav);
  return out;
}

export function upsertFundQuote(input: FundQuoteInsert): FundQuote {
  return getMarketDb()
    .insert(fundQuotes)
    .values(input)
    .onConflictDoUpdate({
      target: fundQuotes.ticker,
      set: {
        nav: input.nav,
        d1Pct: input.d1Pct,
        ytdPct: input.ytdPct,
        y1Pct: input.y1Pct,
        updatedAt: input.updatedAt,
      },
    })
    .returning()
    .get();
}
