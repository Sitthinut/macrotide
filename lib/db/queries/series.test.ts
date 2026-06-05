import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshAppDb, freshMarketDb } from "@/tests/db-helpers";
import { getMarketDb, runWithDbContext } from "../context";
import { buckets, fundCatalog, fundQuotes, holdings, navHistory } from "../schema";
import { getPortfolioSeries } from "./series";

// The FX layer (lib/market/fx) calls getCachedSeries, which would otherwise
// hit the network for any unseeded key. Mock it to read straight from the
// seeded market.db nav_history — exactly what a warm cache returns — so the
// tests are deterministic and offline. An unseeded key returns an empty series
// (the "cold cache" case), which buildFxConverter treats as missing.
vi.mock("@/lib/market/cache", () => ({
  getCachedSeries: async (source: string, ticker: string) => {
    const { eq } = await import("drizzle-orm");
    const db = getMarketDb();
    const key = `${source}:${ticker}`;
    const rows = db
      .select()
      .from(navHistory)
      .where(eq(navHistory.ticker, key))
      .orderBy(navHistory.date)
      .all();
    return {
      ticker,
      series: rows.map((r) => ({ date: r.date, close: r.nav })),
      quote: null,
    };
  },
}));

// Synthetic data only — generic placeholder tickers, no real fund codes.
// We seed the market cache so the FX layer (getCachedSeries) serves from
// nav_history without any network call: a fresh fund_quotes row makes
// isFresh() true, and the seeded nav_history rows are the FX series.

type AppDb = ReturnType<typeof freshAppDb>["db"];
type MarketDb = ReturnType<typeof freshMarketDb>["db"];

let appSqlite: Database.Database;
let appDb: AppDb;
let marketSqlite: Database.Database;
let marketDb: MarketDb;

// Recent dates so they fall inside the range window getPortfolioSeries derives
// from "now" (the nav query filters date >= since).
function recentDates(n: number): string[] {
  const out: string[] = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
const DATES = recentDates(3);

function seedNav(db: MarketDb, key: string, values: number[]): void {
  for (let i = 0; i < DATES.length; i++) {
    db.insert(navHistory).values({ ticker: key, date: DATES[i], nav: values[i] }).run();
  }
  // A fresh quote row so getCachedSeries treats the series as <24h old.
  db.insert(fundQuotes)
    .values({ ticker: key, nav: values[values.length - 1], updatedAt: new Date().toISOString() })
    .run();
}

function seedBucket(db: AppDb, id = "core"): void {
  db.insert(buckets).values({ id, name: id, brokerage: "TEST" }).run();
}

function seedHolding(
  db: AppDb,
  h: { bucketId?: string; ticker: string; quoteSource: string; units: number },
): void {
  db.insert(holdings)
    .values({
      bucketId: h.bucketId ?? "core",
      ticker: h.ticker,
      englishName: h.ticker,
      units: h.units,
      quoteSource: h.quoteSource,
    })
    .run();
}

// Seed a catalog row so the holdings→catalog join (held ticker = abbr_name) can
// resolve a distribution policy. `policy` may be omitted to model an unknown
// (NULL) policy fund.
function seedCatalogFund(
  db: MarketDb,
  abbrName: string,
  policy: "dividend" | "accumulating" | null = null,
): void {
  db.insert(fundCatalog)
    .values({ projId: `proj-${abbrName}`, abbrName, distributionPolicy: policy })
    .run();
}

// Owner-mode context: these tests exercise the market.db read + FX path, which
// is the owner path (demo mode now sources NAV history from the committed
// fixture — covered separately in series.demo.test.ts).
function run<T>(fn: () => T | Promise<T>): Promise<T> {
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
});

afterEach(() => {
  appSqlite.close();
  marketSqlite.close();
});

