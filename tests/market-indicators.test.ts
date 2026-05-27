// Integration test (real in-memory SQLite) for the per-user Markets indicator
// list: default fallback, ordered set/get, sanitization, and fail-closed
// per-user scoping (one user's list never leaks to another).

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../lib/db/context";
import {
  getUserIndicatorSymbols,
  setUserIndicatorSymbols,
} from "../lib/db/queries/market-indicators";
import * as schema from "../lib/db/schema";
import { DEFAULT_INDICATOR_SYMBOLS } from "../lib/market/indicators";

function freshDb() {
  const sqlite = new Database(":memory:");
  const dir = resolve("lib/db/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--> statement-breakpoint/g, ";");
  sqlite.exec(sql);
  // FK off AFTER migrations (some migrations re-enable the pragma) so the test
  // can use arbitrary user ids without seeding the user table — we're exercising
  // the scoping query logic, not FK enforcement.
  sqlite.pragma("foreign_keys = OFF");
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/** Run `fn` against a fresh DB scoped to `userId` (null = single-owner mode). */
function as<T>(db: ReturnType<typeof freshDb>, userId: string | null, fn: () => T): T {
  return runWithDbContext(
    { db: db.db, sqlite: db.sqlite, isDemo: false, sessionId: "test", userId },
    fn,
  ) as T;
}

describe("user market indicators", () => {
  it("falls back to the default set when the user has no rows", () => {
    const db = freshDb();
    as(db, null, () => {
      expect(getUserIndicatorSymbols()).toEqual(DEFAULT_INDICATOR_SYMBOLS);
    });
  });

  it("persists the chosen list and preserves order", () => {
    const db = freshDb();
    as(db, null, () => {
      setUserIndicatorSymbols(["THB=X", "SPY", "GC=F"]);
      expect(getUserIndicatorSymbols()).toEqual(["THB=X", "SPY", "GC=F"]);
    });
  });

  it("drops unknown symbols and de-dupes, keeping first position", () => {
    const db = freshDb();
    as(db, null, () => {
      const saved = setUserIndicatorSymbols(["SPY", "NOT_A_THING", "SPY", "GC=F"]);
      expect(saved).toEqual(["SPY", "GC=F"]);
      expect(getUserIndicatorSymbols()).toEqual(["SPY", "GC=F"]);
    });
  });

  it("resets to defaults when set to an empty list", () => {
    const db = freshDb();
    as(db, null, () => {
      setUserIndicatorSymbols(["SPY"]);
      setUserIndicatorSymbols([]);
      expect(getUserIndicatorSymbols()).toEqual(DEFAULT_INDICATOR_SYMBOLS);
    });
  });

  it("scopes lists per user — one user's list never leaks to another", () => {
    const db = freshDb();
    as(db, "user-a", () => setUserIndicatorSymbols(["SPY", "GC=F"]));
    as(db, "user-b", () => setUserIndicatorSymbols(["THB=X"]));

    as(db, "user-a", () => expect(getUserIndicatorSymbols()).toEqual(["SPY", "GC=F"]));
    as(db, "user-b", () => expect(getUserIndicatorSymbols()).toEqual(["THB=X"]));
    // A different/null owner sees neither — falls back to defaults.
    as(db, null, () => expect(getUserIndicatorSymbols()).toEqual(DEFAULT_INDICATOR_SYMBOLS));
  });
});
