// Feeder fund look-through queries — read/write for the two feeder enrichment
// tables: feeder_master_map and feeder_look_through_holdings.
//
// Write side: upsert helpers called by the fund-catalog refresh job when
//   EXTERNAL_INGEST_FEEDER_HOLDINGS=1 is set.
// Read side: typed getters for the API route and FundDetailSheet.

import { eq } from "drizzle-orm";
import { getMarketDb } from "../context";
import { feederLookThroughHoldings, feederMasterMap } from "../schema";

// ─── Inferred row types ───────────────────────────────────────────────────────

export type FeederMasterMapRow = typeof feederMasterMap.$inferSelect;
export type FeederMasterMapInsert = typeof feederMasterMap.$inferInsert;

export type FeederLookThroughHoldingRow = typeof feederLookThroughHoldings.$inferSelect;
export type FeederLookThroughHoldingInsert = typeof feederLookThroughHoldings.$inferInsert;

// ─── Write side ──────────────────────────────────────────────────────────────

/**
 * Upsert the master fund mapping for a feeder fund. Overwrites any existing
 * entry (a feeder fund maps to exactly one master fund at a time).
 */
export function upsertFeederMasterMap(row: FeederMasterMapInsert): void {
  const db = getMarketDb();
  db.insert(feederMasterMap)
    .values(row)
    .onConflictDoUpdate({
      target: feederMasterMap.projId,
      set: {
        masterIsin: row.masterIsin,
        masterName: row.masterName ?? null,
        provider: row.provider ?? "ishares",
      },
    })
    .run();
}

/**
 * Replace all look-through holdings for a feeder fund. Deletes the existing
 * snapshot first so stale rows from a previous crawl are never mixed with
 * the latest data (the CSV is a complete snapshot, not an incremental diff).
 */
export function upsertFeederLookThroughHoldings(
  projId: string,
  rows: FeederLookThroughHoldingInsert[],
): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    tx.delete(feederLookThroughHoldings).where(eq(feederLookThroughHoldings.projId, projId)).run();
    for (const row of rows) {
      tx.insert(feederLookThroughHoldings).values(row).run();
    }
  });
}

// ─── Read side ────────────────────────────────────────────────────────────────

/** Every feeder → master mapping. Used by the catalog transform to fold
 * curated master names into facet derivation (index family). */
export function listFeederMasterMap(): FeederMasterMapRow[] {
  return getMarketDb().select().from(feederMasterMap).all();
}

/** Feeder → master mapping for one fund. Returns null if not mapped. */
export function getFeederMasterMap(projId: string): FeederMasterMapRow | null {
  return (
    getMarketDb().select().from(feederMasterMap).where(eq(feederMasterMap.projId, projId)).get() ??
    null
  );
}

/**
 * Look-through holdings for one feeder fund (latest snapshot), ordered by
 * rank ascending (largest holding first = rank 1).
 */
export function getFeederLookThroughHoldings(projId: string): FeederLookThroughHoldingRow[] {
  return getMarketDb()
    .select()
    .from(feederLookThroughHoldings)
    .where(eq(feederLookThroughHoldings.projId, projId))
    .orderBy(feederLookThroughHoldings.rank)
    .all();
}

/**
 * Composite feeder enrichment for one fund — returns both the master map row
 * and the look-through holdings in a single call.
 */
export function getFeederEnrichment(projId: string): {
  masterMap: FeederMasterMapRow | null;
  lookThroughHoldings: FeederLookThroughHoldingRow[];
} {
  return {
    masterMap: getFeederMasterMap(projId),
    lookThroughHoldings: getFeederLookThroughHoldings(projId),
  };
}
