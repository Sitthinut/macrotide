// Share-class queries — read/write over `fund_share_classes`, the priceable
// units of a fund (one row per SEC share class; see schema). The catalog
// refresh's share-class step upserts them; the Explore screener lists them, the
// fund detail resolves a ticker to its parent + sibling classes, and add-holding
// validates a typed ticker against them.

import { and, eq, sql } from "drizzle-orm";
import { getMarketDb } from "../context";
import { fundCatalog, fundShareClasses } from "../schema";

export type ShareClass = typeof fundShareClasses.$inferSelect;
export type ShareClassInsert = typeof fundShareClasses.$inferInsert;

/** Batch-upsert share classes, keyed on (projId, className). */
export function upsertShareClasses(rows: ShareClassInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(fundShareClasses)
        .values(row)
        .onConflictDoUpdate({
          target: [fundShareClasses.projId, fundShareClasses.className],
          set: {
            ticker: row.ticker,
            classDetailTh: row.classDetailTh,
            distributionPolicy: row.distributionPolicy,
            investorType: row.investorType,
            taxIncentiveType: row.taxIncentiveType,
            isinCode: row.isinCode,
            currentTer: row.currentTer,
            updatedAt: sql`(CURRENT_TIMESTAMP)`,
          },
        })
        .run();
    }
  });
}

/** All share classes of a fund (for the detail class selector), by proj_id. */
export function listShareClassesByProj(projId: string): ShareClass[] {
  return getMarketDb()
    .select()
    .from(fundShareClasses)
    .where(eq(fundShareClasses.projId, projId))
    .all();
}

/** Resolve a priceable ticker to its share class (+ parent proj_id), or undefined. */
export function getShareClassByTicker(ticker: string): ShareClass | undefined {
  return getMarketDb()
    .select()
    .from(fundShareClasses)
    .where(eq(fundShareClasses.ticker, ticker))
    .get();
}

/** One priceable ticker, joined to its parent's name + raw SEC class. */
export interface ShareClassTicker {
  projId: string;
  ticker: string;
  /** Raw SEC `fund_class_name` ("main" for single-class funds, "MDIVA-A" else). */
  className: string;
  investorType: string | null;
  /** Parent fund abbr (falls back to the ticker) — a label for the NAV fetch. */
  name: string;
}

/**
 * Enumerate every priceable share-class ticker for *active* (Registered/IPO)
 * funds — the work-list for the NAV pre-warm crawler (issue #104). Inner-joined
 * to `fund_catalog` so only currently-offered funds are crawled (liquidated /
 * expired funds are skipped); `name` carries the parent abbr purely to label the
 * fetch.
 *
 * `retailOnly` drops institutional + insurance classes (NULL `investor_type` is
 * kept — single-class "main" funds are unclassified but buyable), the subset an
 * individual can't buy. On multi-class funds that sharply cuts crawl volume.
 */
export function listActiveShareClassTickers(
  opts: { retailOnly?: boolean } = {},
): ShareClassTicker[] {
  const db = getMarketDb();
  const where = [eq(fundCatalog.status, "active")];
  if (opts.retailOnly) {
    where.push(
      sql`(${fundShareClasses.investorType} IS NULL OR ${fundShareClasses.investorType} NOT IN ('institutional', 'insurance'))`,
    );
  }
  return db
    .select({
      projId: fundShareClasses.projId,
      ticker: fundShareClasses.ticker,
      className: fundShareClasses.className,
      investorType: fundShareClasses.investorType,
      name: sql<string>`COALESCE(${fundCatalog.abbrName}, ${fundShareClasses.ticker})`,
    })
    .from(fundShareClasses)
    .innerJoin(fundCatalog, eq(fundShareClasses.projId, fundCatalog.projId))
    .where(and(...where))
    .all();
}
