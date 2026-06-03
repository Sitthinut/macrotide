// Fund enrichment queries — read/write for the five SEC enrichment tables:
// fund_performance, fund_asset_allocation, fund_top_holdings,
// fund_portfolio, fund_portfolio_asset_type.
//
// Write side: upsert helpers called by the fund-catalog refresh job.
// Read side: typed getters for API routes and the advisor tool.

import { and, eq, ne, sql } from "drizzle-orm";
import { getMarketDb } from "../context";
import {
  fundAssetAllocation,
  fundPerformance,
  fundPortfolio,
  fundPortfolioAssetType,
  fundTopHoldings,
} from "../schema";

// SEC assetliab code for the "net asset value" / grand-total summary line
// (มูลค่าทรัพย์สินสุทธิ in portfolio, รวม in asset-type). It is a 100% total,
// not a holding — both /outstanding endpoints emit it, and no consumer wants it.
const TOTAL_ASSETLIAB_CODE = "903";

/**
 * Canonicalize a reporting period to a clean "YYYYMM" string.
 *
 * The SEC /outstanding endpoints return `period` as a JSON NUMBER (e.g. 202406)
 * even though our row type calls it a string. Binding that number to the TEXT
 * `period` column stores it as "202406.0", and the incremental guards below
 * compare a Set of stored STRINGS against the incoming NUMBER — `set.has(202406)`
 * is always false against "202406.0", so every crawl re-inserted the entire
 * portfolio (the 6× duplication bug). Normalizing both sides to an integer
 * string makes the comparison correct, keeps the stored value tidy ("202406"),
 * and heals legacy "202406.0" rows already on disk (they normalize identically).
 */
export function normalizePeriod(period: string | number | null | undefined): string {
  if (period == null) return "";
  const n = typeof period === "number" ? period : Number.parseFloat(period);
  return Number.isFinite(n) ? String(Math.trunc(n)) : String(period).trim();
}

// ─── Inferred row types ───────────────────────────────────────────────────────

export type FundPerformanceRow = typeof fundPerformance.$inferSelect;
export type FundPerformanceInsert = typeof fundPerformance.$inferInsert;

export type FundAssetAllocationRow = typeof fundAssetAllocation.$inferSelect;
export type FundAssetAllocationInsert = typeof fundAssetAllocation.$inferInsert;

export type FundTopHoldingRow = typeof fundTopHoldings.$inferSelect;
export type FundTopHoldingInsert = typeof fundTopHoldings.$inferInsert;

export type FundPortfolioRow = typeof fundPortfolio.$inferSelect;
export type FundPortfolioInsert = typeof fundPortfolio.$inferInsert;

export type FundPortfolioAssetTypeRow = typeof fundPortfolioAssetType.$inferSelect;
export type FundPortfolioAssetTypeInsert = typeof fundPortfolioAssetType.$inferInsert;

// ─── Write side ──────────────────────────────────────────────────────────────

/**
 * Replace all performance rows for a fund with a fresh set. Deletes existing
 * rows first (since the PK is (projId, fundClassName, performanceTypeDesc,
 * referencePeriod) a single insert/replace would leave orphan rows for
 * reference periods no longer in the latest factsheet).
 */
export function upsertFundPerformance(projId: string, rows: FundPerformanceInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    tx.delete(fundPerformance).where(eq(fundPerformance.projId, projId)).run();
    for (const row of rows) {
      tx.insert(fundPerformance).values(row).run();
    }
  });
}

/**
 * Replace all asset allocation rows for a fund. The latest factsheet snapshot
 * replaces the previous one entirely (asset_seq set may differ across snapshots).
 */
export function upsertFundAssetAllocation(projId: string, rows: FundAssetAllocationInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    tx.delete(fundAssetAllocation).where(eq(fundAssetAllocation.projId, projId)).run();
    for (const row of rows) {
      tx.insert(fundAssetAllocation).values(row).run();
    }
  });
}

/**
 * Replace all top-5 holding rows for a fund. The latest factsheet snapshot
 * replaces the previous one entirely.
 */
export function upsertFundTopHoldings(projId: string, rows: FundTopHoldingInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    tx.delete(fundTopHoldings).where(eq(fundTopHoldings.projId, projId)).run();
    for (const row of rows) {
      tx.insert(fundTopHoldings).values(row).run();
    }
  });
}

/**
 * Incrementally store portfolio rows for a fund: insert only the periods not
 * already present, preserving prior periods and NEVER deleting. The SEC
 * /outstanding endpoints return years of history; past periods are immutable,
 * so we accumulate them as a time series rather than rewriting nightly — and a
 * flaky or empty (HTTP 204) response can't wipe what we already have. The read
 * side (getFundPortfolio) surfaces only the latest period for display.
 *
 * Periods are normalized on BOTH sides of the guard (see {@link normalizePeriod})
 * — the feed sends `period` as a number, so without this the guard never matched
 * and every crawl duplicated the whole portfolio.
 */
