// Contract for the demo seed AFTER the database split.
//
// A demo session's in-memory database is an app.db only: it carries the
// persona's buckets / holdings / plan / journal / models. Market data is NOT
// seeded here — demo sessions read the shared real market.db (see
// lib/api/with-db.ts, lib/market/cache.ts). So this seed must:
//   1. populate buckets + holdings (one per data.ts holding),
//   2. seed the plan, journal entries, and built-in model portfolios,
//   3. point holdings at the real Thai-fund tickers from data.ts so the live
//      NAV path can price them against real SEC NAVs.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import { PORTFOLIOS } from "./data";
import { seedDemoData } from "./demo-seed";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  // App baseline only — the demo session DB has no market tables.
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
  return { sqlite, db };
}

describe("seedDemoData (app-only demo DB)", () => {
  it("seeds buckets and one holding row per data.ts holding", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const bucketCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM buckets").get() as { n: number })
      .n;
    expect(bucketCount).toBe(PORTFOLIOS.length);

    const expectedHoldings = PORTFOLIOS.reduce((sum, p) => sum + p.holdings.length, 0);
    const holdingCount = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM holdings").get() as { n: number }
    ).n;
    expect(holdingCount).toBe(expectedHoldings);
  });

  it("seeds every holding with the thai_mutual_fund quote source and a real ticker", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const rows = sqlite.prepare("SELECT ticker, quote_source FROM holdings").all() as Array<{
      ticker: string;
      quote_source: string;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.quote_source).toBe("thai_mutual_fund");
      expect(r.ticker).toBeTruthy();
    }
  });

  it("seeds the plan, journal entries, and built-in model portfolios", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const plans = (sqlite.prepare("SELECT COUNT(*) AS n FROM plans").get() as { n: number }).n;
    expect(plans).toBe(1);

    const journal = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }
    ).n;
    expect(journal).toBeGreaterThan(0);

    const models = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM model_portfolios").get() as { n: number }
    ).n;
    expect(models).toBeGreaterThan(0);
  });
});
