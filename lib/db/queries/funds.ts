// Fund-catalog queries — the shared contract over `fund_catalog` + `fund_fees`.
//
// Write side (ingestion): the daily SEC refresh job upserts funds and their fee
// time-series. Read side (consumers): the find_funds advisor tool and the Select
// UI list/filter funds and compare current fees.
//
// "Current fee" = the most recent record for a fee type: prefer the open period
// (`periodEnd IS NULL`), else the latest `periodStart`. We resolve this in JS
// after a per-fund fetch rather than in SQL — catalog scale is a few thousand
// funds on a single-VM SQLite, so clarity beats a window-function query here.

import { and, eq, inArray, sql } from "drizzle-orm";
import { isIndexStyle } from "../../market/fund-classify";
import { type FeeType, TER_FEE_TYPE } from "../../market/fund-fees";
import { searchFundIds } from "../../search/fund-index";
import { getMarketDb } from "../context";
import { fundCatalog, fundFees, fundQuotes } from "../schema";
import { listShareClassesByProj } from "./share-classes";

export type Fund = typeof fundCatalog.$inferSelect;
export type FundInsert = typeof fundCatalog.$inferInsert;
export type FundFee = typeof fundFees.$inferSelect;
export type FundFeeInsert = typeof fundFees.$inferInsert;

// ─── write side (refresh job) ───────────────────────────────────────────────

/** Insert or update one fund. Touches `updatedAt` on conflict. */
export function upsertFund(input: FundInsert): Fund {
  return getMarketDb()
    .insert(fundCatalog)
    .values(input)
    .onConflictDoUpdate({
      target: fundCatalog.projId,
      set: {
        abbrName: input.abbrName,
        thaiName: input.thaiName,
        englishName: input.englishName,
        amcName: input.amcName,
        fundType: input.fundType,
        policyDesc: input.policyDesc,
        assetClass: input.assetClass,
        policyDescTh: input.policyDescTh,
        managementStyle: input.managementStyle,
        taxIncentiveType: input.taxIncentiveType,
        distributionPolicy: input.distributionPolicy,
        investRegion: input.investRegion,
        isFeederFund: input.isFeederFund ?? false,
        feederMasterFund: input.feederMasterFund,
        isFixedTerm: input.isFixedTerm ?? false,
        initDate: input.initDate,
        isinCode: input.isinCode,
        aum: input.aum,
        aumDate: input.aumDate,
        secStatus: input.secStatus,
        status: input.status ?? "active",
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      },
    })
    .returning()
    .get();
}

/**
 * Upsert a batch of fee rows in a single transaction. The composite PK
 * (projId, fundClassName, feeTypeRaw, periodStart) makes this idempotent, so a
 * re-run of the same day's data is a no-op rather than a duplicate.
 */
export function upsertFundFees(rows: FundFeeInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    for (const row of rows) {
      tx.insert(fundFees)
        .values(row)
        .onConflictDoUpdate({
          target: [
            fundFees.projId,
            fundFees.fundClassName,
            fundFees.feeTypeRaw,
            fundFees.periodStart,
          ],
          set: {
            feeType: row.feeType,
            rateCeilingPct: row.rateCeilingPct,
            actualRatePct: row.actualRatePct,
            periodEnd: row.periodEnd,
            prospectusType: row.prospectusType,
            lastUpdDate: row.lastUpdDate,
          },
        })
        .run();
    }
  });

  // Keep the derived fund_catalog.current_ter cache in sync with the fees just
  // written, so findFunds can sort/annotate by TER without touching the full
  // fee history. Picks the current total_expense row (open period first, then
  // newest start) for exactly the funds in `rows`.
  const projIds = [...new Set(rows.map((r) => r.projId))];
  db.run(sql`
    UPDATE ${fundCatalog} SET current_ter = (
      SELECT COALESCE(${fundFees.actualRatePct}, ${fundFees.rateCeilingPct})
      FROM ${fundFees}
      WHERE ${fundFees.projId} = ${fundCatalog.projId}
        AND ${fundFees.feeType} = ${TER_FEE_TYPE}
      ORDER BY (${fundFees.periodEnd} IS NULL) DESC, ${fundFees.periodStart} DESC
      LIMIT 1
    )
    WHERE ${fundCatalog.projId} IN (${sql.join(
      projIds.map((p) => sql`${p}`),
      sql`, `,
    )})
  `);
}

// ─── read side (find_funds tool, Select UI) ─────────────────────────────────