export function upsertFundPortfolio(projId: string, rows: FundPortfolioInsert[]): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    const existing = new Set(
      tx
        .select({ period: fundPortfolio.period })
        .from(fundPortfolio)
        .where(eq(fundPortfolio.projId, projId))
        .all()
        .map((r) => normalizePeriod(r.period)),
    );
    for (const row of rows) {
      const period = normalizePeriod(row.period);
      if (existing.has(period)) continue;
      tx.insert(fundPortfolio)
        .values({ ...row, period })
        .run();
    }
  });
}

/**
 * Incrementally store portfolio-asset-type rows — same additive, period-
 * normalized strategy as upsertFundPortfolio: insert only new periods, never
 * delete the monthly history (it backs asset-mix-over-time). The composite PK
 * (projId, period, assetliabCode) guards against exact dupes, but the period is
 * still normalized so the stored value stays clean and the guard matches.
 */
export function upsertFundPortfolioAssetType(
  projId: string,
  rows: FundPortfolioAssetTypeInsert[],
): void {
  if (rows.length === 0) return;
  const db = getMarketDb();
  db.transaction((tx) => {
    const existing = new Set(
      tx
        .select({ period: fundPortfolioAssetType.period })
        .from(fundPortfolioAssetType)
        .where(eq(fundPortfolioAssetType.projId, projId))
        .all()
        .map((r) => normalizePeriod(r.period)),
    );
    for (const row of rows) {
      const period = normalizePeriod(row.period);
      if (existing.has(period)) continue;
      tx.insert(fundPortfolioAssetType)
        .values({ ...row, period })
        .run();
    }
  });
}

// ─── Read side ────────────────────────────────────────────────────────────────

/** All performance rows for one fund (latest snapshot). */
export function getFundPerformance(projId: string): FundPerformanceRow[] {
  return getMarketDb()
    .select()
    .from(fundPerformance)
    .where(eq(fundPerformance.projId, projId))
    .all();
}

/** Asset allocation rows for one fund (latest snapshot). */
export function getFundAssetAllocation(projId: string): FundAssetAllocationRow[] {
  return getMarketDb()
    .select()
    .from(fundAssetAllocation)
    .where(eq(fundAssetAllocation.projId, projId))
    .orderBy(fundAssetAllocation.assetSeq)
    .all();
}

/** Top-5 holdings for one fund (latest snapshot), ordered by rank. */
export function getFundTopHoldings(projId: string): FundTopHoldingRow[] {
  return getMarketDb()
    .select()
    .from(fundTopHoldings)
    .where(eq(fundTopHoldings.projId, projId))
    .orderBy(fundTopHoldings.assetSeq)
    .all();
}

/**
 * Full portfolio for one fund — LATEST period only.
 * The SEC /v2/fund/outstanding/portfolio endpoint returns every reported
 * quarter (years of history), not just the most recent one, so we filter to
 * the max period here — otherwise the UI stacks multiple quarters that each
 * sum to 100%. Defensive against the ingest storing more than one period.
 */
export function getFundPortfolio(projId: string): FundPortfolioRow[] {
  return getMarketDb()
    .select()
    .from(fundPortfolio)
    .where(
      and(
        eq(fundPortfolio.projId, projId),
        ne(fundPortfolio.assetliabId, TOTAL_ASSETLIAB_CODE),
        eq(
          fundPortfolio.period,
          sql`(select max(${fundPortfolio.period}) from ${fundPortfolio} where ${fundPortfolio.projId} = ${projId})`,
        ),
      ),
    )
    .all();
}

/**
 * Portfolio by asset type for one fund — LATEST month only.
 * Same as getFundPortfolio: the endpoint returns every reported month, so we
 * filter to the max period to avoid stacking dozens of 100% breakdowns.
 */
export function getFundPortfolioAssetType(projId: string): FundPortfolioAssetTypeRow[] {
  return getMarketDb()
    .select()
    .from(fundPortfolioAssetType)
    .where(
      and(
        eq(fundPortfolioAssetType.projId, projId),
        ne(fundPortfolioAssetType.assetliabCode, TOTAL_ASSETLIAB_CODE),
        eq(
          fundPortfolioAssetType.period,
          sql`(select max(${fundPortfolioAssetType.period}) from ${fundPortfolioAssetType} where ${fundPortfolioAssetType.projId} = ${projId})`,
        ),
      ),
    )
    .all();
}

/**
 * Composite fund detail — returns all enrichment data for one fund in a
 * single call. Any table that has no data returns an empty array.
 * Suitable for a fund-detail API route response body.
 */
export function getFundEnrichment(projId: string): {
  performance: FundPerformanceRow[];
  assetAllocation: FundAssetAllocationRow[];
  topHoldings: FundTopHoldingRow[];
  portfolio: FundPortfolioRow[];
  portfolioAssetType: FundPortfolioAssetTypeRow[];
} {
  return {
    performance: getFundPerformance(projId),
    assetAllocation: getFundAssetAllocation(projId),
    topHoldings: getFundTopHoldings(projId),
    portfolio: getFundPortfolio(projId),
    portfolioAssetType: getFundPortfolioAssetType(projId),
  };
}
