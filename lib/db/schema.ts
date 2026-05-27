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

// Investment buckets — a "bucket" is a portfolio slice (Core, SSF, experiment, etc.).
export const buckets = sqliteTable("buckets", {
  id: text("id").primaryKey(),
  // Owner. NULL pre-backfill / single-owner mode → visible to everyone.
  userId: text("user_id").references(() => user.id),
  name: text("name").notNull(),
  typeLabel: text("type_label"),
  icon: text("icon"),
  color: text("color"),
  brokerage: text("brokerage").notNull(),
  notes: text("notes"),
  goalText: text("goal_text"),
  targetModelId: text("target_model_id"),
  targetAllocation: text("target_allocation", { mode: "json" }).$type<{
    equity: number;
    bond: number;
    alternative: number;
    cash: number;
  }>(),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// Fund positions inside a bucket.
export const holdings = sqliteTable(
  "holdings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bucketId: text("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    thaiName: text("thai_name"),
    englishName: text("english_name").notNull(),
    category: text("category"),
    assetClass: text("asset_class"),
    region: text("region"),
    units: real("units").notNull(),
    avgCost: real("avg_cost"),
    ter: real("ter"),
    color: text("color"),
    /** Brokerage / import provenance — free-text, displayed in UI. */
    source: text("source"),
    /**
     * Data-routing key. Tells the market registry which provider to call when
     * fetching NAV / price (see lib/market/sources.ts). One of:
     *   - "yahoo"             — stocks, ETFs, indices, FX via Yahoo
     *   - "thai_mutual_fund"  — Thai mutual fund NAVs via the SEC Open API
     */
    quoteSource: text("quote_source").notNull().default("yahoo"),
    acquiredOn: text("acquired_on"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_holdings_bucket").on(table.bucketId)],
);

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
  (table) => [index("idx_fund_portfolio_proj").on(table.projId)],
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

// Investment plan — one row per user. `id` autoincrements; a UNIQUE index on
// `user_id` enforces a single plan per owner. SQLite treats multiple NULLs as
// distinct in a UNIQUE index, which is fine: single-owner mode has exactly one
// NULL-owned row.
export const plans = sqliteTable(
  "plans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Owner. NULL pre-backfill / single-owner mode.
    userId: text("user_id").references(() => user.id),
    markdown: text("markdown").notNull(),
    selectedModelId: text("selected_model_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_plans_user").on(table.userId)],
);

// Journal entries — notes, decisions, questions, reading.
export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Owner. NULL pre-backfill / single-owner mode → visible to everyone.
    userId: text("user_id").references(() => user.id),
    kind: text("kind").notNull(),
    title: text("title"),
    body: text("body"),
    url: text("url"),
    source: text("source"),
    tags: text("tags", { mode: "json" }).$type<string[]>(),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("idx_journal_kind").on(table.kind),
    index("idx_journal_created").on(table.createdAt),
  ],
);

// Model portfolios — built-ins shipped with the app + user customizations.
export type ModelMixSlice = { label: string; pct: number; ticker?: string; color: string };

export const modelPortfolios = sqliteTable("model_portfolios", {
  id: text("id").primaryKey(),
  // Owner. NULL = built-in / single-owner → visible to everyone.
  userId: text("user_id").references(() => user.id),
  name: text("name").notNull(),
  tagline: text("tagline"),
  blurb: text("blurb"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  allocation: text("allocation", { mode: "json" }).$type<ModelMixSlice[]>().notNull(),
  expectedReturn: real("expected_return"),
  expectedVolatility: real("expected_volatility"),
  ter: real("ter"),
  horizon: text("horizon"),
  risk: text("risk"),
  pros: text("pros", { mode: "json" }).$type<string[]>(),
  cons: text("cons", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").notNull(),
});

// Chat threads — one per conversation.
export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  // Owner. NULL pre-backfill / single-owner mode → visible to everyone.
  userId: text("user_id").references(() => user.id),
  title: text("title"),
  // Lifecycle state machine: 'active' on creation; the idle-archive
  // job promotes 'active' → 'idle' → 'archived' based on `updatedAt` age.
  // Deletion is orthogonal — it stays on `deletedAt` (30-day trash), so there
  // is deliberately no 'deleted' status here.
  status: text("status", { enum: ["active", "idle", "archived"] })
    .notNull()
    .default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  // Set when the archive job moves a thread to 'archived'; ISO-8601 UTC.
  archivedAt: text("archived_at"),
  // Watermark for incremental backstop extraction: the highest
  // chat_messages.id already folded into a `source='extracted'` pass. On
  // session close we extract only turns newer than this (plus the running
  // summary as context), then advance it — so re-extracting a resumed chat
  // never re-processes old turns. NULL = nothing extracted yet.
  extractedThroughId: integer("extracted_through_id"),
  // Soft-delete: NULL = active, ISO-8601 UTC = trashed at that moment.
  // 30-day grace period for restore; UI hides past that. Hard purge is manual.
  deletedAt: text("deleted_at"),
});

