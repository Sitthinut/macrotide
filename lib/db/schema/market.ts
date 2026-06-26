import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
  /**
   * Widest series range ever fetched for this key (e.g. "6mo", "max"). Lets the
   * cache deepen a shallow series when a wider range is requested even while the
   * quote is still fresh — so "All" returns full history, not a cached window.
   * NULL on legacy rows (treated as the historical "6mo" default).
   */
  deepestRange: text("deepest_range"),
});

// Daily NAV (+ fund AUM) history (written by the live-market refresh).
//
// RETENTION INVARIANT: this table is append-or-update only and is NEVER pruned
// by age. Writes upsert on the (ticker, date) primary key — a re-fetch of the
// same day corrects that row in place; it does not delete or replace history.
// Refresh jobs fetch a window and upsert it; older rows outside the window stay.
// Never delete-then-replace and never add a time-based retention sweep here, or
// historical series are lost. (Backups have their own file retention; that is
// unrelated to row retention.)
export const navHistory = sqliteTable(
  "nav_history",
  {
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    nav: real("nav").notNull(),
    /**
     * Fund total net assets (AUM) on this date. Nullable: only fund sources
     * (Thai SEC) report it; index/stock/FX rows leave it NULL. Pre-existing
     * cached rows stay NULL until their next refresh re-fetches the series.
     */
    netAsset: real("net_asset"),
  },
  (table) => [
    primaryKey({ columns: [table.ticker, table.date] }),
    index("idx_nav_history_date").on(table.date),
    // Powers the screener's per-class latest-AUM lookup: find the most recent
    // date carrying a net_asset for each ticker. Partial (net_asset IS NOT NULL)
    // so it spans only the ~3k AUM-bearing fund rows, not every index/FX row, and
    // lets a correlated `ORDER BY date DESC LIMIT 1` resolve via index instead of
    // scanning ~3M rows (queries/funds.ts attachQuotesAndAum).
    index("idx_nav_history_aum")
      .on(table.ticker, table.date)
      .where(sql`${table.netAsset} IS NOT NULL`),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// SEC raw landing (ELT) — verbatim SEC Open API payloads, the EXTRACT/LOAD half
// of the crawl. The catalog refresh lands raw rows here first; a separate,
// API-free transform (lib/jobs/transform-fund-catalog.ts) derives the normalized
// fund_catalog / fund_share_classes / fund_fees columns from them. Re-deriving a
// field — a new classification rule, a recovered taxonomy — is then a seconds-long
// transform re-run over local rows, not an ~80-min re-crawl, and fields we don't
// map yet survive verbatim instead of being discarded at fetch time.
//
// One table for every endpoint: the (endpoint, proj_id, row_key) key plus a
// verbatim JSON `payload` means adding a new SEC endpoint (any of the ~20 the
// API exposes) is a new `endpoint` value + a transform step, never a schema
// change. `row_key` discriminates rows within one (endpoint, proj_id): the share
// class for profiles, the fee identity for fees, "" for proj-level singletons.
// Regenerable — rebuilt by the next crawl — so it lives in market.db, unbacked.
// ───────────────────────────────────────────────────────────────────────────
export const secRaw = sqliteTable(
  "sec_raw",
  {
    // SEC endpoint path tail, e.g. "general-info/profiles" | "factsheet/fees" |
    // "daily-info/aum". Stable string keys live in lib/db/queries/sec-raw.ts.
    endpoint: text("endpoint").notNull(),
    // SEC proj_id the payload belongs to (the universal fund key).
    projId: text("proj_id").notNull(),
    // Discriminator within (endpoint, proj_id): share class for profiles, the
    // `${class}|${feeTypeRaw}|${start}` identity for fees, "" for a per-fund
    // singleton (e.g. the AUM snapshot). Keeps multi-row endpoints addressable.
    rowKey: text("row_key").notNull(),
    // Verbatim SEC item, JSON-stringified. Nothing is dropped at land time, so a
    // later transform can read fields the current mappers ignore.
    payload: text("payload").notNull(),
    fetchedAt: text("fetched_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    primaryKey({ columns: [table.endpoint, table.projId, table.rowKey] }),
    // The transform reads a whole endpoint at once (WHERE endpoint = ?).
    index("idx_sec_raw_endpoint").on(table.endpoint),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// Fund catalog — the universe of Thai-registered funds and their fees, refreshed
// daily from the SEC Open API. Powers the fee-aware fund finder ("Select"): given
// a target exposure, name the lowest-fee fund that delivers it. Distinct from
// `holdings` (what the user owns) and `fund_quotes` (live NAV cache).
//
// DERIVED, not authoritative: every column here is computed by the transform
// from `sec_raw`. To change how a field is derived, fix the transform and re-run
// it — do not hand-edit catalog rows (the next transform overwrites them).
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
    // Derived risk-spectrum-first (the SEC factsheet risk code), falling back to
    // `policyDescTh` + the money-market name match — see deriveAssetClass in
    // lib/market/fund-classify.ts.
    assetClass: text("asset_class"),
    // The SEC factsheet risk-spectrum code, verbatim (e.g. "RS1"…"RS8", "RS81",
    // "RS8+"). The 1–8 ladder it sits on is the source axis `assetClass` is
    // derived from (RS1/2→cash … RS8→alt), kept here for the fund-detail UI and
    // so the raw signal isn't lost after classification. NULL = not published.
    riskSpectrum: text("risk_spectrum"),
    // Short Thai asset-type label from the SEC (ตราสารหนี้ / ตราสารทุน / ผสม /
    // ทรัพย์สินทางเลือก) — the source for `assetClass` inference.
    policyDescTh: text("policy_desc_th"),
    // Management style, per the SEC v2 profiles spec: 'AM' active | 'AN' feeder
    // of an active master | 'PM' passive/index-tracking | 'PN' feeder of a
    // passive master | 'SM' index-tracking with occasional alpha (enhanced
    // index) | 'BH' buy-and-hold (fixed term) | 'IM'/'IN' inverse |
    // 'LM'/'LN' leveraged | 'OT' other | NULL not published.
    // PM/PN are the index-fund markers — core to the index-investor filter
    // (see isIndexStyle / indexTypeFromManagementStyle in fund-classify.ts).
    managementStyle: text("management_style"),
    // Tax-advantaged wrapper, if any: 'SSF' | 'ThaiESG' | NULL. Primary driver
    // for Thai retail investors.
    taxIncentiveType: text("tax_incentive_type"),
    // Share-class character: 'accumulating' | 'dividend' | NULL — matters for tax.
    distributionPolicy: text("distribution_policy"),
    // Geographic mandate from the SEC `invest_country_flag`:
    // 'foreign' | 'mixed' | 'domestic' | NULL.
    investRegion: text("invest_region"),
    // ── Derived facets (see lib/market/fund-facets.ts) — claimed only when the
    // signal is unambiguous; NULL = unknown/diversified, never a guess. Updated
    // by the transform after benchmarks are derived. ──
    // Geographic focus, finer than investRegion: 'thailand' | 'us' | 'japan' |
    // 'europe' | 'china' | 'india' | 'vietnam' | 'korea' | 'singapore' |
    // 'asia' | 'asean' | 'emerging' | 'global' | NULL.
    regionFocus: text("region_focus"),
    // Provenance of regionFocus: 'aimc' | 'benchmark' | 'invest-flag' | 'name' | NULL.
    regionFocusSource: text("region_focus_source"),
    // Sector/theme focus: 'technology' | 'healthcare' | 'energy' | 'financials'
    // | 'consumer' | 'gold' | 'commodities' | 'property' | NULL (diversified).
    sectorFocus: text("sector_focus"),
    // Normalized benchmark index family ("SET50", "S&P 500", "MSCI ACWI"…) —
    // only ever claimed from a declared benchmark, never inferred from a name.
    indexFamily: text("index_family"),
    // Official AIMC peer-group code ("USEQ", "EQLC", "CPM"…), verbatim from the
    // legacy v1 FundFactsheet API (optional SEC_V1_API_KEY subscription).
    // NULL = unclassified by AIMC or the v1 key isn't configured.
    aimcCategory: text("aimc_category"),
    // Feeder funds (the main vehicle for Thai access to global indices).
    isFeederFund: integer("is_feeder_fund", { mode: "boolean" }).notNull().default(false),
    feederMasterFund: text("feeder_master_fund"),
    // Country where the master fund is REGISTERED (its domicile — Luxembourg /
    // Ireland UCITS etc., Thai country name verbatim). NOT an investment-region
    // signal: a Luxembourg-domiciled master can invest anywhere.
    feederFundCountry: text("feeder_fund_country"),
    // Full investment-policy text (investment_policy_desc, HTML stripped) —
    // far richer than the short `policy_desc` label; feeds search, the
    // region/sector gazetteer, and Advisor context. ~70% coverage.
    investmentPolicyDesc: text("investment_policy_desc"),
    // Normalized FX-hedging policy from `exchange_rate_protection_policy`:
    // 'full' | 'discretionary' | 'partial' | 'none' | 'per-class' | NULL (not
    // stated — typically domestic funds). Hedged vs unhedged is a different
    // product — feeds like-for-like comparison and a screener facet.
    fxHedgingPolicy: text("fx_hedging_policy"),
    // Fixed-term funds mature and stop accepting subscriptions; excluded from
    // ongoing-investment recommendations.
    isFixedTerm: integer("is_fixed_term", { mode: "boolean" }).notNull().default(false),
    // Maturity duration for fixed-term funds, verbatim SEC components (a "6-month
    // term fund" lands as 0y/6m/0d). All NULL for open-ended funds.
    termYears: integer("term_years"),
    termMonths: integer("term_months"),
    termDays: integer("term_days"),
    initDate: text("init_date"), // fund inception (ISO date)
    regisDate: text("regis_date"), // SEC registration date (ISO; distinct from inception)
    cancelDate: text("cancel_date"), // cancellation date for dead funds (ISO)
    isinCode: text("isin_code"), // ~30% coverage; for external cross-reference
    // Latest total net asset value (THB) + the NAV date it was read on. Small
    // funds (low AUM) have poor liquidity; used to down-rank dormant funds.
    aum: real("aum"),
    aumDate: text("aum_date"),
    // Raw SEC `fund_status`: 'Registered' | 'IPO' | 'Liquidated' | 'Expired' |
    // 'Canceled'. `status` below is derived from this.
    secStatus: text("sec_status"),
    // Raw SEC `proj_retail_type`: 'R' = available to retail; anything else (e.g.
    // 'X') = not for retail — accredited / institutional-only private funds
    // (infrastructure, private credit) whose retail-availability isn't in the
    // class detail. A fund-level retail gate for the screener. NULL until
    // (re)crawled — treated as retail (don't hide) so it's a safe no-op pre-crawl.
    projRetailType: text("proj_retail_type"),
    // Derived from `secStatus`: 'active' (Registered/IPO) = currently offered;
    // 'inactive' = liquidated/expired/canceled (kept for history). Drives the
    // fund finder's active-only default.
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    // DERIVED CACHE (NOT authoritative — fund_fees holds the full history and is
    // the source of truth). Current total-expense ratio %, maintained by
    // upsertFundFees on every fee write so findFunds can sort/annotate by TER
    // without re-deriving from the ~790k-row fee history. Recomputed wholesale,
    // never hand-edited; null when the fund has no published total_expense fee.
    currentTer: real("current_ter"),
  },
  (table) => [
    index("idx_fund_catalog_asset_class").on(table.assetClass),
    index("idx_fund_catalog_status").on(table.status),
    index("idx_fund_catalog_mgmt_style").on(table.managementStyle),
    index("idx_fund_catalog_region_focus").on(table.regionFocus),
    index("idx_fund_catalog_sector_focus").on(table.sectorFocus),
    index("idx_fund_catalog_tax").on(table.taxIncentiveType),
    // Name columns the fund-finder search LIKE-matches on. A leading-wildcard
    // LIKE ('%term%') can't use a btree index, but anchored/prefix matches and
    // ordering on these columns do — and the schema should carry them anyway.
    index("idx_fund_catalog_abbr_name").on(table.abbrName),
    index("idx_fund_catalog_english_name").on(table.englishName),
    index("idx_fund_catalog_thai_name").on(table.thaiName),
  ],
);

// Share classes — the *priceable units* of a fund. The SEC general-info/profiles
// endpoint returns one row per class; the catalog (one row per `proj_id`) carries
// fund-level metadata, while facts that differ between classes (distribution
// policy, tax wrapper, investor type, ISIN, fees) live here. Populated from the
// same enumeration that builds the catalog — no extra SEC calls.
//
// `ticker` is the human-facing, holdable identifier and the `${source}:${ticker}`
// NAV cache-key tail: the share-class code for multi-class funds ("MDIVA-A"), or
// the parent abbr for single-class funds whose SEC class is "main" ("1DIV").
// `className` is the raw SEC `fund_class_name` ("main" is NOT unique across funds,
// so the PK is composite); `ticker` is globally unique (UNIQUE index) and is what
// holdings / search / the NAV chart key on.
export const fundShareClasses = sqliteTable(
  "fund_share_classes",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    // Raw SEC fund_class_name ("main" for single-class funds, "MDIVA-A" etc).
    className: text("class_name").notNull(),
    // Priceable ticker = holdings.ticker = NAV cache-key tail. Derived: abbr when
    // className is "main", else className.
    ticker: text("ticker").notNull(),
    // Raw Thai class detail, e.g. "ชนิดสะสมมูลค่า สำหรับผู้ลงทุนทั่วไป".
    classDetailTh: text("class_detail_th"),
    // Parsed from classDetailTh: 'accumulating' | 'dividend' | NULL.
    distributionPolicy: text("distribution_policy"),
    // Parsed audience: 'retail' | 'restricted' | 'institutional' | 'insurance' |
    // NULL. The screener hides institutional + insurance (uninvestable directly),
    // keeps retail/null, and down-ranks 'restricted' (provident/private/
    // special-group classes — investable in principle but not sold to the public).
    investorType: text("investor_type"),
    // Per-class tax wrapper: 'SSF' | 'RMF' | 'ThaiESG' | NULL.
    taxIncentiveType: text("tax_incentive_type"),
    // Per-class ISIN — a global, rename-proof security identifier (~10% coverage in
    // the live feed). The most stable per-class anchor we actually have (#235); the
    // SEC `unique_id` field is an AMC/company code, NOT a security id, so it can't
    // anchor a class.
    isinCode: text("isin_code"),
    // Per-class current total expense ratio %, derived from fund_fees
    // (projId, className, 'total_expense', active period). NULL when unpublished.
    currentTer: real("current_ter"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.className] }),
    uniqueIndex("idx_fund_share_classes_ticker").on(table.ticker),
    index("idx_fund_share_classes_proj").on(table.projId),
    index("idx_fund_share_classes_tax").on(table.taxIncentiveType),
    index("idx_fund_share_classes_investor").on(table.investorType),
    index("idx_fund_share_classes_isin").on(table.isinCode),
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

// Fund benchmarks — the declared benchmark index per fund from the factsheet
// (/v2/fund/factsheet/benchmarks, latest=true). One row per (projId, groupSeq):
// a fund can declare a BLENDED benchmark as several weighted rows. The
// benchmark string names the index, geography, and hedging variant — the
// authoritative classification signal for region/index-family facets.
export const fundBenchmarks = sqliteTable(
  "fund_benchmarks",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    groupSeq: integer("group_seq").notNull(),
    // Verbatim benchmark text, factsheet §8.1 (Thai/EN mixed).
    benchmark: text("benchmark").notNull(),
    benchmarkRemark: text("benchmark_remark"),
    // Start/end date of the factsheet period (end IS NULL = currently active).
    startDate: text("start_date"),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.groupSeq] }),
    index("idx_fund_benchmarks_proj").on(table.projId),
  ],
);

