// Share-class queries — read/write over `fund_share_classes`, the priceable
// units of a fund (one row per SEC share class; see schema). The catalog
// refresh's share-class step upserts them; the Explore screener lists them, the
// fund detail resolves a ticker to its parent + sibling classes, and add-holding
// validates a typed ticker against them.

import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { quoteCacheKey, tickerKey } from "@/lib/market/sources";
import { getDb, getMarketDb } from "../context";
import { fundCatalog, fundQuotes, fundShareClasses, holdings, navHistory } from "../schema";

export type ShareClass = typeof fundShareClasses.$inferSelect;
export type ShareClassInsert = typeof fundShareClasses.$inferInsert;
/** A share class that still claims a ticker — see the `ticker` column note. */
export type LiveShareClass = ShareClass & { ticker: string };

const THAI_SOURCE = "thai_mutual_fund";

/**
 * A class with a NULL `ticker` has been superseded — another class took its code
 * (see `upsertShareClasses`). The row survives as an anchor for holdings recorded
 * against it, but it is no longer priceable, listable, or searchable, so every
 * read filters it out. Pair the SQL predicate with `liveTickers` to narrow the type.
 */
const HAS_TICKER = isNotNull(fundShareClasses.ticker);

const liveTickers = <T extends { ticker: string | null }>(rows: T[]) =>
  rows.filter((r): r is T & { ticker: string } => r.ticker !== null);

/**
 * Re-point a renamed share class's cached NAV to its NEW symbol (#235). When a
 * fund changes its code A→B (proj_id stable), the SEC serves NAV under B going
 * forward; moving the historical `A` cache rows to the `B` key keeps the value
 * chart continuous across the rename (the holding resolves to B via its anchor).
 * market.db is regenerable, so OR REPLACE on a rare key collision is safe.
 */
function repointNavCache(db: ReturnType<typeof getMarketDb>, oldTicker: string, newTicker: string) {
  const oldKey = quoteCacheKey(THAI_SOURCE, oldTicker);
  const newKey = quoteCacheKey(THAI_SOURCE, newTicker);
  if (oldKey === newKey) return; // case-only change → same cache key
  db.run(sql`UPDATE OR REPLACE ${fundQuotes} SET ticker = ${newKey} WHERE ticker = ${oldKey}`);
  db.run(sql`UPDATE OR REPLACE ${navHistory} SET ticker = ${newKey} WHERE ticker = ${oldKey}`);
}

/**
 * Drop the cached NAV/quote rows for a ticker that has changed hands between
 * funds. market.db is regenerable and the next prewarm refills it, so losing a
 * cache entry is cheap; serving the previous fund's prices under the new fund's
 * code is not.
 */
function purgeNavCache(db: ReturnType<typeof getMarketDb>, ticker: string) {
  const key = quoteCacheKey(THAI_SOURCE, ticker);
  db.run(sql`DELETE FROM ${fundQuotes} WHERE ticker = ${key}`);
  db.run(sql`DELETE FROM ${navHistory} WHERE ticker = ${key}`);
}

/** Batch-upsert share classes, keyed on (projId, className). A ticker CHANGE for an
 * existing class re-points its cached NAV to the new symbol so history is continuous. */
export function upsertShareClasses(rows: ShareClassInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  const renames: Array<{ oldTicker: string; newTicker: string }> = [];
  db.transaction((tx) => {
    for (const row of rows) {
      // NON-DESTRUCTIVE by design (the safe number of deletes in this hot path is
      // ZERO — keying a delete on any external id is how the catalog got wiped once).
      // A multi-class rebrand changes the class_name, so the new class lands as a
      // fresh (proj_id, class_name) row and the old one LINGERS, harmlessly: read
      // resolution prefers the most-recently-updated row sharing the ISIN, so it
      // always lands on the live class (resolveCatalogSymbol). A same-class code
      // change (the common single-class rename) re-points the NAV cache below.
      const prior = tx
        .select({ ticker: fundShareClasses.ticker })
        .from(fundShareClasses)
        .where(
          and(
            eq(fundShareClasses.projId, row.projId),
            eq(fundShareClasses.className, row.className),
          ),
        )
        .get();

      // Retire whoever else currently holds this ticker. Thai fund codes get
      // reused, and because this table never deletes, the superseded row was still
      // claiming the code — so the UNIQUE index on `ticker` aborted the whole
      // refresh. Three live cases on 2026-07-22: a fund re-registering under a new
      // proj_id (K-GSF(USD)), a matured fixed-term fund's code recycled for the next
      // term (KTFFE132), and a single-class fund going multi-class so the code moved
      // off its own "main" row (KKP WIN-UH-R).
      //
      // SEC no longer reports the code for that class, so the claim is dead — but
      // the ROW is still an anchor for holdings recorded against it, so it survives
      // with a NULL ticker instead of being deleted. Deletes keyed on an external id
      // are how the catalog got wiped once; the safe number here stays ZERO.
      if (row.ticker) {
        const heldBy = tx
          .select({ projId: fundShareClasses.projId, className: fundShareClasses.className })
          .from(fundShareClasses)
          .where(eq(fundShareClasses.ticker, row.ticker))
          .get();
        if (heldBy && (heldBy.projId !== row.projId || heldBy.className !== row.className)) {
          tx.update(fundShareClasses)
            .set({ ticker: null, updatedAt: sql`(CURRENT_TIMESTAMP)` })
            .where(
              and(
                eq(fundShareClasses.projId, heldBy.projId),
                eq(fundShareClasses.className, heldBy.className),
              ),
            )
            .run();
          // A DIFFERENT fund taking the code means the cached NAV under it is the
          // previous fund's price series. Inheriting it would draw a stranger's
          // history on the new fund's chart, so drop it and let the fetch refill.
          // (Same fund, code moved between its own classes → the series still
          // belongs to it; keep it.)
          if (heldBy.projId !== row.projId) purgeNavCache(db, row.ticker);
        }
      }

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
      const oldTicker = prior?.ticker;
      if (oldTicker && row.ticker && tickerKey(oldTicker) !== tickerKey(row.ticker))
        renames.push({ oldTicker, newTicker: row.ticker });
    }
    // Re-point inside the SAME transaction (#235): a crash between the share-class
    // upsert and the cache move would otherwise leave NAV under the dead key.
    // better-sqlite3 runs this on the same connection, so it's part of the savepoint.
    for (const r of renames) repointNavCache(db, r.oldTicker, r.newTicker);
  });
}

