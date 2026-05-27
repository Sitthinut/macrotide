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
