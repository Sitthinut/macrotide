// renameHoldingSource rewrites a `source` label, but only within the bucket ids
// it's handed. The route resolves those from the user-scoped listBuckets, so
// these tests lock in that the query itself confines the rewrite to the given
// buckets (never touching holdings in other buckets), and that an empty target
// clears the label.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { type DbContext, runWithDbContext } from "../context";
import * as schema from "../schema";
import { createBucket } from "./buckets";
import { listHoldings, renameHoldingSource } from "./holdings";
import { createHoldingViaLedger } from "./project-holdings";

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
  const market = freshMarketDb();
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    marketDb: market.db,
    marketSqlite: market.sqlite,
  };
}

const BUCKET = {
  name: "B",
  typeLabel: null,
  icon: null,
  color: null,
  brokerage: "X",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

function seedHolding(bucketId: string, ticker: string, source: string | null) {
  createHoldingViaLedger({
    bucketId,
    ticker,
    englishName: ticker,
    units: 1,
    source,
    quoteSource: "market",
  });
}

describe("renameHoldingSource", () => {
  it("renames the label only within the given buckets", () => {
    const { sqlite, db, marketDb, marketSqlite } = freshDb();
    const ctx: DbContext = {
      appDb: db,
      appSqlite: sqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "s",
      userId: null,
    };
    runWithDbContext(ctx, () => {
      createBucket({ ...BUCKET, id: "b1" });
      createBucket({ ...BUCKET, id: "b2" });
      seedHolding("b1", "VOO", "SCB");
      seedHolding("b1", "VTI", "SCB");
      seedHolding("b2", "QQQ", "SCB"); // different bucket, same label — must stay

      const changed = renameHoldingSource(["b1"], "SCB", "SCB Easy Invest");
      expect(changed).toBe(2);
      expect(listHoldings("b1").every((h) => h.source === "SCB Easy Invest")).toBe(true);
      expect(listHoldings("b2")[0].source).toBe("SCB");
    });
  });

  it("clears the label when the new value is empty", () => {
    const { sqlite, db, marketDb, marketSqlite } = freshDb();
    const ctx: DbContext = {
      appDb: db,
      appSqlite: sqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "s",
      userId: null,
    };
    runWithDbContext(ctx, () => {
      createBucket({ ...BUCKET, id: "b1" });
      seedHolding("b1", "VOO", "SCB");
      renameHoldingSource(["b1"], "SCB", "");
      expect(listHoldings("b1")[0].source).toBeNull();
    });
  });

  it("is a no-op when given no buckets", () => {
    const { sqlite, db, marketDb, marketSqlite } = freshDb();
    const ctx: DbContext = {
      appDb: db,
      appSqlite: sqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "s",
      userId: null,
    };
    runWithDbContext(ctx, () => {
      expect(renameHoldingSource([], "SCB", "Y")).toBe(0);
    });
  });
});
