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
// app.db — the system of record (env DB_PATH, default data/app.db). Holds every
// precious, user-authored record: accounts/sessions, buckets, holdings, plans,
// journal, models, chat, preferences, settings. Backed up nightly (see
// lib/db/backup.ts). Market data lives in a separate, regenerable market.db
// (lib/db/schema/market.ts); no FK crosses the boundary.
// ───────────────────────────────────────────────────────────────────────────

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
  // Manual sort order (ascending). Nullable: existing rows stay NULL and sort
  // last, falling back to createdAt, until the user drag-reorders them.
  position: integer("position"),
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
     *
     * This + `ticker` is the soft routing key into market.db's nav_history /
     * fund_quotes cache (see lib/market/cache.ts). It is NOT a SQL foreign key —
     * `holdings` denormalizes its display fields and never joins fund_catalog.
     */
    quoteSource: text("quote_source").notNull().default("yahoo"),
    acquiredOn: text("acquired_on"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_holdings_bucket").on(table.bucketId)],
);

// Transaction ledger — the buy/sell/dividend event log behind realized gains,
// money-weighted return (XIRR), and the contribution timeline. Deliberately
// SEPARATE from `holdings`: holdings is the snapshot of what you hold now;
// `transactions` is how you got there. See
// docs/explanation/decisions/0003-transaction-ledger-data-model.md.
//
// Scoping: like `holdings`, this table has NO `user_id` — it is scoped through
// its parent bucket. The scoping invariant lives in the CALLER (resolve the
// owner's bucket set, then query); the query layer exposes no unscoped list.
// This intentionally overrides the general "new app tables carry user_id"
// guidance, because a transaction belongs to a bucket, not directly to a user.
export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bucketId: text("bucket_id")
      .notNull()
      .references(() => buckets.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    englishName: text("english_name"),
    /**
     * NAV/price-routing key, same semantics as holdings.quote_source — needed
     * so proceeds and the terminal portfolio value can be priced.
     *   - "yahoo"             — stocks, ETFs, indices, FX via Yahoo
     *   - "thai_mutual_fund"  — Thai mutual fund NAVs via the SEC Open API
     */
    quoteSource: text("quote_source").notNull().default("yahoo"),
    /**
     * Event type. Plain TEXT validated by Zod at the route boundary (the
     * action_item_states precedent) so a new kind needs no migration. Set:
     *   buy | sell | dividend | fee | split | reinvest
     */
    kind: text("kind").notNull(),
    /**
     * ISO-8601 ECONOMIC event date — the cash-flow date the return math orders
     * and discounts by. Distinct from `createdAt` (the UTC insert time): a
     * date-only Bangkok screenshot must land on its correct local day, never
     * drift onto the wrong UTC day.
     */
    tradeDate: text("trade_date").notNull(),
    // Nullable: a cash dividend / standalone fee has no units.
    units: real("units"),
    // Native-currency NAV/price at execution. Derivable for display; not the
    // primary money field.
    pricePerUnit: real("price_per_unit"),
    /**
     * SIGNED THB cash flow — the SOLE money-weighted-return primitive, always
     * present even when units/price are blank. Sign convention (validated at
     * the route, never silently coerced):
     *   buy / fee / reinvest-buy leg → NEGATIVE (cash out)
     *   sell / cash dividend / withdrawal → POSITIVE (cash in)
     * Already in THB. `fxToThb` is NEVER re-applied to this value — doing so
     * re-introduces the mixed-currency double-count.
     */
    amount: real("amount").notNull(),
    // Nullable; folds into basis on buys, nets from proceeds on sells.
    fee: real("fee"),
    tradeCurrency: text("trade_currency").notNull().default("THB"),
    /**
     * Trade-date FX rate captured AT IMPORT (historical FX is not reliably
     * re-fetchable later). Used only to derive native price for display and to
     * compute `amount` once at import when only a native amount was captured.
     * THB-denominated funds: tradeCurrency "THB", fxToThb 1 (a no-op).
     */
    fxToThb: real("fx_to_thb").notNull().default(1),
    note: text("note"),
    // Free-text broker / import provenance label, like holdings.source.
    source: text("source"),
    // Groups the rows of one import for provenance / undo.
    importBatchId: text("import_batch_id"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_transactions_bucket").on(table.bucketId, table.tradeDate)],
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
//
// Despite the `market_` name this is a user PREFERENCE (which symbols a user
// pins), so it lives in app.db — not the regenerable market.db.
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

// User-scoped suppression state for generated Portfolio action items (fee-creep
// flags today; headline / rebalance later). Those items are recomputed every
// render and carry no DB row of their own, so we key state by a deterministic
// item_key (see lib/portfolio/action-item-key.ts). Idempotent: one row per
// (user, item_key); re-acting upserts the same row.
//
// Two honest states (#74): 'archived' (filed) and 'not_for_me' (rejected, with
// an optional reason). Both resurface only on a MATERIAL, worse change — the
// reason selects the bar (see lib/portfolio/action-item-resurface.ts). The
// state string is validated at the Zod/route boundary; the DB column is plain
// TEXT so a future state needs no migration.
export const actionItemStates = sqliteTable(
  "action_item_states",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Owner. NULL in single-owner / AUTH_DISABLED / demo (matches other tables).
    userId: text("user_id").references(() => user.id),
    // 'headline' | 'rebalance' | 'fee_creep' — which generator produced the item.
    itemType: text("item_type").notNull(),
    // Deterministic identity string (see action-item-key.ts recipe table).
    itemKey: text("item_key").notNull(),
    // 'archived'   — acknowledged ("I've seen it, file it").
    // 'not_for_me' — rejected (optionally with a `reason`).
    // Plain TEXT, not a drizzle enum: state is validated at the route boundary,
    // and a new state must not force a migration.
    state: text("state").notNull(),
    // Optional reason on a 'not_for_me' (a REASON_CHIPS key or free text); the
    // chip selects the deterministic resurface policy. NULL = archive / no-reason
    // reject. See lib/portfolio/action-item-resurface.ts.
    reason: text("reason"),
    // Magnitude snapshot at suppression time — the finding's annual saving
    // (pp/yr). The resurface check compares the CURRENT saving against this; the
    // ratchet re-snapshots the new value on re-suppression. NULL = no snapshot
    // (e.g. headline/rebalance items with no magnitude).
    snapshotSavingsPp: real("snapshot_savings_pp"),
    // Legacy Snooze column — UNUSED in the new model (Snooze dropped, #74). Kept
    // nullable to keep the migration forward-only/non-destructive; do not write it.
    snoozeUntil: text("snooze_until"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    // One state per (user, item) — upsert target.
    uniqueIndex("idx_action_item_user_key").on(table.userId, table.itemKey),
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
    // Accumulated estimated cost in micro-dollars (millionths of a USD).
    // 1 cent = 10_000 micro-dollars. Stays 0 for free/zero-cost models (only
    // priced models in MODEL_PRICES contribute), so it's additive and never
    // regresses the token-only accounting. Enables the optional cents-based cap.
    costMicros: integer("cost_micros").notNull().default(0),
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