// Fund statistics — quantitative risk/return stats per fund class from the
// factsheet (/v2/fund/factsheet/statistics, latest=true). One row per
// (projId, fundClassName). Figures arrive as strings and are parsed at
// transform time; the verbatim payload stays in sec_raw. fx_hedging_ratio and
// tracking_error feed like-for-like comparison (hedged vs unhedged classes,
// index-replication quality).
export const fundStatistics = sqliteTable(
  "fund_statistics",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    portfolioTurnoverRatio: real("portfolio_turnover_ratio"),
    maximumDrawdown: real("maximum_drawdown"),
    sharpeRatio: real("sharpe_ratio"),
    beta: real("beta"),
    alpha: real("alpha"),
    fxHedgingRatio: real("fx_hedging_ratio"),
    trackingError: real("tracking_error"),
    // Kept as text: the SEC serves mixed shapes here (a percent for bond funds,
    // a date-like string in some payloads) — parse at read once shapes settle.
    yieldToMaturity: text("yield_to_maturity"),
    // Thai duration descriptions ("1 เดือน 13 วัน"), not parseable numbers.
    recoveringPeriod: text("recovering_period"),
    portfolioDurationPeriod: text("portfolio_duration_period"),
    // Start/end date of the factsheet period (end IS NULL = currently active).
    startDate: text("start_date"),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.fundClassName] }),
    index("idx_fund_statistics_proj").on(table.projId),
  ],
);

