import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { runWithDbContext } from "../db/context";
import { getById, listActive, type Preference, save } from "../db/queries/preferences";
import * as schema from "../db/schema";
import type { ConsolidationOp } from "../memory/consolidate";
import { consolidateMemory, findNearDupClusters } from "./consolidate-memory";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const dir = resolve("lib/db/migrations/app");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
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

function withFresh<T>(fn: () => T): T {
  const { sqlite, db, marketDb, marketSqlite } = freshDb();
  return runWithDbContext(
    { appDb: db, appSqlite: sqlite, marketDb, marketSqlite, isDemo: true, sessionId: "test" },
    fn,
  ) as T;
}

const longContent = (prefix: string) => `${prefix} ${"x".repeat(9000)}`;

describe("findNearDupClusters", () => {
  it("groups lexically-similar rows, ignores distinct ones", () => {
    const rows = [
      { id: 1, content: "be concise" },
      { id: 2, content: "be concise please" },
      { id: 3, content: "I am a Thai tax resident" },
    ] as Preference[];
    const clusters = findNearDupClusters(rows, 0.5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].map((r) => r.id).sort()).toEqual([1, 2]);
  });
});

describe("consolidateMemory", () => {
  it("skips a scope with no near-dups and no pressure (no model call)", async () => {
    await withFresh(async () => {
      save({ category: "user", content: "be concise", source: "advisor_tool" });
      save({ category: "user", content: "Thai tax resident", source: "advisor_tool" });
      const propose = async () => {
        throw new Error("propose must not be called: no clusters, no pressure");
      };
      const res = await consolidateMemory({ scopes: [null], propose });
      expect(res.scopesWorked).toBe(0);
      expect(res.mergedCount).toBe(0);
    });
  });

  it("consolidates a near-duplicate even in a SMALL store (below the pressure ceiling)", async () => {
    await withFresh(async () => {
      // Mirrors the real bug: an explicit save + a session-close extraction of the
      // same fact, different wording — a near-dup well under any size ceiling.
      const explicit = save({
        category: "user",
        content: "no individual stocks, funds only",
        source: "advisor_tool",
      });
      const extracted = save({
        category: "user",
        content: "I only invest in funds, no individual stocks",
        source: "extracted",
        confidence: 0.98,
      });
      const propose = async (): Promise<ConsolidationOp[]> => [
        { op: "merge", ids: [explicit.id, extracted.id] },
      ];
      const res = await consolidateMemory({ scopes: [null], propose });
      expect(res.scopesWorked).toBe(1);
      expect(res.mergedCount).toBe(1);
      // The explicit memory survives; the extracted near-dup is folded in.
      expect(listActive().map((r) => r.id)).toEqual([explicit.id]);
      expect(getById(extracted.id)?.supersededBy).toBe(explicit.id);
    });
  });

  it("merges near-duplicates when over pressure (loser superseded into survivor)", async () => {
    await withFresh(async () => {
      // Over the 24k char ceiling via long content → pressure.
      const a = save({
        category: "user",
        content: longContent("be concise"),
        source: "advisor_tool",
      });
      const b = save({
        category: "user",
        content: longContent("be concise please"),
        source: "advisor_tool",
      });
      save({ category: "user", content: longContent("Thai tax resident"), source: "advisor_tool" });

      const propose = async (): Promise<ConsolidationOp[]> => [{ op: "merge", ids: [a.id, b.id] }];
      const res = await consolidateMemory({ scopes: [null], propose });
      expect(res.scopesWorked).toBe(1);
      expect(res.mergedCount).toBe(1);
      // b is merged away → not active, superseded_by points at the survivor.
      expect(listActive().some((r) => r.id === b.id)).toBe(false);
      expect(getById(b.id)?.supersededBy).toBe(a.id);
    });
  });

  it("explicit-protects the survivor: an extracted survivor is overridden by an explicit loser", async () => {
    await withFresh(async () => {
      const extracted = save({
        category: "user",
        content: longContent("risk tolerance moderate"),
        source: "extracted",
        confidence: 0.8,
      });
      const explicit = save({
        category: "user",
        content: longContent("risk tolerance moderate indeed"),
        source: "advisor_tool",
      });
      save({ category: "user", content: longContent("likes gold"), source: "advisor_tool" });

      // Model wrongly picks the extracted row as survivor; apply must flip it.
      const propose = async (): Promise<ConsolidationOp[]> => [
        { op: "merge", ids: [extracted.id, explicit.id] },
      ];
      await consolidateMemory({ scopes: [null], propose });
      // The explicit row survives; the extracted one is merged away.
      expect(listActive().some((r) => r.id === explicit.id)).toBe(true);
      expect(getById(extracted.id)?.supersededBy).toBe(explicit.id);
    });
  });
});
