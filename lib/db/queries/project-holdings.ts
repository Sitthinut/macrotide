import "server-only";
import { and, eq } from "drizzle-orm";
import {
  type ProjectedPosition,
  type ProjectionEvent,
  projectPositions,
} from "@/lib/portfolio/project-positions";
import { getDb } from "../context";
import { holdings, transactions } from "../schema";
import type { Holding } from "./holdings";
import { foldableEvents } from "./resolve-derived-units";
import type { Transaction, TransactionInsert } from "./transactions";

// Holdings-as-projection orchestration (ADR 0004). The ledger (`transactions`)
// is the source of truth for POSITIONS; `holdings` is a derived cache that this
// module rebuilds after every ledger write. The pure projection math lives in
// lib/portfolio/project-positions.ts; this layer does only the DB I/O —
// read the ledger, project, merge the user-editable instrument metadata that has
// no home in the ledger, and write the holdings rows.

/** The default cost-basis method (ADR 0003/0004: moving average; FIFO is a future per-bucket setting). */
const DEFAULT_METHOD = "average" as const;

/** Map a stored ledger row to the projection's event shape. */
function toProjectionEvent(r: Transaction): ProjectionEvent {
  return {
    id: r.id,
    ticker: r.ticker,
    kind: r.kind as ProjectionEvent["kind"],
    tradeDate: r.tradeDate,
    units: r.units,
    pricePerUnit: r.pricePerUnit,
    amount: r.amount,
    createdAt: r.createdAt,
    quoteSource: r.quoteSource,
    englishName: r.englishName,
    source: r.source,
  };
}

/**
 * Fold one bucket's ledger into its derived positions (one per held ticker) —
 * the single source of position truth, shared by the read path (holdings reads
 * overlay these live) and the write path (rebuild persists row existence +
 * metadata). Facts-only: the missing unit count (value-only Balances + amount-only
 * trades) is derived from NAV(date) here, and an anchor we still can't price is
 * DROPPED (foldableEvents) so it never wipes a position by folding as zero.
 */
export function projectBucketPositions(bucketId: string): ProjectedPosition[] {
  const events = getDb()
    .select()
    .from(transactions)
    .where(eq(transactions.bucketId, bucketId))
    .all();
  return projectPositions(foldableEvents(events).map(toProjectionEvent), DEFAULT_METHOD);
}

/**
 * Rebuild the derived `holdings` rows for one bucket from its ledger. Positions
 * (units, avgCost) come from the ledger; instrument metadata (thaiName,
 * category, assetClass, region, ter, color) is preserved from the existing row.
 * A position that nets to zero units is removed. Idempotent and deterministic:
 * running it twice on the same ledger yields the same rows.
 *
 * The persisted units/avgCost are a write-time snapshot for row existence and a
 * fallback; the live read path (`listHoldings`/`getHolding`) re-folds and overlays
 * fresh figures, so reads never serve a position frozen at the last write.
 */