/**
 * Current fee, per normalized type, for one fund. Picks the open period if there
 * is one, else the newest closed period. Keyed by `FeeType`; types with no data
 * are absent from the map.
 */
export function getCurrentFees(projId: string): Partial<Record<FeeType, FundFee>> {
  const rows = getMarketDb()
    .select()
    .from(fundFees)
    .where(eq(fundFees.projId, projId))
    .orderBy(
      // open period (periodEnd IS NULL) first, then newest start date
      sql`${fundFees.periodEnd} IS NULL DESC`,
      sql`${fundFees.periodStart} DESC`,
    )
    .all();

  return pickCurrentFees(rows);
}

/**
 * Reduce already-fetched fee rows (for a single fund) to the current record per
 * type. Rows MUST be pre-sorted open-period-first, then newest start date — the
 * same order `getCurrentFees`/`fetchCurrentFeesBatch` apply — so "first wins"
 * picks the most current record. Shared by the per-fund and batched paths so
 * both produce identical results.
 */
function pickCurrentFees(rows: FundFee[]): Partial<Record<FeeType, FundFee>> {
  const current: Partial<Record<FeeType, FundFee>> = {};
  for (const row of rows) {
    const ft = row.feeType as FeeType;
    if (!(ft in current)) current[ft] = row; // first wins = most current
  }
  return current;
}

/** TER from a fund's current-fee map. Same semantics as `getCurrentTer`. */
function terFromCurrentFees(current: Partial<Record<FeeType, FundFee>>): number | null {
  const ter = current[TER_FEE_TYPE];
  return ter?.actualRatePct ?? ter?.rateCeilingPct ?? null;
}

/**
 * The all-in fee (TER) a fund actually charges, as a percent, or `null` if the
 * SEC has not published a Total Fee and Expense figure for it. This is the
 * number the fee finder ranks and compares on.
 */
export function getCurrentTer(projId: string): number | null {
  return terFromCurrentFees(getCurrentFees(projId));
}

export type FundWithTer = Fund & { ter: number | null };

export type FindFundsFilter = {
  /** Normalized allocation class: 'equity' | 'bond' | 'alternative' | 'cash'. */
  assetClass?: string;
  /**
   * @deprecated fundType is always null in the catalog now (dead column).
   * Drop this filter from new callers; it is a no-op when fundType is null.
   */
  fundType?: string;
  /** Substring match against abbr / Thai / English name and policy text. */
  query?: string;
  /** Only funds the SEC still lists as offered. Defaults to true. */
  activeOnly?: boolean;
  /** Cap result size. Defaults to 50. */
  limit?: number;
  /** Restrict to index / passive funds (managementStyle IN 'PN', 'PM'). */
  indexOnly?: boolean;
  /** Restrict to a specific tax-advantaged wrapper. */
  taxIncentive?: "SSF" | "ThaiESG" | "RMF";
  /** Restrict to a geographic mandate. */
  region?: "foreign" | "domestic" | "mixed";
  /**
   * Exclude fixed-term funds — they stop accepting new subscriptions once
   * closed and aren't suitable for ongoing investing. Defaults to true.
   */
  excludeFixedTerm?: boolean;
};

/**
 * Find funds matching an exposure filter, each annotated with its current TER.
 *
 * Ordering depends on whether there is a text query:
 *   • No text query → cheapest-TER-first (the fee finder's "which funds give me
 *     this exposure for the lowest fee?" ranking; funds with no published TER
 *     sort last). Unchanged from before.
 *   • Text query → RELEVANCE first. Candidates come from the in-memory
 *     MiniSearch index (which matches abbr/name/policy AND the feeder master
 *     name, with fuzzy + prefix + alias expansion), already ranked by match
 *     quality. We preserve that order so a great name match isn't buried by a
 *     marginally cheaper unrelated fund. TER still annotates every row and only
 *     breaks ties between funds of equal relevance rank.
 *
 * Structured filters (activeOnly / assetClass / taxIncentive / region /
 * indexOnly / excludeFixedTerm) and the batched cheapest-first TER fetch are
 * applied identically in both paths, and the `FundWithTer[]` shape is unchanged.
 */
