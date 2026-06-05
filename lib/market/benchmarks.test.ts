// Benchmark overlay carry-in: the series must span the full window from its
// first date, for both owner mode (market.db cache) and demo mode (fixture).

import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWithDbContext } from "@/lib/db/context";
import { fundQuotes, navHistory } from "@/lib/db/schema";
import { freshAppDb, freshMarketDb } from "@/tests/db-helpers";
import { getBenchmarkSeries } from "./benchmarks";

type AppDb = ReturnType<typeof freshAppDb>["db"];
type MarketDb = ReturnType<typeof freshMarketDb>["db"];

let appSqlite: Database.Database;
let appDb: AppDb;
let marketSqlite: Database.Database;
let marketDb: MarketDb;

function runOwner<T>(fn: () => T | Promise<T>): Promise<T> {
  return runWithDbContext(
    { appDb, appSqlite, marketDb, marketSqlite, isDemo: false, sessionId: "owner" },
    fn,
  ) as Promise<T>;
}

function navAtOffset(key: string, daysAgo: number, nav: number): void {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  marketDb
    .insert(navHistory)
    .values({ ticker: key, date: d.toISOString().slice(0, 10), nav })
    .run();
}

beforeEach(() => {
  const app = freshAppDb();
  const market = freshMarketDb();
  appSqlite = app.sqlite;
  appDb = app.db;
  marketSqlite = market.sqlite;
  marketDb = market.db;
});

afterEach(() => {
  appSqlite.close();
  marketSqlite.close();
});

describe("getBenchmarkSeries — owner-mode carry-in", () => {
  it("seeds the window's first date from the last pre-window close", async () => {
    // S&P 500 benchmark key → cache key "market:^GSPC".
    const key = "market:^GSPC";
    // Pre-window close (45d ago) + one in-window close (10d ago). A fresh quote
    // makes getCachedSeries serve from cache (no network).
    navAtOffset(key, 45, 4000);
    navAtOffset(key, 10, 4200);
    marketDb
      .insert(fundQuotes)
      .values({ ticker: key, nav: 4200, updatedAt: new Date().toISOString() })
      .run();

    const since = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 31); // 1mo window
      return d.toISOString().slice(0, 10);
    })();

    const series = await runOwner(() => getBenchmarkSeries("sp500", "1mo"));
    // First point seeds the left edge at `since` with the pre-window close.
    expect(series.length).toBeGreaterThanOrEqual(2);
    expect(series[0].date).toBe(since);
    expect(series[0].value).toBe(4000);
  });

  it("no carry-in when an in-window point already lands on the window start", async () => {
    const key = "market:^GSPC";
    navAtOffset(key, 31, 5000); // exactly on the 1mo window start
    navAtOffset(key, 5, 5100);
    marketDb
      .insert(fundQuotes)
      .values({ ticker: key, nav: 5100, updatedAt: new Date().toISOString() })
      .run();

    const series = await runOwner(() => getBenchmarkSeries("sp500", "1mo"));
    // The window-start row is already there; no synthetic carry-in prepended.
    expect(series[0].value).toBe(5000);
    // No duplicate first date.
    expect(series.filter((p) => p.date === series[0].date)).toHaveLength(1);
  });
});
