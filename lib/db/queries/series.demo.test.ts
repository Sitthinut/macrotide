// Demo-mode read path: the Portfolio chart and benchmark overlay must source
// ~5 years of DENSE (daily-recent / weekly-far-back) history from the committed
// fixture (lib/mock/demo-history), NOT from market.db — and owner mode must
// still read market.db.

import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBenchmarkSeries } from "@/lib/market/benchmarks";
import { DEMO_HOLDING_HISTORY } from "@/lib/mock/demo-history";
import { demoIndexSeries } from "@/lib/mock/demo-history-read";
import { seedDemoData } from "@/lib/mock/demo-seed";
import { freshAppDb, freshMarketDb } from "@/tests/db-helpers";
import { runWithDbContext } from "../context";
import { getPortfolioSeries } from "./series";

// FX layer would hit the network for any key; in demo mode the book is THB-only
// so no rate is needed, but mock it to be safe + offline.
vi.mock("@/lib/market/cache", () => ({
  getCachedSeries: async (_source: string, ticker: string) => ({
    ticker,
    series: [],
    quote: null,
  }),
}));

type AppDb = ReturnType<typeof freshAppDb>["db"];
type MarketDb = ReturnType<typeof freshMarketDb>["db"];

let appSqlite: Database.Database;
let appDb: AppDb;
let marketSqlite: Database.Database;
let marketDb: MarketDb;

function runDemo<T>(fn: () => T | Promise<T>): Promise<T> {
  return runWithDbContext(
    { appDb, appSqlite, marketDb, marketSqlite, isDemo: true, sessionId: "demo-test" },
    fn,
  ) as Promise<T>;
}

function runOwner<T>(fn: () => T | Promise<T>): Promise<T> {
  return runWithDbContext(
    { appDb, appSqlite, marketDb, marketSqlite, isDemo: false, sessionId: "owner" },
    fn,
  ) as Promise<T>;
}

beforeEach(() => {
  const app = freshAppDb();
  const market = freshMarketDb();
  appSqlite = app.sqlite;
  appDb = app.db;
  marketSqlite = market.sqlite;
  marketDb = market.db;
  seedDemoData(appDb); // real demo holdings (THB Thai funds)
});

afterEach(() => {
  appSqlite.close();
  marketSqlite.close();
});

describe("getPortfolioSeries — demo mode (fixture-backed)", () => {
  it("returns dense multi-year history from the fixture, not market.db", async () => {
    // market.db is intentionally EMPTY — if the demo branch read it, we'd get [].
    const { aggregate, asOf } = await runDemo(() => getPortfolioSeries("max"));
    // Daily-recent + weekly-far-back over ~5y → hundreds of points, not ~60.
    expect(aggregate.length).toBeGreaterThanOrEqual(300);
    expect(asOf).not.toBeNull();
    // Spans multiple years.
    const firstYear = Number(aggregate[0].date.slice(0, 4));
    const lastYear = Number((asOf as string).slice(0, 4));
    expect(lastYear - firstYear).toBeGreaterThanOrEqual(3);
  });

  it("the recent window is daily (a 1-month range yields ~20+ trading days)", async () => {
    const { aggregate } = await runDemo(() => getPortfolioSeries("1mo"));
    expect(aggregate.length).toBeGreaterThanOrEqual(18);
  });

  it("the window's FIRST date is full, not partial (carry-in seeds the left edge)", async () => {
    // Total seeded book value (all holdings' last fixture point).
    const fullBook = Object.values(DEMO_HOLDING_HISTORY).reduce(
      (s, series) => s + (series.at(-1)?.[1] ?? 0),
      0,
    );
    // The first 1M point must already include every holding — close to the full
    // book (a month's drift, never a fraction like 3/12 ≈ 20%). Regression guard
    // for the left-edge jump: pre-fix this was ~250k (3 of 12 funds present).
    const { aggregate } = await runDemo(() => getPortfolioSeries("1mo"));
    const first = aggregate[0].value;
    expect(first).toBeGreaterThan(fullBook * 0.85);
    expect(first).toBeLessThan(fullBook * 1.15);
  });

  it("the demo aggregate equals the sum of every seeded holding's current value", async () => {
    const { aggregate } = await runDemo(() => getPortfolioSeries("max"));
    const lastTotal = aggregate.at(-1)?.value as number;
    // The fixture scales each holding's last point to its seeded current value,
    // so the final aggregate ≈ sum of all holdings' last (encoded) points.
    const expected = Object.values(DEMO_HOLDING_HISTORY).reduce(
      (s, series) => s + (series.at(-1)?.[1] ?? 0),
      0,
    );
    expect(lastTotal).toBeCloseTo(expected, 0);
  });

  it("a shorter range returns fewer points (range filter applies)", async () => {
    const all = await runDemo(() => getPortfolioSeries("max"));
    const oneYear = await runDemo(() => getPortfolioSeries("1y"));
    expect(oneYear.aggregate.length).toBeLessThan(all.aggregate.length);
    expect(oneYear.aggregate.length).toBeGreaterThan(0);
  });

  it("owner mode does NOT read the fixture (empty market.db → empty series)", async () => {
    const { aggregate, asOf } = await runOwner(() => getPortfolioSeries("max"));
    expect(aggregate).toEqual([]);
    expect(asOf).toBeNull();
  });
});

describe("getBenchmarkSeries — demo mode (fixture-backed)", () => {
  it("serves a dense multi-year index series for a known benchmark", async () => {
    const series = await runDemo(() => getBenchmarkSeries("sp500", "max"));
    expect(series.length).toBeGreaterThanOrEqual(300);
    // Matches the decoded fixture series exactly.
    expect(series).toEqual(demoIndexSeries("sp500"));
  });

  it("the benchmark recent window is daily (1-month ≈ 20+ points)", async () => {
    const series = await runDemo(() => getBenchmarkSeries("sp500", "1mo"));
    expect(series.length).toBeGreaterThanOrEqual(18);
  });

  it("the benchmark window's first point is on/before the range start (carry-in)", async () => {
    const since = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 31); // matches the "1mo" window
      return d.toISOString().slice(0, 10);
    })();
    const series = await runDemo(() => getBenchmarkSeries("sp500", "1mo"));
    // First point seeds the left edge: dated at/before `since`, so the overlay
    // spans the full window (the client rebases from the same start).
    expect(series[0].date <= since).toBe(true);
  });

  it("respects the range window", async () => {
    const all = await runDemo(() => getBenchmarkSeries("set", "max"));
    const oneYear = await runDemo(() => getBenchmarkSeries("set", "1y"));
    expect(oneYear.length).toBeLessThan(all.length);
    expect(oneYear.length).toBeGreaterThan(0);
  });

  it("returns [] for an unknown benchmark key", async () => {
    const series = await runDemo(() => getBenchmarkSeries("does-not-exist", "max"));
    expect(series).toEqual([]);
  });
});