export function findFunds(filter: FindFundsFilter = {}): FundWithTer[] {
  const {
    assetClass,
    query,
    activeOnly = true,
    limit = 50,
    indexOnly,
    taxIncentive,
    region,
    excludeFixedTerm = true,
  } = filter;
  const conds = [];
  if (activeOnly) conds.push(eq(fundCatalog.status, "active"));
  if (assetClass) conds.push(eq(fundCatalog.assetClass, assetClass));
  if (taxIncentive) conds.push(eq(fundCatalog.taxIncentiveType, taxIncentive));
  if (region) conds.push(eq(fundCatalog.investRegion, region));
  if (excludeFixedTerm) conds.push(eq(fundCatalog.isFixedTerm, false));

  // Relevance rank by projId when a text query is present (0 = best match).
  // Absent → all funds share rank 0 and we fall back to TER ordering below.
  const queryStr = query?.trim();
  let relevanceRank: Map<string, number> | null = null;
  if (queryStr) {
    const ranked = searchFundIds(queryStr);
    if (ranked.length === 0) return []; // no text match → no results
    relevanceRank = new Map(ranked.map((id, i) => [id, i]));
    // Constrain the SQL fetch to the matched candidate set; the structured
    // filters above still apply on top, so e.g. activeOnly is honored.
    conds.push(inArray(fundCatalog.projId, ranked));
  }

  const funds = getMarketDb()
    .select()
    .from(fundCatalog)
    .where(conds.length ? and(...conds) : undefined)
    .all();

  // indexOnly filter is applied in JS after the query so we can reuse
  // isIndexStyle() without duplicating the PN/PM logic in SQL.
  const filtered = indexOnly ? funds.filter((f) => isIndexStyle(f.managementStyle)) : funds;

  // TER rides along with the catalog row (fund_catalog.current_ter — a derived
  // cache maintained by upsertFundFees), so no fee query is needed here at all.
  const withTer: FundWithTer[] = filtered.map((f) => ({
    ...f,
    ter: f.currentTer ?? null,
  }));

  const byTer = (a: FundWithTer, b: FundWithTer) => {
    if (a.ter == null) return b.ter == null ? 0 : 1; // nulls last
    if (b.ter == null) return -1;
    return a.ter - b.ter;
  };

  if (relevanceRank) {
    // Relevance first; TER (then nulls-last) only breaks ties at equal rank.
    withTer.sort((a, b) => {
      const ra = relevanceRank.get(a.projId) ?? Number.MAX_SAFE_INTEGER;
      const rb = relevanceRank.get(b.projId) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : byTer(a, b);
    });
  } else {
    withTer.sort(byTer);
  }

  return withTer.slice(0, limit);
}

/** A priceable share class for the Explore screener — class facts + parent metadata + NAV. */
export interface ShareClassListItem {
  /** Priceable ticker (the class code, or the abbr for single-class funds). */
  ticker: string;
  className: string;
  projId: string;
  abbrName: string | null;
  thaiName: string | null;
  englishName: string | null;
  amcName: string | null;
  assetClass: string | null;
  managementStyle: string | null;
  investRegion: string | null;
  isFeederFund: boolean;
  /** Master fund name when this is a feeder fund; null otherwise. */
  feederMasterFund: string | null;
  /** 'accumulating' | 'dividend' | null. */
  distributionPolicy: string | null;
  /** 'retail' | 'institutional' | 'insurance' | null. */
  investorType: string | null;
  /** 'SSF' | 'RMF' | 'ThaiESG' | null (per class). */
  taxIncentiveType: string | null;
  /** Per-class TER (falls back to the parent's derived TER). */
  ter: number | null;
  /** Latest cached NAV for this class, if any. */
  nav: number | null;
  navAsOf: string | null;
  /** Trailing 1-year return %, if cached. */
  y1Pct: number | null;
}

/**
 * Screener variant of {@link findFunds} that returns priceable SHARE CLASSES
 * rather than parent funds (decision D2b — NAV/fees/tax are per class). Reuses
 * findFunds for parent matching/ordering (relevance or cheapest-TER), then
 * expands each parent to its classes and applies class-level filters: the tax
 * wrapper is matched per class, and institutional/insurance classes are hidden
 * unless `includeNonRetail` is set (individuals can't subscribe to them).
 *
 * findFunds is left untouched — the advisor `find_funds` tool still gets parents.
 */