export function rebuildHoldingsForBucket(bucketId: string): void {
  const db = getDb();
  const positions = projectBucketPositions(bucketId);

  const existing = db.select().from(holdings).where(eq(holdings.bucketId, bucketId)).all();
  const byTicker = new Map(existing.map((h) => [h.ticker, h]));
  const now = new Date().toISOString();

  db.transaction((tx) => {
    const seen = new Set<string>();
    for (const p of positions) {
      seen.add(p.ticker);
      const prev = byTicker.get(p.ticker);
      if (prev) {
        // Overwrite the DERIVED position columns; leave metadata untouched.
        tx.update(holdings)
          .set({
            units: p.units,
            avgCost: p.avgCost,
            quoteSource: p.quoteSource,
            englishName: p.englishName || prev.englishName,
            source: p.source ?? prev.source,
            acquiredOn: prev.acquiredOn ?? p.acquiredOn,
            updatedAt: now,
          })
          .where(eq(holdings.id, prev.id))
          .run();
      } else {
        // First time we've seen this ticker — create the row with whatever
        // identity the ledger carries; metadata fills in via later edits.
        tx.insert(holdings)
          .values({
            bucketId,
            ticker: p.ticker,
            englishName: p.englishName || p.ticker,
            units: p.units,
            avgCost: p.avgCost,
            quoteSource: p.quoteSource,
            source: p.source,
            acquiredOn: p.acquiredOn,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
    // Drop holdings whose ticker no longer nets to a held position.
    for (const h of existing) {
      if (!seen.has(h.ticker)) tx.delete(holdings).where(eq(holdings.id, h.id)).run();
    }
  });
}

/** Rebuild several buckets (e.g. after a multi-bucket import). */
export function rebuildHoldingsForBuckets(bucketIds: Iterable<string>): void {
  for (const id of new Set(bucketIds)) rebuildHoldingsForBucket(id);
}

// ─── Holdings write paths, routed through the ledger (ADR 0004) ───────────────
//
// "Add a holding" / "edit a holding" / "delete a holding" are sugar over ledger
// events: the user never types a position directly. Each function makes its
// ledger change with raw ops, then runs ONE rebuild so the projection lands once.

/** Input for {@link createHoldingViaLedger} — the snapshot "add holding" payload. */
export interface CreateHoldingInput {
  bucketId: string;
  ticker: string;
  englishName: string;
  quoteSource: string;
  units: number;
  /** Avg cost per unit; null/undefined → an uncosted opening (cost unknown). */
  avgCost?: number | null;
  source?: string | null;
  acquiredOn?: string | null;
  // Instrument metadata (no home in the ledger; lands on the holding row).
  thaiName?: string | null;
  category?: string | null;
  assetClass?: string | null;
  region?: string | null;
  ter?: number | null;
  color?: string | null;
}

/** Patch for {@link editHoldingViaLedger} — any subset of position/identity/metadata. */
export interface EditHoldingPatch {
  ticker?: string;
  englishName?: string;
  quoteSource?: string;
  units?: number;
  avgCost?: number | null;
  source?: string | null;
  thaiName?: string | null;
  category?: string | null;
  assetClass?: string | null;
  region?: string | null;
  ter?: number | null;
  color?: string | null;
}

const METADATA_KEYS = ["thaiName", "category", "assetClass", "region", "ter", "color"] as const;

function pickMetadata(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of METADATA_KEYS) if (patch[k] !== undefined) out[k] = patch[k];
  return out;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const NUM_EPSILON = 1e-9;
function numChanged(next: number | null | undefined, prev: number | null): boolean {
  if (next === undefined) return false;
  if (next === null || prev === null) return next !== prev;
  return Math.abs(next - prev) > NUM_EPSILON;
}

/**
 * Create a holding from the snapshot "add holding" flow: write an `opening`
 * anchor, rebuild, then stamp the instrument metadata onto the derived row.
 */
export function createHoldingViaLedger(input: CreateHoldingInput): Holding | undefined {
  const db = getDb();
  const avgCost = input.avgCost ?? null;
  db.insert(transactions)
    .values({
      bucketId: input.bucketId,
      ticker: input.ticker,
      englishName: input.englishName,
      quoteSource: input.quoteSource,
      kind: "opening",
      tradeDate: input.acquiredOn ?? today(),
      units: input.units,
      pricePerUnit: avgCost,
      amount: avgCost != null ? -(input.units * avgCost) : 0,
      fee: null,
      tradeCurrency: "THB",
      fxToThb: 1,
      source: input.source ?? null,
      importBatchId: "add-holding",
    })
    .run();
  rebuildHoldingsForBucket(input.bucketId);

  const meta = pickMetadata(input as unknown as Record<string, unknown>);
  const row = db
    .select()
    .from(holdings)
    .where(and(eq(holdings.bucketId, input.bucketId), eq(holdings.ticker, input.ticker)))
    .get();
  if (row && Object.keys(meta).length > 0) {
    db.update(holdings)
      .set({ ...meta, updatedAt: new Date().toISOString() })
      .where(eq(holdings.id, row.id))
      .run();
  }
  return db
    .select()
    .from(holdings)
    .where(eq(holdings.id, row?.id ?? -1))
    .get();
}

/**
 * Edit a holding "directly" — sugar over the ledger (ADR 0004):
 *   • metadata (name/colour/category/TER/…) updates the row;
 *   • a position change (units/avgCost) edits the single backing event when there
 *     is exactly one, else appends a `snapshot` anchor (history preserved);
 *   • a ticker/quoteSource change is propagated to the ledger so identity stays
 *     consistent.
 * One rebuild lands the result. Returns the updated holding, or undefined if the
 * id doesn't exist.
 */
export function editHoldingViaLedger(id: number, patch: EditHoldingPatch): Holding | undefined {
  const db = getDb();
  const h = db.select().from(holdings).where(eq(holdings.id, id)).get();
  if (!h) return undefined;
  const bucketId = h.bucketId;
  const oldTicker = h.ticker;
  const newTicker = (patch.ticker ?? oldTicker).trim() || oldTicker;
  const now = new Date().toISOString();

  // 1. Identity onto the ledger (ticker / quoteSource / englishName / source).
  const idSet: Record<string, unknown> = {};
  if (newTicker !== oldTicker) idSet.ticker = newTicker;
  if (patch.quoteSource) idSet.quoteSource = patch.quoteSource;
  if (patch.englishName !== undefined) idSet.englishName = patch.englishName;
  if (patch.source !== undefined) idSet.source = patch.source;
  if (Object.keys(idSet).length > 0) {
    db.update(transactions)
      .set(idSet)
      .where(and(eq(transactions.bucketId, bucketId), eq(transactions.ticker, oldTicker)))
      .run();
  }

  // 2. Position change → edit the single backing event, else append a snapshot.
  if (numChanged(patch.units, h.units) || numChanged(patch.avgCost, h.avgCost)) {
    const newUnits = patch.units ?? h.units;
    const newAvg = patch.avgCost !== undefined ? patch.avgCost : h.avgCost;
    const events = db
      .select()
      .from(transactions)
      .where(and(eq(transactions.bucketId, bucketId), eq(transactions.ticker, newTicker)))
      .orderBy(transactions.tradeDate, transactions.id)
      .all();
    if (events.length === 1) {
      const e = events[0];
      const isSnapshot = e.kind === "snapshot";
      db.update(transactions)
        .set({
          units: newUnits,
          pricePerUnit: newAvg,
          // A snapshot moves no cash; a single opening/buy carries the cost out.
          amount: isSnapshot ? 0 : newAvg != null ? -(newUnits * newAvg) : 0,
          updatedAt: now,
        })
        .where(eq(transactions.id, e.id))
        .run();
    } else {
      db.insert(transactions)
        .values({
          bucketId,
          ticker: newTicker,
          englishName: patch.englishName ?? h.englishName,
          quoteSource: patch.quoteSource ?? h.quoteSource,
          kind: "snapshot",
          tradeDate: today(),
          units: newUnits,
          pricePerUnit: newAvg,
          amount: 0,
          fee: null,
          tradeCurrency: "THB",
          fxToThb: 1,
          importBatchId: "edit-snapshot",
        })
        .run();
    }
  }

  // 3. Rename the row BEFORE rebuild so the projection matches it (keeps id + metadata).
  if (newTicker !== oldTicker) {
    db.update(holdings).set({ ticker: newTicker }).where(eq(holdings.id, id)).run();
  }

  // 4. Metadata onto the row.
  const meta = pickMetadata(patch as unknown as Record<string, unknown>);
  if (Object.keys(meta).length > 0) {
    db.update(holdings)
      .set({ ...meta, updatedAt: now })
      .where(eq(holdings.id, id))
      .run();
  }

  // 5. One rebuild lands the derived position columns.
  rebuildHoldingsForBucket(bucketId);
  return db.select().from(holdings).where(eq(holdings.id, id)).get();
}

/**
 * Delete a holding by removing its backing ledger events, then rebuilding (which
 * drops the now-empty position). Returns false if the id doesn't exist.
 */
export function deleteHoldingViaLedger(id: number): boolean {
  const db = getDb();
  const h = db.select().from(holdings).where(eq(holdings.id, id)).get();
  if (!h) return false;
  db.delete(transactions)
    .where(and(eq(transactions.bucketId, h.bucketId), eq(transactions.ticker, h.ticker)))
    .run();
  rebuildHoldingsForBucket(h.bucketId);
  // Defensive: if the holding had no ledger events at all (legacy row), drop it.
  db.delete(holdings).where(eq(holdings.id, id)).run();
  return true;
}

/**
 * Build the `opening` ledger anchor that reproduces a snapshot holding — used by
 * the seeds and the prod backfill so an existing/seeded holding becomes a
 * first-class ledger event. A holding with no avg cost becomes an UNCOSTED
 * opening (cost basis unknown; gains degrade gracefully).
 */
export function openingFromHolding(
  h: Pick<
    Holding,
    | "bucketId"
    | "ticker"
    | "englishName"
    | "quoteSource"
    | "units"
    | "avgCost"
    | "source"
    | "acquiredOn"
    | "createdAt"
  >,
  importBatchId = "backfill-opening",
): TransactionInsert {
  const tradeDate = h.acquiredOn ?? h.createdAt.slice(0, 10);
  const costed = h.avgCost != null;
  return {
    bucketId: h.bucketId,
    ticker: h.ticker,
    englishName: h.englishName,
    quoteSource: h.quoteSource,
    kind: "opening",
    tradeDate,
    units: h.units,
    pricePerUnit: h.avgCost ?? null,
    amount: costed ? -(h.units * (h.avgCost as number)) : 0,
    fee: null,
    tradeCurrency: "THB",
    fxToThb: 1,
    source: h.source ?? null,
    importBatchId,
  };
}
