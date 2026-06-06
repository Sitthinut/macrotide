import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../context";
import { holdings, transactions } from "../schema";
import { projectBucketPositions } from "./project-holdings";

export type Holding = typeof holdings.$inferSelect;
export type HoldingInsert = typeof holdings.$inferInsert;
export type HoldingUpdate = Partial<Omit<HoldingInsert, "id" | "createdAt">>;

// Read-through fold (ADR 0004). `holdings` rows carry the instrument metadata that
// has no home in the ledger (name, asset class, quote source, portfolio, custom
// flag); their `units`/`avgCost` are a write-time snapshot. On READ we re-fold the
// ledger and overlay the live position, so a holding's units/cost — and therefore
// its value, gains, and weight — always reflect the latest NAV, never a figure
// frozen at the last write. This matches the analytics path (which already folds on
// read), so the two can no longer disagree.
function overlayLive(rows: Holding[]): Holding[] {
  if (rows.length === 0) return rows;
  const buckets = new Set(rows.map((h) => h.bucketId));
  const live = new Map<
    string,
    { units: number; avgCost: number | null; acquiredOn: string | null }
  >();
  for (const b of buckets)
    for (const p of projectBucketPositions(b)) live.set(`${b} ${p.ticker}`, p);
  return rows.map((h) => {
    const p = live.get(`${h.bucketId} ${h.ticker}`);
    // No live position → keep the stored snapshot. This is resilient, not stale: a
    // genuinely sold-out holding has its row DELETED by the rebuild (so it's already
    // absent here), and a value-only holding the ledger can't price right now keeps
    // its last-known units rather than vanishing on a transient market-data gap.
    if (!p) return h;
    return { ...h, units: p.units, avgCost: p.avgCost, acquiredOn: h.acquiredOn ?? p.acquiredOn };
  });
}

export function listHoldings(bucketId?: string): Holding[] {
  const q = getDb().select().from(holdings);
  const rows = (bucketId ? q.where(eq(holdings.bucketId, bucketId)) : q).all();
  return overlayLive(rows);
}

export function getHolding(id: number): Holding | undefined {
  const row = getDb().select().from(holdings).where(eq(holdings.id, id)).get();
  if (!row) return undefined;
  const p = projectBucketPositions(row.bucketId).find((x) => x.ticker === row.ticker);
  return p ? { ...row, units: p.units, avgCost: p.avgCost } : row;
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
