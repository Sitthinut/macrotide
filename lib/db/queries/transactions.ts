import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../context";
import { transactions } from "../schema";
import { rebuildHoldingsForBucket, rebuildHoldingsForBuckets } from "./project-holdings";

// Transaction ledger queries.
//
// SCOPING NOTE: `transactions` has no `user_id` — it is scoped through its
// parent bucket, exactly like `holdings`. There is deliberately NO unscoped
// `listAllTransactions()`. The scoping invariant lives in the CALLER: a route
// resolves the owner's bucket set first (listBuckets() / getBucket(), which ARE
// user-scoped) and only then queries by those bucket ids. Keep it that way.
//
// DERIVED HOLDINGS (ADR 0004): the ledger is the source of truth for positions;
// `holdings` is a projection of it. Every mutation here rebuilds the affected
// buckets' holdings rows so the two never drift.

export type Transaction = typeof transactions.$inferSelect;
export type TransactionInsert = typeof transactions.$inferInsert;

/** All transactions in one bucket, oldest trade first. Caller must own the bucket. */
export function listTransactionsByBucket(bucketId: string): Transaction[] {
  return getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.bucketId, bucketId))
    .orderBy(transactions.tradeDate, transactions.id)
    .all();
}

/** All transactions across the given (caller-owned) buckets, oldest trade first. */
export function listTransactionsForBuckets(bucketIds: string[]): Transaction[] {
  if (bucketIds.length === 0) return [];
  return getDb()
    .select()
    .from(transactions)
    .where(inArray(transactions.bucketId, bucketIds))
    .orderBy(transactions.tradeDate, transactions.id)
    .all();
}

/** Insert a batch of rows atomically, then rebuild the affected buckets' holdings. */
export function insertTransactions(rows: TransactionInsert[]): Transaction[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const inserted = db.transaction((tx) =>
    rows.map((r) => tx.insert(transactions).values(r).returning().get()),
  );
  rebuildHoldingsForBuckets(rows.map((r) => r.bucketId));
  return inserted;
}

/**
 * Update one transaction (gated by the caller-owned bucket set), then rebuild
 * the affected bucket's holdings. Returns the updated row, or undefined if the
 * id isn't in an owned bucket. The caller (route) is responsible for deriving a
 * coherent signed `amount` from the kind — this layer writes the patch verbatim.
 */
export function updateTransaction(
  id: number,
  ownedBucketIds: string[],
  patch: Partial<Omit<TransactionInsert, "id" | "bucketId" | "createdAt">>,
): Transaction | undefined {
  if (ownedBucketIds.length === 0) return undefined;
  const db = getDb();
  const existing = db
    .select({ bucketId: transactions.bucketId })
    .from(transactions)
    .where(and(eq(transactions.id, id), inArray(transactions.bucketId, ownedBucketIds)))
    .get();
  if (!existing) return undefined;
  const updated = db
    .update(transactions)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(transactions.id, id))
    .returning()
    .get();
  rebuildHoldingsForBucket(existing.bucketId);
  return updated;
}

/**
 * Delete one transaction, gated by the caller-owned bucket set so a user can
 * only delete their own rows. Returns the number of rows removed (0 if the row
 * isn't in an owned bucket).
 */
export function deleteTransaction(id: number, ownedBucketIds: string[]): number {
  if (ownedBucketIds.length === 0) return 0;
  const db = getDb();
  // Capture the bucket before deleting so we can rebuild its projection after.
  const row = db
    .select({ bucketId: transactions.bucketId })
    .from(transactions)
    .where(and(eq(transactions.id, id), inArray(transactions.bucketId, ownedBucketIds)))
    .get();
  const res = db
    .delete(transactions)
    .where(and(eq(transactions.id, id), inArray(transactions.bucketId, ownedBucketIds)))
    .run();
  if (row) rebuildHoldingsForBucket(row.bucketId);
  return res.changes;
}

/** Delete a whole import batch (undo), gated by the caller-owned bucket set. */
export function deleteTransactionBatch(importBatchId: string, ownedBucketIds: string[]): number {
  if (ownedBucketIds.length === 0) return 0;
  const db = getDb();
  const affected = db
    .selectDistinct({ bucketId: transactions.bucketId })
    .from(transactions)
    .where(
      and(
        eq(transactions.importBatchId, importBatchId),
        inArray(transactions.bucketId, ownedBucketIds),
      ),
    )
    .all();
  const res = db
    .delete(transactions)
    .where(
      and(
        eq(transactions.importBatchId, importBatchId),
        inArray(transactions.bucketId, ownedBucketIds),
      ),
    )
    .run();
  rebuildHoldingsForBuckets(affected.map((r) => r.bucketId));
  return res.changes;
}