// Chat messages — user/assistant/tool turns within a thread.
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    threadId: text("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolCallId: text("tool_call_id"),
    feedback: text("feedback"),
    // The OpenRouter / provider model id that served this response.
    // NULL for user/tool/summary rows and for messages predating this column.
    model: text("model"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_chat_messages_thread").on(table.threadId, table.createdAt)],
);

// Per-user Markets-screen indicator list — which indicators a user shows and in
// what order. No rows for a user → the app falls back to the curated default
// set (DEFAULT_INDICATOR_SYMBOLS in lib/market/indicators.ts). Writes replace a
// user's whole list, so order is authoritative.
export const userMarketIndicators = sqliteTable(
  "user_market_indicators",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Owner. NULL in single-owner / AUTH_DISABLED mode (matches other tables).
    userId: text("user_id").references(() => user.id),
    // Canonical ticker from the indicator catalog (lib/market/indicators.ts).
    symbol: text("symbol").notNull(),
    // Display order, ascending.
    position: integer("position").notNull(),
  },
  (table) => [
    uniqueIndex("idx_user_market_indicator").on(table.userId, table.symbol),
    index("idx_user_market_indicator_order").on(table.userId, table.position),
  ],
);

// Generic key-value settings.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

// Long-term memory. Bitemporal: updates add a new row + supersede; rows are
// never mutated in place. `valid_until IS NULL` is the active set.
// `source = 'extracted'` is reserved for session-close auto-extraction; the
// memory tools write only `'user_tool'` / `'advisor_tool'`. See
// docs/explanation/memory.md.
export const userPreferences = sqliteTable(
  "user_preferences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id"), // NULL in single-owner mode; FK after
    category: text("category", {
      enum: ["profile", "finance_context", "response_style", "fact"],
    }).notNull(),
    content: text("content").notNull(),
    source: text("source", { enum: ["user_tool", "advisor_tool", "extracted"] }).notNull(),
    sourceSessionId: text("source_session_id").references(() => chatThreads.id, {
      onDelete: "set null",
    }),
    sourceTurnIds: text("source_turn_ids", { mode: "json" }).$type<number[]>(),
    confidence: real("confidence"), // NULL for explicit; 0..1 for extracted
    validFrom: text("valid_from").notNull(),
    validUntil: text("valid_until"), // NULL = active
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_user_pref_active").on(table.userId, table.validUntil),
    index("idx_user_pref_category").on(table.userId, table.category, table.validUntil),
  ],
);

// ───────────────────────────────────────────────────────────────────────────
// better-auth tables. Names match better-auth's defaults so the drizzle
// adapter resolves them without a `schema` mapping. All timestamps are stored
// as integer epoch-ms — better-auth's drizzle adapter handles the conversion.
// ───────────────────────────────────────────────────────────────────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

// Passkey plugin table.
export const passkey = sqliteTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_i_d").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
  transports: text("transports"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }),
  aaguid: text("aaguid"),
});

// ───────────────────────────────────────────────────────────────────────────
// Multi-user: per-user token accounting + tier gating.
// ───────────────────────────────────────────────────────────────────────────

// Per-user daily token usage. One row per (user, UTC date).
export const usage = sqliteTable(
  "usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    date: text("date").notNull(), // 'YYYY-MM-DD' UTC
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })],
);

// Tier gating: which OpenRouter model chain a user can hit.
//   'free'    = openrouter free router only (zero cost to owner)
//   'trusted' = full owner model chain (AI_MODELS env)
// Owner promotes via SQL: UPDATE account_tier SET tier='trusted' WHERE user_id=?
export const accountTier = sqliteTable("account_tier", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id),
  tier: text("tier", { enum: ["free", "trusted"] })
    .notNull()
    .default("free"),
  grantedAt: text("granted_at").notNull(), // ISO-8601 UTC
});