export function findShareClasses(
  filter: FindFundsFilter & { includeNonRetail?: boolean } = {},
): ShareClassListItem[] {
  const { limit = 50, taxIncentive, includeNonRetail = false, ...rest } = filter;
  // Pull parents generously (each yields several classes, most filtered out) so
  // class-level filtering still fills ~limit rows. Tax is applied per class below.
  const parents = findFunds({ ...rest, taxIncentive: undefined, limit: Math.max(limit * 4, 200) });

  const out: ShareClassListItem[] = [];
  for (const p of parents) {
    if (out.length >= limit) break;
    for (const c of listShareClassesByProj(p.projId)) {
      // Hide institutional/insurance classes by default; null (special/unknown)
      // audiences are kept so nothing is silently dropped.
      if (!includeNonRetail && c.investorType && c.investorType !== "retail") continue;
      if (taxIncentive && c.taxIncentiveType !== taxIncentive) continue;
      out.push({
        ticker: c.ticker,
        className: c.className,
        projId: p.projId,
        abbrName: p.abbrName,
        thaiName: p.thaiName,
        englishName: p.englishName,
        amcName: p.amcName,
        assetClass: p.assetClass,
        managementStyle: p.managementStyle,
        investRegion: p.investRegion,
        isFeederFund: p.isFeederFund,
        feederMasterFund: p.feederMasterFund,
        distributionPolicy: c.distributionPolicy,
        investorType: c.investorType,
        taxIncentiveType: c.taxIncentiveType,
        ter: c.currentTer ?? p.ter ?? null,
        nav: null,
        navAsOf: null,
        y1Pct: null,
      });
      if (out.length >= limit) break;
    }
  }

  // Batch-attach the latest cached NAV per class (cache key = source:ticker).
  if (out.length > 0) {
    const keyOf = (t: string) => `thai_mutual_fund:${t}`;
    const quotes = getMarketDb()
      .select({
        ticker: fundQuotes.ticker,
        nav: fundQuotes.nav,
        updatedAt: fundQuotes.updatedAt,
        y1Pct: fundQuotes.y1Pct,
      })
      .from(fundQuotes)
      .where(
        inArray(
          fundQuotes.ticker,
          out.map((x) => keyOf(x.ticker)),
        ),
      )
      .all();
    const qmap = new Map(quotes.map((q) => [q.ticker, q]));
    for (const x of out) {
      const q = qmap.get(keyOf(x.ticker));
      if (q) {
        x.nav = q.nav;
        x.navAsOf = q.updatedAt;
        x.y1Pct = q.y1Pct ?? null;
      }
    }
  }

  return out;
}

/**
 * Given a fund the user holds, find cheaper funds with comparable exposure
 * ranked by TER. Powers the "fee creep" flag in Analyze and the advisor's
 * cheaper-alternative suggestion. Returns only funds strictly cheaper than the
 * reference, capped.
 *
 * "Comparable" means same ACTUAL exposure, not just broad asset class: a
 * suggested peer must share both the reference fund's normalized `assetClass`
 * AND its geographic mandate (`investRegion`). Asset class alone is too loose —
 * it would offer a Thai-equity fund as an "alternative" to a global-equity one.
 * We deliberately err toward showing nothing over showing a wrong match.
 *
 * Region matching is exact, including null: if the reference has no region we
 * only match other region-less funds, never a fund with a differing non-null
 * region. (`findFunds`' `region` filter can't express "region IS NULL", so we
 * apply the region predicate here in JS.)
 */
export function getCheaperAlternatives(projId: string, limit = 5): FundWithTer[] {
  const ref = getMarketDb().select().from(fundCatalog).where(eq(fundCatalog.projId, projId)).get();
  if (!ref) return [];
  const refTer = getCurrentTer(projId);
  if (refTer == null) return [];

  const peers = findFunds({
    assetClass: ref.assetClass ?? undefined,
    limit: 200,
  });
  return peers
    .filter(
      (f) =>
        f.projId !== projId &&
        f.ter != null &&
        f.ter < refTer &&
        f.investRegion === ref.investRegion,
    )
    .slice(0, limit);
}

/** Look up catalog rows for a set of fund symbols (e.g. the user's holdings). */
export function getFundsByAbbr(abbrNames: string[]): Fund[] {
  if (abbrNames.length === 0) return [];
  return getMarketDb()
    .select()
    .from(fundCatalog)
    .where(inArray(fundCatalog.abbrName, abbrNames))
    .all();
}

/** Count of funds in the catalog (used by the refresh job to log coverage). */
export function countFunds(activeOnly = false): number {
  const row = getMarketDb()
    .select({ n: sql<number>`count(*)` })
    .from(fundCatalog)
    .where(activeOnly ? eq(fundCatalog.status, "active") : undefined)
    .get();
  return row?.n ?? 0;
}