/**
 * The LIVE share classes of a fund (for the detail class selector), by proj_id.
 * Superseded classes — those whose code was taken by another class, leaving a NULL
 * ticker — are excluded: they aren't priceable, so they can't be selected, charted,
 * or resolved.
 */
export function listShareClassesByProj(projId: string): LiveShareClass[] {
  return liveTickers(
    getMarketDb()
      .select()
      .from(fundShareClasses)
      .where(and(eq(fundShareClasses.projId, projId), HAS_TICKER))
      .all(),
  );
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
  const where = [eq(fundCatalog.status, "active"), HAS_TICKER];
  if (opts.retailOnly) {
    where.push(
      sql`(${fundShareClasses.investorType} IS NULL OR ${fundShareClasses.investorType} NOT IN ('institutional', 'insurance'))`,
    );
  }
  const rows = db
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
  return liveTickers(rows);
}

/**
 * The priceable share-class tickers of EVERY fund any user HOLDS (macrotide is
 * multi-user in prod), resolved to their CURRENT code REGARDLESS of catalog status
 * (#235). The universe pre-warm (`listActiveShareClassTickers`) is active-only — so
 * a CLOSED/liquidated or brand-new IPO fund someone holds would never get its NAV
 * warmed and would lose its price. This adds them back: held funds are priced
 * whatever their lifecycle. As a nightly BATCH job (no request context), it reads
 * the holdings table directly across all users — the same all-users pattern as
 * `lib/jobs/refresh-tracked-market.ts` (see `holdings.ts` `ownedBucketIds`); a
 * request-path query would instead scope per user. The catalog (market.db) is
 * joined app-side via the stable `(proj_id, class_name)` anchor (so a renamed
 * holding resolves to its current symbol), with a ticker match for unanchored rows.
 * Two batched market.db queries — not one per held row — since the held set grows
 * with the whole user base.
 */
export function listHeldShareClassTickers(): ShareClassTicker[] {
  const held = getDb()
    .select({
      projId: holdings.catalogProjId,
      className: holdings.catalogClassName,
      ticker: holdings.ticker,
    })
    .from(holdings)
    .all();
  const db = getMarketDb();
  const cols = {
    projId: fundShareClasses.projId,
    ticker: fundShareClasses.ticker,
    className: fundShareClasses.className,
    investorType: fundShareClasses.investorType,
    name: sql<string>`COALESCE(${fundCatalog.abbrName}, ${fundShareClasses.ticker})`,
  };
  // Partition once: anchored rows resolve by (proj_id, class_name); the rest by an
  // upper-cased ticker match. Then ONE batched query per partition.
  const anchorPairs = new Map<string, string>();
  const projIds = new Set<string>();
  const tickerKeys = new Set<string>();
  for (const h of held) {
    if (h.projId && h.className) {
      anchorPairs.set(`${h.projId} ${h.className}`, h.ticker);
      projIds.add(h.projId);
    } else if (h.ticker.trim()) {
      tickerKeys.add(tickerKey(h.ticker));
    }
  }
  const out = new Map<string, ShareClassTicker>();
  if (projIds.size > 0) {
    for (const r of db
      .select(cols)
      .from(fundShareClasses)
      .innerJoin(fundCatalog, eq(fundShareClasses.projId, fundCatalog.projId))
      .where(inArray(fundShareClasses.projId, [...projIds]))
      .all()) {
      const heldTicker = anchorPairs.get(`${r.projId} ${r.className}`);
      if (heldTicker === undefined) continue;
      // The anchored class gave up its code to a successor (NULL ticker). Don't
      // drop the holding from the pre-warm — fall through to the ticker pass on
      // the code the user actually holds, which the successor now owns, so its
      // NAV keeps updating across the handover.
      if (r.ticker === null) {
        if (heldTicker.trim()) tickerKeys.add(tickerKey(heldTicker));
        continue;
      }
      out.set(r.ticker, { ...r, ticker: r.ticker });
    }
  }
  if (tickerKeys.size > 0) {
    for (const r of liveTickers(
      db
        .select(cols)
        .from(fundShareClasses)
        .innerJoin(fundCatalog, eq(fundShareClasses.projId, fundCatalog.projId))
        .where(inArray(sql`upper(${fundShareClasses.ticker})`, [...tickerKeys]))
        .all(),
    ))
      out.set(r.ticker, r);
  }
  return [...out.values()];
}
