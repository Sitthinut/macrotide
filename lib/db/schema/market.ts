import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// ───────────────────────────────────────────────────────────────────────────
// market.db — the regenerable market-data store (env MARKET_DB_PATH, default
// data/market.db). Everything here is rebuildable from upstream sources (the
// SEC Open API, EDGAR, the live-quote providers) so it is NOT backed up.
//
// No FK in this file crosses into app.db: the fund_* tables reference
// fund_catalog; nav_history / fund_quotes are keyed by a soft cache key. The
// user-owned `holdings` table (app.db) links to market data only via the
// `ticker`+`quoteSource` routing key resolved in app code, never a SQL join.
// ───────────────────────────────────────────────────────────────────────────

// Latest NAV + perf cache (written by the live-market refresh).
export const fundQuotes = sqliteTable("fund_quotes", {
  ticker: text("ticker").primaryKey(),
  nav: real("nav").notNull(),
  d1Pct: real("d1_pct"),
  ytdPct: real("ytd_pct"),
  y1Pct: real("y1_pct"),
  updatedAt: text("updated_at").notNull(),
});

// Daily NAV history (written by the live-market refresh).
export const navHistory = sqliteTable(
  "nav_history",
  {
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    nav: real("nav").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.date] }),
    index("idx_nav_history_date").on(table.date),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// Fund catalog — the universe of Thai-registered funds and their fees, refreshed
// daily from the SEC Open API. Powers the fee-aware fund finder ("Select"): given
// a target exposure, name the lowest-fee fund that delivers it. Distinct from
// `holdings` (what the user owns) and `fund_quotes` (live NAV cache).
// ───────────────────────────────────────────────────────────────────────────

// One row per fund, keyed by the SEC's internal project id (`proj_id`).
export const fundCatalog = sqliteTable(
  "fund_catalog",
  {
    // SEC internal fund id (e.g. "M0017_2538"). The join key to fund_fees.
    projId: text("proj_id").primaryKey(),
    // Short fund symbol / abbreviation (e.g. "K-FIXED"). The human-facing ticker,
    // aligns with holdings.ticker where the user holds the fund.
    abbrName: text("abbr_name"),
    thaiName: text("thai_name"),
    englishName: text("english_name"),
    // Asset management company (e.g. "Kasikorn Asset Management").
    amcName: text("amc_name"),
    // SEC fund classification, raw (e.g. "Fixed Income", "Foreign Investment Fund").
    fundType: text("fund_type"),
    // Investment-policy text — used for exposure matching ("S&P 500 feeder").
    policyDesc: text("policy_desc"),
    // Our normalized allocation taxonomy, mirrors holdings.assetClass:
    // 'equity' | 'bond' | 'alternative' | 'cash'. NULL = mixed/unclassifiable.
    // Derived from `policyDescTh` (the v2 API has no fund-type field — see
    // lib/market/fund-classify.ts).
    assetClass: text("asset_class"),
    // Short Thai asset-type label from the SEC (ตราสารหนี้ / ตราสารทุน / ผสม /
    // ทรัพย์สินทางเลือก) — the source for `assetClass` inference.
    policyDescTh: text("policy_desc_th"),
    // Management style: 'AM' active | 'PN' passive/index-tracking | 'SM'
    // systematic | 'PM' passive multi-factor | 'BH' buy-and-hold (fixed term).
    // 'PN' is the index-fund marker — core to the index-investor filter.
    managementStyle: text("management_style"),
    // Tax-advantaged wrapper, if any: 'SSF' | 'ThaiESG' | NULL. Primary driver
    // for Thai retail investors.
    taxIncentiveType: text("tax_incentive_type"),
    // Share-class character: 'accumulating' | 'dividend' | NULL — matters for tax.
    distributionPolicy: text("distribution_policy"),
    // Geographic mandate from the SEC `invest_country_flag`:
    // 'foreign' | 'mixed' | 'domestic' | NULL.
    investRegion: text("invest_region"),
    // Feeder funds (the main vehicle for Thai access to global indices).
    isFeederFund: integer("is_feeder_fund", { mode: "boolean" }).notNull().default(false),
    feederMasterFund: text("feeder_master_fund"),
    // Fixed-term funds mature and stop accepting subscriptions; excluded from
    // ongoing-investment recommendations.
    isFixedTerm: integer("is_fixed_term", { mode: "boolean" }).notNull().default(false),
    initDate: text("init_date"), // fund inception (ISO date)
    isinCode: text("isin_code"), // ~30% coverage; for external cross-reference
    // Latest total net asset value (THB) + the NAV date it was read on. Small
    // funds (low AUM) have poor liquidity; used to down-rank dormant funds.
    aum: real("aum"),
    aumDate: text("aum_date"),
    // Raw SEC `fund_status`: 'Registered' | 'IPO' | 'Liquidated' | 'Expired' |
    // 'Canceled'. `status` below is derived from this.
    secStatus: text("sec_status"),
    // Derived from `secStatus`: 'active' (Registered/IPO) = currently offered;
    // 'inactive' = liquidated/expired/canceled (kept for history). Drives the
    // fund finder's active-only default.
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("idx_fund_catalog_asset_class").on(table.assetClass),
    index("idx_fund_catalog_status").on(table.status),
    index("idx_fund_catalog_mgmt_style").on(table.managementStyle),
    index("idx_fund_catalog_tax").on(table.taxIncentiveType),
    // Name columns the fund-finder search LIKE-matches on. A leading-wildcard
    // LIKE ('%term%') can't use a btree index, but anchored/prefix matches and
    // ordering on these columns do — and the schema should carry them anyway.
    index("idx_fund_catalog_abbr_name").on(table.abbrName),
    index("idx_fund_catalog_english_name").on(table.englishName),
    index("idx_fund_catalog_thai_name").on(table.thaiName),
  ],
);

