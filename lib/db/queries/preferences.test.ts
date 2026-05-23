import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../context";
import * as schema from "../schema";
import {
  forget,
  listActive,
  listRecentlyForgotten,
  recall,
  restore,
  save,
  update,
} from "./preferences";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = resolve("lib/db/migrations");
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

function withFresh<T>(fn: () => T): T {
  const { sqlite, db } = freshDb();
  return runWithDbContext({ db, sqlite, isDemo: true, sessionId: "test" }, fn) as T;
}

describe("preferences queries", () => {
  it("save inserts an active row, listActive returns it", () => {
    withFresh(() => {
      const row = save({
        userId: null,
        category: "profile",
        content: "risk tolerance: moderate",
        source: "user_tool",
      });
      expect(row.validUntil).toBeNull();
      const active = listActive(null);
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe("risk tolerance: moderate");
    });
  });

  it("listActive filters by category and orders by category then id", () => {
    withFresh(() => {
      save({ userId: null, category: "profile", content: "p1", source: "user_tool" });
      save({ userId: null, category: "response_style", content: "r1", source: "user_tool" });
      save({ userId: null, category: "profile", content: "p2", source: "user_tool" });
      const profile = listActive(null, "profile");
      expect(profile.map((r) => r.content)).toEqual(["p1", "p2"]);
      const all = listActive(null);
      expect(all.map((r) => r.category)).toEqual(["profile", "profile", "response_style"]);
    });
  });

  it("forget sets validUntil; row drops from active, shows in recently-forgotten", () => {
    withFresh(() => {
      const r = save({
        userId: null,
        category: "fact",
        content: "wife: Sarah",
        source: "user_tool",
      });
      const result = forget(null, String(r.id));
      expect(result.kind).toBe("match");
      expect(result.row?.validUntil).toBeTruthy();
      expect(listActive(null)).toHaveLength(0);
      expect(listRecentlyForgotten(null)).toHaveLength(1);
    });
  });

  it("forget by substring matches single active row; ambiguous when multiple match", () => {
    withFresh(() => {
      save({ userId: null, category: "fact", content: "owns NVDA shares", source: "user_tool" });
      const single = forget(null, "NVDA");
      expect(single.kind).toBe("match");

      save({ userId: null, category: "fact", content: "loves cats", source: "user_tool" });
      save({ userId: null, category: "fact", content: "owns three cats", source: "user_tool" });
      const ambiguous = forget(null, "cats");
      expect(ambiguous.kind).toBe("ambiguous");
      expect(ambiguous.candidates).toHaveLength(2);
    });
  });

  it("update supersedes the old row and inserts a new active row in one txn", () => {
    withFresh(() => {
      const orig = save({
        userId: null,
        category: "profile",
        content: "retirement age: 50",
        source: "user_tool",
      });
      const result = update(null, String(orig.id), "retirement age: 55");
      expect(result.kind).toBe("match");
      expect(result.oldRow?.validUntil).toBeTruthy();
      expect(result.newRow?.content).toBe("retirement age: 55");
      expect(result.newRow?.validUntil).toBeNull();
      expect(listActive(null)).toHaveLength(1);
      expect(listActive(null)[0].id).toBe(result.newRow?.id);
    });
  });

  it("restore clears validUntil on a recently-forgotten row", () => {
    withFresh(() => {
      const r = save({ userId: null, category: "fact", content: "temp", source: "user_tool" });
      forget(null, String(r.id));
      expect(listActive(null)).toHaveLength(0);
      const restored = restore(r.id);
      expect(restored?.validUntil).toBeNull();
      expect(listActive(null)).toHaveLength(1);
    });
  });

  it("restore is a no-op on an already-active row", () => {
    withFresh(() => {
      const r = save({ userId: null, category: "fact", content: "stays", source: "user_tool" });
      const result = restore(r.id);
      expect(result).toBeUndefined();
      expect(listActive(null)).toHaveLength(1);
    });
  });
});

describe("recall", () => {
  it("returns active rows matching any query token (case-insensitive)", () => {
    withFresh(() => {
      save({
        userId: null,
        category: "finance_context",
        content: "tax: files jointly in Thailand",
        source: "user_tool",
      });
      save({
        userId: null,
        category: "profile",
        content: "retirement age: 55",
        source: "user_tool",
      });
      save({ userId: null, category: "fact", content: "owns a dog", source: "user_tool" });

      const taxHits = recall(null, "TAX situation");
      expect(taxHits.map((r) => r.content)).toEqual(["tax: files jointly in Thailand"]);

      // Multiple tokens are OR'd, so an unrelated extra word still recalls.
      const orHits = recall(null, "retirement crypto");
      expect(orHits.map((r) => r.content)).toEqual(["retirement age: 55"]);
    });
  });

  it("excludes forgotten (inactive) rows", () => {
    withFresh(() => {
      const r = save({
        userId: null,
        category: "fact",
        content: "wants quarterly rebalancing",
        source: "user_tool",
      });
      expect(recall(null, "rebalancing")).toHaveLength(1);
      forget(null, String(r.id));
      expect(recall(null, "rebalancing")).toHaveLength(0);
    });
  });

  it("returns [] for blank / punctuation-only queries and on no match", () => {
    withFresh(() => {
      save({ userId: null, category: "fact", content: "likes index funds", source: "user_tool" });
      expect(recall(null, "   ")).toEqual([]);
      expect(recall(null, "!!!")).toEqual([]);
      expect(recall(null, "bitcoin")).toEqual([]);
    });
  });

  it("orders by (category, id) and respects the limit", () => {
    withFresh(() => {
      save({ userId: null, category: "profile", content: "alpha keyword", source: "user_tool" });
      save({ userId: null, category: "fact", content: "beta keyword", source: "user_tool" });
      const all = recall(null, "keyword");
      // fact sorts before profile alphabetically.
      expect(all.map((r) => r.category)).toEqual(["fact", "profile"]);
      expect(recall(null, "keyword", 1)).toHaveLength(1);
    });
  });
});