describe("getPortfolioSeries — FX conversion", () => {
  it("leaves a THB-only book unchanged (no FX applied)", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 11, 12]);

    const { aggregate, missingFx } = await run(() => getPortfolioSeries("1mo"));

    // value = units * nav, no conversion: 100 * [10,11,12].
    expect(aggregate.map((p) => p.value)).toEqual([1000, 1100, 1200]);
    expect(missingFx).toEqual([]);
  });

  it("converts a USD holding to THB at each date's USD/THB rate", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "VOO", quoteSource: "market", units: 2 });
    seedNav(marketDb, "market:VOO", [100, 100, 100]); // flat in USD
    // USD/THB rises 30 → 31 → 32: the THB value should track the FX move even
    // though the USD price is flat.
    seedNav(marketDb, "market:THB=X", [30, 31, 32]);

    const { aggregate, missingFx } = await run(() => getPortfolioSeries("1mo"));

    // 2 units * 100 USD * rate.
    expect(aggregate.map((p) => p.value)).toEqual([6000, 6200, 6400]);
    expect(missingFx).toEqual([]);
  });

  it("sums a multi-currency book in THB via per-date cross rates", async () => {
    seedBucket(appDb);
    // THB fund: 100 units * 10 THB = 1000 THB, no conversion.
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 10, 10]);
    // USD ETF: 1 unit * 100 USD.
    seedHolding(appDb, { ticker: "VOO", quoteSource: "market", units: 1 });
    seedNav(marketDb, "market:VOO", [100, 100, 100]);
    // JPY index proxy: 10 units * 200 JPY.
    seedHolding(appDb, { ticker: "^N225", quoteSource: "market", units: 10 });
    seedNav(marketDb, "market:^N225", [200, 200, 200]);

    // USD/THB = 30 (flat). USD/JPY = 150 (flat) → JPY/THB = 30/150 = 0.2.
    seedNav(marketDb, "market:THB=X", [30, 30, 30]);
    seedNav(marketDb, "market:JPY=X", [150, 150, 150]);

    const { aggregate, missingFx } = await run(() => getPortfolioSeries("1mo"));

    // THB 1000 + USD (1*100*30 = 3000) + JPY (10*200*0.2 = 400) = 4400.
    expect(aggregate.map((p) => p.value)).toEqual([4400, 4400, 4400]);
    expect(missingFx).toEqual([]);
  });

  it("degrades gracefully when an FX rate is missing (drops that holding, flags it)", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 10, 10]);
    seedHolding(appDb, { ticker: "VOO", quoteSource: "market", units: 1 });
    seedNav(marketDb, "market:VOO", [100, 100, 100]);
    // No yahoo:THB=X seeded and no network → USD can't convert. The THB fund
    // still totals; the USD holding is dropped and USD is flagged.
    const { aggregate, missingFx } = await run(() => getPortfolioSeries("1mo"));

    expect(aggregate.map((p) => p.value)).toEqual([1000, 1000, 1000]);
    expect(missingFx).toContain("USD");
  });
});

