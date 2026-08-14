// US dividend-history queries — the detail page's dividend list + the freshness
// used for bounded/JIT refresh. Rows come from Alpaca corporate actions.

import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { UsDividend } from "../../market/corporate-actions";
import { tickerKey } from "../../market/sources";
import { getMarketDb } from "../context";
import { usDividends, usSecurities } from "../schema";

export type UsDividendRow = typeof usDividends.$inferSelect;

export interface DividendHistory {
  fetchedAt: string | null;
  dividends: UsDividendRow[];
}

/**
 * The identity of a PAYMENT, used to collapse the feed's restatements without
 * losing genuine same-day pairs.
 *
 * Alpaca sometimes reports one dividend twice with a corrected payable date
 * (QQQ 2022-09-19: same rate, same record date, payable 09-23 and 10-31) — one
 * payment, counted twice, would inflate trailing yield. But a regular and a
 * supplemental dividend also share an ex-date and are two real payments. Ex-date
 * plus record date plus amount plus the special flag separates them: the
 * restatement matches on all four, the pair differs in amount or in `special`.
 * Payable date is deliberately excluded — it is the field that gets corrected.
 */
const paymentIdentity = (d: UsDividend) =>
  `${d.exDate}|${d.recordDate ?? ""}|${d.cashAmount}|${d.special ? 1 : 0}`;

/** Replace a symbol's dividend rows + stamp `dividends_fetched_at`. Atomic. */
export function setDividends(symbol: string, dividends: UsDividend[], fetchedAt: string): number {
  const key = tickerKey(symbol);
  if (!key) return 0;
  const db = getMarketDb();
  const seen = new Set<string>();
  const rows = dividends
    .filter((d) => {
      const id = paymentIdentity(d);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((d) => ({
      symbol: key,
      exDate: d.exDate,
      payableDate: d.payableDate,
      recordDate: d.recordDate,
      cashAmount: d.cashAmount,
      special: d.special,
    }));
  db.transaction((tx) => {
    tx.delete(usDividends).where(eq(usDividends.symbol, key)).run();
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      tx.insert(usDividends)
        .values(rows.slice(i, i + CHUNK))
        .run();
    }
    tx.update(usSecurities)
      .set({ dividendsFetchedAt: fetchedAt })
      .where(sql`UPPER(${usSecurities.symbol}) = ${key}`)
      .run();
  });
  return rows.length;
}

/** A symbol's dividend history (newest ex-date first) + when it was fetched. */
export function getDividends(symbol: string): DividendHistory {
  const key = tickerKey(symbol);
  if (!key) return { fetchedAt: null, dividends: [] };
  const db = getMarketDb();
  const dividends = db
    .select()
    .from(usDividends)
    .where(eq(usDividends.symbol, key))
    .orderBy(sql`${usDividends.exDate} DESC`)
    .all();
  const meta = db
    .select({ fetchedAt: usSecurities.dividendsFetchedAt })
    .from(usSecurities)
    .where(sql`UPPER(${usSecurities.symbol}) = ${key}`)
    .get();
  return { fetchedAt: meta?.fetchedAt ?? null, dividends };
}

/** Active symbols whose dividends to refresh next — popularity/views, stalest first. */
export function listSymbolsToRefreshDividends(
  limit: number,
  opts: { staleBefore?: string } = {},
): string[] {
  const clauses = [eq(usSecurities.status, "active")];
  if (opts.staleBefore) {
    clauses.push(
      sql`(${usSecurities.dividendsFetchedAt} IS NULL OR ${usSecurities.dividendsFetchedAt} < ${opts.staleBefore})`,
    );
  }
  return getMarketDb()
    .select({ symbol: usSecurities.symbol })
    .from(usSecurities)
    .where(and(...clauses))
    .orderBy(
      sql`${usSecurities.popularityScore} DESC`,
      sql`${usSecurities.viewCount} DESC`,
      sql`${usSecurities.dividendsFetchedAt} IS NOT NULL`,
      asc(usSecurities.dividendsFetchedAt),
    )
    .limit(limit)
    .all()
    .map((r) => r.symbol);
}
