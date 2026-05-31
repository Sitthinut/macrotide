// Quotas + tier gating. Locks in the invariants the chat route
// depends on:
//   - tier defaults to 'free' when there's no account_tier row;
//   - the daily cap reads env budgets with the documented defaults;
//   - usage upserts then atomically increments today's (UTC) row;
//   - the cap check flips at the budget boundary (>=).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { runWithDbContext } from "../context";
import * as schema from "../schema";
import { accountTier, user } from "../schema";
import {
  dailyTokenBudget,
  getTier,
  getTodayUsage,
  isOverDailyCap,
  recordUsage,
  utcDate,
} from "./usage";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = resolve("lib/db/migrations/app");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sql = files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/--> statement-breakpoint/g, ";");
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema });
  const market = freshMarketDb();
  return { sqlite, db, marketDb: market.db, marketSqlite: market.sqlite };
}

function withFresh<T>(fn: () => T): T {
  const { sqlite, db, marketDb, marketSqlite } = freshDb();
  // Seed the FK target — usage + account_tier both reference user(id).
  const now = new Date();
  db.insert(user)
    .values({
      id: "u1",
      name: "U1",
      email: "u1@x.io",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return runWithDbContext(
    {
      appDb: db,
      appSqlite: sqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "test",
      userId: "u1",
    },
    fn,
  ) as T;
}

describe("dailyTokenBudget", () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it("uses documented defaults when env is unset", () => {
    process.env.DAILY_TOKEN_BUDGET_FREE = undefined;
    process.env.DAILY_TOKEN_BUDGET_TRUSTED = undefined;
    expect(dailyTokenBudget("free")).toBe(20_000);
    expect(dailyTokenBudget("trusted")).toBe(200_000);
  });

  it("honors env overrides", () => {
    process.env.DAILY_TOKEN_BUDGET_FREE = "5000";
    process.env.DAILY_TOKEN_BUDGET_TRUSTED = "999999";
    expect(dailyTokenBudget("free")).toBe(5000);
    expect(dailyTokenBudget("trusted")).toBe(999999);
  });

  it("falls back to the default on a malformed env value", () => {
    process.env.DAILY_TOKEN_BUDGET_FREE = "not-a-number";
    process.env.DAILY_TOKEN_BUDGET_TRUSTED = "-5";
    expect(dailyTokenBudget("free")).toBe(20_000);
    expect(dailyTokenBudget("trusted")).toBe(200_000);
  });
});

describe("getTier", () => {
  it("defaults to 'free' when there's no account_tier row", () => {
    withFresh(() => {
      expect(getTier("u1")).toBe("free");
    });
  });

  it("returns the stored tier when a row exists", () => {
    // Insert a 'trusted' row, then read it back inside the same context.
    const { sqlite, db, marketDb, marketSqlite } = freshDb();
    const now = new Date();
    db.insert(user)
      .values({
        id: "u1",
        name: "U1",
        email: "u1@x.io",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(accountTier)
      .values({ userId: "u1", tier: "trusted", grantedAt: now.toISOString() })
      .run();
    runWithDbContext(
      {
        appDb: db,
        appSqlite: sqlite,
        marketDb,
        marketSqlite,
        isDemo: false,
        sessionId: "test",
        userId: "u1",
      },
      () => {
        expect(getTier("u1")).toBe("trusted");
      },
    );
  });
});

describe("usage accounting", () => {
  it("getTodayUsage is zero with no row", () => {
    withFresh(() => {
      expect(getTodayUsage("u1")).toEqual({ inputTokens: 0, outputTokens: 0, total: 0 });
    });
  });

  it("recordUsage inserts then atomically increments today's row", () => {
    withFresh(() => {
      recordUsage("u1", 100, 50);
      expect(getTodayUsage("u1")).toEqual({ inputTokens: 100, outputTokens: 50, total: 150 });
      recordUsage("u1", 25, 75);
      expect(getTodayUsage("u1")).toEqual({ inputTokens: 125, outputTokens: 125, total: 250 });
    });
  });

  it("recordUsage clamps NaN / negative token counts to 0", () => {
    withFresh(() => {
      recordUsage("u1", Number.NaN, -10);
      expect(getTodayUsage("u1").total).toBe(0);
      recordUsage("u1", 10, Number.NaN);
      expect(getTodayUsage("u1")).toEqual({ inputTokens: 10, outputTokens: 0, total: 10 });
    });
  });

  it("usage is partitioned by UTC date (separate days don't bleed)", () => {
    withFresh(() => {
      const today = utcDate();
      const yesterday = utcDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      recordUsage("u1", 100, 0, yesterday);
      recordUsage("u1", 5, 0, today);
      expect(getTodayUsage("u1", today).total).toBe(5);
      expect(getTodayUsage("u1", yesterday).total).toBe(100);
    });
  });
});

describe("isOverDailyCap", () => {
  const orig = { ...process.env };
  beforeEach(() => {
    process.env.DAILY_TOKEN_BUDGET_FREE = "1000";
    process.env.DAILY_TOKEN_BUDGET_TRUSTED = "10000";
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("is false under the cap", () => {
    withFresh(() => {
      recordUsage("u1", 400, 400); // 800 < 1000
      expect(isOverDailyCap("u1", "free")).toBe(false);
    });
  });

  it("is true at the cap boundary (>=)", () => {
    withFresh(() => {
      recordUsage("u1", 500, 500); // 1000 == cap
      expect(isOverDailyCap("u1", "free")).toBe(true);
    });
  });

  it("is true over the cap", () => {
    withFresh(() => {
      recordUsage("u1", 900, 900); // 1800 > 1000
      expect(isOverDailyCap("u1", "free")).toBe(true);
    });
  });

  it("the trusted budget is higher — same usage that caps free passes trusted", () => {
    withFresh(() => {
      recordUsage("u1", 600, 600); // 1200: over free (1000), under trusted (10000)
      expect(isOverDailyCap("u1", "free")).toBe(true);
      expect(isOverDailyCap("u1", "trusted")).toBe(false);
    });
  });
});