// Fund specifications — special-characteristic codes per fund class from
// /v2/fund/general-info/specifications (SorNor 87/2558 Appendix 2): ETF,
// cross-investing (CIV), FIF, etc. One row per (projId, fundClassName, specCode)
// — a class can carry several codes.
export const fundSpecifications = sqliteTable(
  "fund_specifications",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    specCode: text("spec_code").notNull(),
    specDesc: text("spec_desc"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.fundClassName, table.specCode] }),
    index("idx_fund_specifications_proj").on(table.projId),
  ],
);

// Factsheet URLs — the SEC-hosted PDF + the AMC's own factsheet page per fund
// class, from /v2/fund/factsheet/urls. Latest row per (projId, fundClassName).
export const fundFactsheetUrls = sqliteTable(
  "fund_factsheet_urls",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    amcUrlFactsheet: text("amc_url_factsheet"),
    pdfFactsheet: text("pdf_factsheet"),
    asOfDate: text("as_of_date"),
    prospectusType: text("prospectus_type"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.fundClassName] }),
    index("idx_fund_factsheet_urls_proj").on(table.projId),
  ],
);

// Subscription/redemption minimums — the latest factsheet minimums per fund
// class from /v2/fund/factsheet/subscription-redemption-minimums. Amounts are
// parsed from the SEC's strings; the `*Unit` columns keep the SEC's unit label
// (บาท = baht vs หน่วย = units) since redemption minimums can be in either.
export const fundSubscriptionMinimums = sqliteTable(
  "fund_subscription_minimums",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    minimumSubIpo: real("minimum_sub_ipo"),
    minimumSubIpoCur: text("minimum_sub_ipo_cur"),
    minimumSub: real("minimum_sub"),
    minimumSubCur: text("minimum_sub_cur"),
    minimumSubUnit: text("minimum_sub_unit"),
    minimumRedempt: real("minimum_redempt"),
    minimumRedemptCur: text("minimum_redempt_cur"),
    minimumRedemptUnit: text("minimum_redempt_unit"),
    lowbalVal: real("lowbal_val"),
    lowbalValCur: text("lowbal_val_cur"),
    lowbalUnit: text("lowbal_unit"),
    // Start/end date of the factsheet period (end IS NULL = currently active).
    startDate: text("start_date"),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.fundClassName] }),
    index("idx_fund_subscription_minimums_proj").on(table.projId),
  ],
);

