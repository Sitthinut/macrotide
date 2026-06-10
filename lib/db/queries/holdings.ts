import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { ProjectedPosition } from "@/lib/portfolio/project-positions";
import { getDb } from "../context";
import { holdings, transactions } from "../schema";
import { enrichHoldingsWithCatalog } from "./holding-enrichment";
import { projectBucketPositions } from "./project-holdings";

/** The stored holdings row: instrument metadata + identity only — NO position. */
export type HoldingRow = typeof holdings.$inferSelect;
export type HoldingInsert = typeof holdings.$inferInsert;
export type HoldingUpdate = Partial<Omit<HoldingInsert, "id" | "createdAt">>;

/**
 * A holding as the app reads it: the stored metadata row PLUS the live position
 * (`units`/`avgCost`) folded from the ledger on read (ADR 0004). The position is
 * never stored — the `holdings` table holds only the instrument metadata that has
 * no home in the ledger (name, asset class, quote source, portfolio). So units,
 * cost, value, gains, and weight always reflect the latest NAV and can't disagree
 * with the analytics, which folds the same ledger.
 */
export type Holding = HoldingRow & {
  units: number;
  avgCost: number | null;
  /** SEC risk-spectrum code, overlaid from the catalog (market.db) by
   * enrichHoldingsWithCatalog — absent for non-catalog holdings. */
  riskSpectrum?: string | null;
  /**
   * Broker name when this holding was imported from a connected broker, else
   * null. RELIABLE: derived only from ledger rows carrying a non-null
   * `external_id` (the dedup anchor that only broker imports stamp) — a
   * manually-entered holding whose free-text `source` merely names a broker is
   * NOT flagged. Drives the "synced" icon in the holdings list.
   * See {@link syncedBrokerForBuckets}.
   */
  syncedBroker?: string | null;
};

/**
 * Fold the reliable broker-sync signal for a set of buckets: the broker name per
 * held ticker, keyed `${bucketId} ${ticker}`. A holding counts as synced only
 * when one of its ledger rows has a non-null `external_id` (`sourceTag:account:ref`)
 * — the marker that ONLY broker imports stamp; a hand-typed `source` never
 * qualifies. The label is that row's `source` (the displayName kept in step with
 * holdings.source by renameHoldingSource), falling back to the sourceTag prefix.
 * One ledger scan — no per-holding queries.
 */
function syncedBrokerForBuckets(bucketIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (bucketIds.length === 0) return out;
  const rows = getDb()
    .select({
      bucketId: transactions.bucketId,
      ticker: transactions.ticker,
      source: transactions.source,
      externalId: transactions.externalId,
    })
    .from(transactions)
    .where(and(inArray(transactions.bucketId, bucketIds), isNotNull(transactions.externalId)))
    .all();
  for (const r of rows) {
    const key = `${r.bucketId} ${r.ticker}`;
    if (out.has(key)) continue; // first synced row wins; stable label per holding
    const broker = r.source?.trim() || (r.externalId ?? "").split(":")[0];
    if (broker) out.set(key, broker);
  }
  return out;
}

/** Overlay the live fold onto stored rows. A row the ledger no longer folds to a
 * held position is OMITTED — the fold, not the row, decides what you hold (a
 * sold-out holding's row is already gone, deleted by the rebuild). */
function overlayLive(rows: HoldingRow[]): Holding[] {
  if (rows.length === 0) return [];
  const buckets = new Set(rows.map((h) => h.bucketId));
  const live = new Map<string, ProjectedPosition>();
  for (const b of buckets)
    for (const p of projectBucketPositions(b)) live.set(`${b} ${p.ticker}`, p);
  const synced = syncedBrokerForBuckets([...buckets]);
  const out: Holding[] = [];
  for (const h of rows) {
    const p = live.get(`${h.bucketId} ${h.ticker}`);
    if (!p) continue;
    out.push({
      ...h,
      units: p.units,
      avgCost: p.avgCost,
      acquiredOn: h.acquiredOn ?? p.acquiredOn,
      syncedBroker: synced.get(`${h.bucketId} ${h.ticker}`) ?? null,
    });
  }
  return out;
}

export function listHoldings(bucketId?: string): Holding[] {
  const q = getDb().select().from(holdings);
  const rows = (bucketId ? q.where(eq(holdings.bucketId, bucketId)) : q).all();
  return enrichHoldingsWithCatalog(overlayLive(rows));
}

export function getHolding(id: number): Holding | undefined {
  const row = getDb().select().from(holdings).where(eq(holdings.id, id)).get();
  if (!row) return undefined;
  // Load by id even when the ledger folds to no position (units 0) — the metadata
  // row exists and may need editing.
  const p = projectBucketPositions(row.bucketId).find((x) => x.ticker === row.ticker);
  const syncedBroker =
    syncedBrokerForBuckets([row.bucketId]).get(`${row.bucketId} ${row.ticker}`) ?? null;
  return enrichHoldingsWithCatalog([
    { ...row, units: p?.units ?? 0, avgCost: p?.avgCost ?? null, syncedBroker },
  ])[0];
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
