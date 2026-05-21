import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Investment buckets — a "bucket" is a portfolio slice (Core, SSF, experiment, etc.).
export const buckets = sqliteTable("buckets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  typeLabel: text("type_label"),
  icon: text("icon"),
  brokerage: text("brokerage").notNull(),
  goalText: text("goal_text"),
  targetAllocation: text("target_allocation", { mode: "json" }).$type<Record<string, number>>(),
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
    source: text("source"),
    acquiredOn: text("acquired_on"),
    createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("idx_holdings_bucket").on(table.bucketId)],
);

// Latest NAV + perf cache (Phase 3 writes this).
export const fundQuotes = sqliteTable("fund_quotes", {
  ticker: text("ticker").primaryKey(),
  nav: real("nav").notNull(),
  d1Pct: real("d1_pct"),
  ytdPct: real("ytd_pct"),
  y1Pct: real("y1_pct"),
  updatedAt: text("updated_at").notNull(),
});

// Daily NAV history (Phase 3 writes this).
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

// Investment plan — single-row table in v1.
export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey(),
  markdown: text("markdown").notNull(),
  selectedModelId: text("selected_model_id"),
  updatedAt: text("updated_at").notNull(),
});

// Journal entries — notes, decisions, questions, reading.
export const journalEntries = sqliteTable(
  "journal_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
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
export const modelPortfolios = sqliteTable("model_portfolios", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  allocation: text("allocation", { mode: "json" }).$type<Record<string, number>>().notNull(),
  expectedReturn: real("expected_return"),
  expectedVolatility: real("expected_volatility"),
  createdAt: text("created_at").notNull(),
});

// Chat threads — one per conversation.
export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  title: text("title"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_chat_messages_thread").on(table.threadId, table.createdAt)],
);

// Generic key-value settings.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});