// Formal dividend-policy code per fund class from
// /v2/fund/factsheet/dividend-policy — authoritative vs the Thai-text parsing
// of fund_class_detail that derives `distribution_policy` today. Kept verbatim.
export const fundDividendPolicy = sqliteTable(
  "fund_dividend_policy",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    fundClassName: text("fund_class_name").notNull(),
    dividendPolicy: text("dividend_policy"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    prospectusType: text("prospectus_type"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.fundClassName] }),
    index("idx_fund_dividend_policy_proj").on(table.projId),
  ],
);

// Dividend payment history per fund class from /v2/fund/daily-info/dividend-history
// — append-only time series (book-close date, payment date, THB per unit).
// Backs trailing-yield computation and verifies a dividend class actually pays.
export const fundDividendHistory = sqliteTable(
  "fund_dividend_history",
  {
    projId: text("proj_id")
      .notNull()
      .references(() => fundCatalog.projId, { onDelete: "cascade" }),
    classAbbrName: text("class_abbr_name").notNull(),
    bookCloseDate: text("book_close_date").notNull(),
    dividendDate: text("dividend_date"),
    dividendValue: real("dividend_value"),
    lastUpdDate: text("last_upd_date"),
  },
  (table) => [
    primaryKey({ columns: [table.projId, table.classAbbrName, table.bookCloseDate] }),
    index("idx_fund_dividend_history_proj").on(table.projId),
  ],
);

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
    // natural composite key — (proj_id, period, assetliab_id) collides. Idempotency
    // across crawls comes from upsertFundPortfolio's period guard: a period already
    // present is skipped, so re-crawls don't duplicate. Periods are normalized to a
    // clean "YYYYMM" string first — the feed sends a number, which previously
    // defeated the guard and 6×-duplicated the table (see normalizePeriod).
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