describe("getPortfolioSeries — carry-in (owner mode left edge)", () => {
  /** Insert a nav row at an arbitrary date offset from today. */
  function navAtOffset(key: string, daysAgo: number, nav: number): void {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    marketDb
      .insert(navHistory)
      .values({ ticker: key, date: d.toISOString().slice(0, 10), nav })
      .run();
    marketDb
      .insert(fundQuotes)
      .values({ ticker: key, nav, updatedAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
  }

  it("seeds the window's first date from the last pre-window nav", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 10 });
    // Only data point is BEFORE the 1mo window (45 days ago). Without carry-in
    // the windowed query returns nothing and the holding vanishes; with carry-in
    // it's forward-filled from that pre-window value onto the window's first date.
    navAtOffset("thai_mutual_fund:EXAMPLE-FUND-A", 45, 12);

    const { aggregate } = await run(() => getPortfolioSeries("1mo"));
    expect(aggregate.length).toBeGreaterThan(0);
    expect(aggregate[0].value).toBe(120); // 10 units * 12, carried in
  });

  it("left edge includes EVERY holding that has prior data (no partial edge)", async () => {
    seedBucket(appDb);
    // Both funds were held before the window opened: A only has a pre-window
    // point; B has both a pre-window point and a later in-window one.
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 10 });
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-B", quoteSource: "thai_mutual_fund", units: 5 });
    navAtOffset("thai_mutual_fund:EXAMPLE-FUND-A", 50, 12); // 10*12 = 120 carried in
    navAtOffset("thai_mutual_fund:EXAMPLE-FUND-B", 40, 20); // 5*20 = 100 carried in (pre-window)
    navAtOffset("thai_mutual_fund:EXAMPLE-FUND-B", 10, 22); // later in-window move

    const { aggregate } = await run(() => getPortfolioSeries("1mo"));
    // Both funds present on the first plotted date → 120 + 100, no partial edge.
    expect(aggregate[0].value).toBe(220);
  });

  it("does not widen the timeline before the window start", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 10 });
    navAtOffset("thai_mutual_fund:EXAMPLE-FUND-A", 45, 12);

    const since = (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 31);
      return d.toISOString().slice(0, 10);
    })();
    const { aggregate } = await run(() => getPortfolioSeries("1mo"));
    // No plotted date precedes the window start; the carry-in is re-dated to it.
    expect(aggregate.every((p) => p.date >= since)).toBe(true);
  });
});

describe("getPortfolioSeries — hasDistributingHolding flag", () => {
  it("is true when a held fund's catalog distributionPolicy is 'dividend'", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 11, 12]);
    // Catalog row for the held ticker (held ticker == abbr_name) pays dividends.
    seedCatalogFund(marketDb, "EXAMPLE-FUND-A", "dividend");

    const { hasDistributingHolding } = await run(() => getPortfolioSeries("1mo"));
    expect(hasDistributingHolding).toBe(true);
  });

  it("is false when held funds are accumulating or have an unknown policy", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-B", quoteSource: "thai_mutual_fund", units: 50 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 11, 12]);
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-B", [20, 20, 20]);
    seedCatalogFund(marketDb, "EXAMPLE-FUND-A", "accumulating");
    seedCatalogFund(marketDb, "EXAMPLE-FUND-B", null); // unknown policy

    const { hasDistributingHolding } = await run(() => getPortfolioSeries("1mo"));
    expect(hasDistributingHolding).toBe(false);
  });

  it("is false when a holding doesn't match any catalog fund (e.g. a US ETF)", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "VOO", quoteSource: "market", units: 2 });
    seedNav(marketDb, "market:VOO", [100, 100, 100]);
    seedNav(marketDb, "market:THB=X", [30, 30, 30]);
    // A dividend-paying catalog fund the user does NOT hold must not trigger it.
    seedCatalogFund(marketDb, "EXAMPLE-FUND-A", "dividend");

    const { hasDistributingHolding } = await run(() => getPortfolioSeries("1mo"));
    expect(hasDistributingHolding).toBe(false);
  });

  it("is true if ANY held fund pays dividends, even alongside accumulating ones", async () => {
    seedBucket(appDb);
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-A", quoteSource: "thai_mutual_fund", units: 100 });
    seedHolding(appDb, { ticker: "EXAMPLE-FUND-B", quoteSource: "thai_mutual_fund", units: 50 });
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-A", [10, 11, 12]);
    seedNav(marketDb, "thai_mutual_fund:EXAMPLE-FUND-B", [20, 20, 20]);
    seedCatalogFund(marketDb, "EXAMPLE-FUND-A", "accumulating");
    seedCatalogFund(marketDb, "EXAMPLE-FUND-B", "dividend");

    const { hasDistributingHolding } = await run(() => getPortfolioSeries("1mo"));
    expect(hasDistributingHolding).toBe(true);
  });
});