// Fund fees — a time-series, one row per (fund, share class, fee type, period),
// mirroring the SEC FundFactsheet fees endpoint. The SEC reports a max/ceiling
// rate (`rateCeilingPct`) and the rate actually charged in the period
// (`actualRatePct`); the fee finder ranks on the latter. The currently-active
// record has `periodEnd IS NULL`. `feeType` is our normalized enum; `feeTypeRaw`
// preserves the original SEC label so an unrecognized fee type still round-trips.
export const fundFees = sqliteTable(
  "fund_fees",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    // Normalized: 'front_end' | 'back_end' | 'management' | 'total_expense' | 'other'.
    feeType: text("fee_type").notNull(),
    // Original SEC `fee_type_desc` (Thai + English), kept for audit / unknown types.
    feeTypeRaw: text("fee_type_raw").notNull(),
    // SEC `rate` — prospectus ceiling (% p.a. or % of transaction), incl. VAT.
    rateCeilingPct: real("rate_ceiling_pct"),
    // SEC `actual_value` — rate actually charged in the period (% p.a.).
    actualRatePct: real("actual_rate_pct"),
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end"), // NULL = currently active
    prospectusType: text("prospectus_type"), // 'Monthly' | 'SignificantFactsheet'
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({
      columns: [table.projId, table.fundClassName, table.feeTypeRaw, table.periodStart],
    }),
    index("idx_fund_fees_current").on(table.projId, table.feeType, table.periodEnd),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// SEC fund enrichment tables — populated by the fund-catalog refresh job when
// the relevant SEC_INGEST_* env flags are set. Each stores only the LATEST
// effective snapshot to keep the DB small (no full history).
// ───────────────────────────────────────────────────────────────────────────

// Fund performance — all performance types per fund/class from the factsheet
// performance endpoint (/v2/fund/factsheet/performance). One row per
// (projId, fundClassName, performanceTypeDesc, referencePeriod) — the latest
// factsheet window only (latest=true in the API call).
export const fundPerformance = sqliteTable(
  "fund_performance",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    // Start/end date of the factsheet period (end IS NULL = currently active).
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    // One of: "ความผันผวนของกองทุนรวม" | "ความผันผวนของดัชนีชี้วัด" |
    //         "ผลการดำเนินงานของกองทุนรวม" | "ผลการดำเนินงานของดัชนีชี้วัด" | (peer avg)
    performanceTypeDesc: text("performance_type_desc").notNull(),
    referencePeriod: text("reference_period").notNull(),
    performanceValue: text("performance_value"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({
      columns: [
        table.projId,
        table.fundClassName,
        table.performanceTypeDesc,
        table.referencePeriod,
      ],
    }),
    index("idx_fund_performance_proj").on(table.projId),
  ],
);

// Fund asset allocation — latest factsheet snapshot from
// /v2/fund/factsheet/asset-allocation. One row per (projId, assetSeq) since
// the API returns at most one latest effective snapshot per fund.
export const fundAssetAllocation = sqliteTable(
  "fund_asset_allocation",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    assetSeq: integer("asset_seq").notNull(),
    assetName: text("asset_name"),
    // Investment ratio as %NAV (e.g. 95.68).
    assetRatio: real("asset_ratio"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.assetSeq] }),
    index("idx_fund_asset_alloc_proj").on(table.projId),
  ],
);

// Top-5 holdings — latest factsheet snapshot from
// /v2/fund/factsheet/top5-holdings. One row per (projId, assetSeq).
export const fundTopHoldings = sqliteTable(
  "fund_top_holdings",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    assetSeq: integer("asset_seq").notNull(),
    assetName: text("asset_name"),
    // Investment ratio as %NAV (e.g. 5.30).
    assetRatio: real("asset_ratio"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.assetSeq] }),
    index("idx_fund_top_holdings_proj").on(table.projId),
  ],
);

