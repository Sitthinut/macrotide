// Share-class queries — read/write over `fund_share_classes`, the priceable
// units of a fund (one row per SEC share class; see schema). The catalog
// refresh's share-class step upserts them; the Explore screener lists them, the
// fund detail resolves a ticker to its parent + sibling classes, and add-holding
// validates a typed ticker against them.

import { eq, sql } from "drizzle-orm";
import { getMarketDb } from "../context";
import { fundShareClasses } from "../schema";

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
