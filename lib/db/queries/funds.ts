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

import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { isIndexStyle } from "../../market/fund-classify";
import { type FeeType, TER_FEE_TYPE } from "../../market/fund-fees";
import { getDb } from "../context";
import { fundCatalog, fundFees } from "../schema";

export type Fund = typeof fundCatalog.$inferSelect;
export type FundInsert = typeof fundCatalog.$inferInsert;
export type FundFee = typeof fundFees.$inferSelect;
export type FundFeeInsert = typeof fundFees.$inferInsert;

// ─── write side (refresh job) ───────────────────────────────────────────────

/** Insert or update one fund. Touches `updatedAt` on conflict. */
export function upsertFund(input: FundInsert): Fund {
  return getDb()
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
  const db = getDb();
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
}

// ─── read side (find_funds tool, Select UI) ─────────────────────────────────

/**
 * Current fee, per normalized type, for one fund. Picks the open period if there
 * is one, else the newest closed period. Keyed by `FeeType`; types with no data
 * are absent from the map.
 */
export function getCurrentFees(projId: string): Partial<Record<FeeType, FundFee>> {
  const rows = getDb()
    .select()
    .from(fundFees)
    .where(eq(fundFees.projId, projId))
    .orderBy(
      // open period (periodEnd IS NULL) first, then newest start date
      sql`${fundFees.periodEnd} IS NULL DESC`,
      sql`${fundFees.periodStart} DESC`,
    )
    .all();

  const current: Partial<Record<FeeType, FundFee>> = {};
  for (const row of rows) {
    const ft = row.feeType as FeeType;
    if (!(ft in current)) current[ft] = row; // first wins = most current
  }
  return current;
}

/**
 * The all-in fee (TER) a fund actually charges, as a percent, or `null` if the
 * SEC has not published a Total Fee and Expense figure for it. This is the
 * number the fee finder ranks and compares on.
 */
export function getCurrentTer(projId: string): number | null {
  const ter = getCurrentFees(projId)[TER_FEE_TYPE];
  return ter?.actualRatePct ?? ter?.rateCeilingPct ?? null;
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
 * Find funds matching an exposure filter, each annotated with its current TER
 * and sorted cheapest-first (funds with no published TER sort last). This is the
 * core of the fee-aware fund finder: "which funds give me this exposure for the
 * lowest fee?".
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
  if (query) {
    const q = `%${query}%`;
    conds.push(
      or(
        like(fundCatalog.abbrName, q),
        like(fundCatalog.thaiName, q),
        like(fundCatalog.englishName, q),
        like(fundCatalog.policyDesc, q),
      ),
    );
  }

  const funds = getDb()
    .select()
    .from(fundCatalog)
    .where(conds.length ? and(...conds) : undefined)
    .all();

  // indexOnly filter is applied in JS after the query so we can reuse
  // isIndexStyle() without duplicating the PN/PM logic in SQL.
  const filtered = indexOnly ? funds.filter((f) => isIndexStyle(f.managementStyle)) : funds;

  const withTer: FundWithTer[] = filtered.map((f) => ({ ...f, ter: getCurrentTer(f.projId) }));
  withTer.sort((a, b) => {
    if (a.ter == null) return b.ter == null ? 0 : 1; // nulls last
    if (b.ter == null) return -1;
    return a.ter - b.ter;
  });
  return withTer.slice(0, limit);
}

/**
 * Given a fund the user holds, find cheaper funds with comparable exposure
 * (same normalized asset class, falling back to SEC fund type) ranked by TER.
 * Powers the "fee creep" flag in Analyze and the advisor's cheaper-alternative
 * suggestion. Returns only funds strictly cheaper than the reference, capped.
 */
export function getCheaperAlternatives(projId: string, limit = 5): FundWithTer[] {
  const ref = getDb().select().from(fundCatalog).where(eq(fundCatalog.projId, projId)).get();
  if (!ref) return [];
  const refTer = getCurrentTer(projId);
  if (refTer == null) return [];

  const peers = findFunds({
    assetClass: ref.assetClass ?? undefined,
    limit: 200,
  });
  return peers
    .filter((f) => f.projId !== projId && f.ter != null && f.ter < refTer)
    .slice(0, limit);
}

/** Look up catalog rows for a set of fund symbols (e.g. the user's holdings). */
export function getFundsByAbbr(abbrNames: string[]): Fund[] {
  if (abbrNames.length === 0) return [];
  return getDb().select().from(fundCatalog).where(inArray(fundCatalog.abbrName, abbrNames)).all();
}

/** Count of funds in the catalog (used by the refresh job to log coverage). */
export function countFunds(activeOnly = false): number {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(fundCatalog)
    .where(activeOnly ? eq(fundCatalog.status, "active") : undefined)
    .get();
  return row?.n ?? 0;
}