// Full quarterly portfolio — latest quarter only from
// /v2/fund/outstanding/portfolio. One row per (projId, period, assetliabId).
// NOTE: ingesting full portfolio data roughly doubles the API calls per crawl
// (many funds have 100+ holdings each, requiring multiple paginated pages).
// Recommend running on a less-than-nightly cadence (e.g. weekly) or scoping
// to a subset of funds. Controlled by SEC_INGEST_PORTFOLIO env flag.
export const fundPortfolio = sqliteTable(
  "fund_portfolio",
  {
    // Surrogate key. A fund holds many securities that share an assetliab_id
    // (it is an asset/liability CATEGORY, not a per-security id), so there is no
    // natural composite key — (proj_id, period, assetliab_id) collides. The
    // delete-then-insert-by-proj_id upsert provides idempotency across crawls.
    id: integer("id").primaryKey({ autoIncrement: true }),
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    // Reporting period in YYYYMM format (e.g. "202412").
    period: text("period").notNull(),
    asOfDate: text("as_of_date"),
    // Asset/liability item identifier (e.g. "101").
    assetliabId: text("assetliab_id"),
    assetliabDesc: text("assetliab_desc"),
    issueCode: text("issue_code"),
    isinCode: text("isin_code"),
    issuer: text("issuer"),
    // Market value in THB.
    assetliabValue: real("assetliab_value"),
    // Percentage of NAV.
    percentNav: real("percent_nav"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    index("idx_fund_portfolio_proj").on(table.projId),
    // The read side filters by (proj_id, period) and resolves the latest period
    // via a MAX(period) subquery over this 800k+ row table. A composite index on
    // (proj_id, period) turns that scan into an index range/seek.
    index("idx_fund_portfolio_proj_period").on(table.projId, table.period),
  ],
);

// Monthly portfolio by asset type — latest month from
// /v2/fund/outstanding/portfolio-asset-type. One row per (projId, period, assetliabCode).
export const fundPortfolioAssetType = sqliteTable(
  "fund_portfolio_asset_type",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    // Reporting period in YYYYMM format.
    period: text("period").notNull(),
    assetliabCode: text("assetliab_code").notNull(),
    assetliabDesc: text("assetliab_desc"),
    marketValue: real("market_value"),
    percentNav: real("percent_nav"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.period, table.assetliabCode] }),
    index("idx_fund_portfolio_asset_type_proj").on(table.projId),
    // Mirrors fund_portfolio: the read side seeks by (proj_id, period) and a
    // MAX(period) subquery. The composite PK's (proj_id, period) prefix already
    // serves this, but the explicit index keeps the two portfolio tables
    // symmetric and survives any future PK change.
    index("idx_fund_portfolio_asset_type_proj_period").on(table.projId, table.period),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// Feeder fund look-through — maps a Thai feeder fund (proj_id) to a foreign
// master fund identified by ISIN, and stores the master fund's published
// holdings fetched from the provider's public daily CSV.
// Controlled by EXTERNAL_INGEST_FEEDER_HOLDINGS env flag (default OFF).
// ───────────────────────────────────────────────────────────────────────────

// Maps a Thai feeder fund to its master fund ISIN for look-through.
// One row per feeder fund — only the single master fund relationship matters
// (Thai feeder funds invest ≥80% in a single foreign master fund by SEC rules).
export const feederMasterMap = sqliteTable(
  "feeder_master_map",
  {
    // Thai SEC proj_id for the feeder fund.
    projId: text("proj_id")
      .primaryKey()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    // ISIN of the foreign master fund (e.g. "IE00B5BMR087" for CSPX).
    masterIsin: text("master_isin").notNull(),
    // Human-readable master fund name for display (e.g. "iShares Core S&P 500 UCITS ETF").
    masterName: text("master_name"),
    // Source of the master fund data: 'ishares' | 'vanguard' | 'manual'.
    provider: text("provider").notNull().default("ishares"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_feeder_master_map_isin").on(table.masterIsin)],
);

// Look-through holdings — latest snapshot of the master fund's published
// holdings, fetched from the provider's public CSV. Replaces on each crawl
// (delete-then-insert). Only the LATEST snapshot is kept.
export const feederLookThroughHoldings = sqliteTable(
  "feeder_look_through_holdings",
  {
    // The Thai feeder fund proj_id (join to feeder_master_map).
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    // Rank within the master fund (1 = largest holding by weight).
    rank: integer("rank").notNull(),
    // Security name as published by the master fund provider.
    name: text("name").notNull(),
    // Ticker symbol (may be empty for bonds/cash).
    ticker: text("ticker"),
    // Asset class label from the provider (Equity, Fixed Income, Cash, Other).
    assetClass: text("asset_class"),
    // ISIN of the underlying security (may be empty).
    isin: text("isin"),
    // Weight as % of master fund NAV (e.g. 7.23 for 7.23%).
    weightPct: real("weight_pct"),
    // "As of" date of the holdings snapshot (ISO date string YYYY-MM-DD).
    asOfDate: text("as_of_date"),
    // When this row was last refreshed by the crawl job.
    fetchedAt: text("fetched_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.rank] }),
    index("idx_feeder_look_through_proj").on(table.projId),
  ],
);
