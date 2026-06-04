import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../context";
import { holdings, transactions } from "../schema";

export type Holding = typeof holdings.$inferSelect;
export type HoldingInsert = typeof holdings.$inferInsert;
export type HoldingUpdate = Partial<Omit<HoldingInsert, "id" | "createdAt">>;

export function listHoldings(bucketId?: string): Holding[] {
  const q = getDb().select().from(holdings);
  return (bucketId ? q.where(eq(holdings.bucketId, bucketId)) : q).all();
}

export function getHolding(id: number): Holding | undefined {
  return getDb().select().from(holdings).where(eq(holdings.id, id)).get();
}

export function createHolding(input: HoldingInsert): Holding {
  return getDb().insert(holdings).values(input).returning().get();
}

export function updateHolding(id: number, patch: HoldingUpdate): Holding | undefined {
  return getDb()
    .update(holdings)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(holdings.id, id))
    .returning()
    .get();
}

export function deleteHolding(id: number): void {
  getDb().delete(holdings).where(eq(holdings.id, id)).run();
}

/**
 * Rename a `source` label across all holdings in the given buckets. The caller
 * passes the user's own bucket ids (resolved via the user-scoped listBuckets in
 * the route), so a user can only rewrite their own holdings. Empty `to` clears
 * the label (NULL). Returns the number of rows changed.
 */
export function renameHoldingSource(bucketIds: string[], from: string, to: string): number {
  if (bucketIds.length === 0) return 0;
  const db = getDb();
  // `source` is ledger-carried identity (ADR 0004): rename it on the ledger too,
  // or the next projection rebuild would revert the holding rows. Both are kept
  // in step so they never disagree.
  db.update(transactions)
    .set({ source: to || null })
    .where(and(eq(transactions.source, from), inArray(transactions.bucketId, bucketIds)))
    .run();
  const res = db
    .update(holdings)
    .set({ source: to || null, updatedAt: new Date().toISOString() })
    .where(and(eq(holdings.source, from), inArray(holdings.bucketId, bucketIds)))
    .run();
  return res.changes;
}
