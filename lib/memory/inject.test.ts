import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../db/context";
import { save } from "../db/queries/preferences";
import * as schema from "../db/schema";
import { buildMemoryBlock, memoryBlockHash } from "./inject";

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

describe("buildMemoryBlock", () => {
  it("returns the empty string when no active preferences exist", () => {
    withFresh(() => {
      expect(buildMemoryBlock(null)).toBe("");
      expect(memoryBlockHash(buildMemoryBlock(null))).toBe(memoryBlockHash(""));
    });
  });

  it("renders the documented compact markdown format with category headings", () => {
    withFresh(() => {
      save({
        userId: null,
        category: "profile",
        content: "risk tolerance: moderate",
        source: "user_tool",
      });
      save({
        userId: null,
        category: "profile",
        content: "timezone: Asia/Bangkok",
        source: "user_tool",
      });
      save({
        userId: null,
        category: "response_style",
        content: "be concise; skip disclaimers",
        source: "user_tool",
      });
      save({
        userId: null,
        category: "fact",
        content: "wife's name is Sarah",
        source: "user_tool",
      });

      const block = buildMemoryBlock(null);
      // Section ordering is alphabetical by category name (fact, finance_context,
      // profile, response_style). Categories with zero rows are omitted entirely.
      expect(block).toBe(
        [
          "## Your stored preferences",
          "",
          "### Facts",
          "- wife's name is Sarah",
          "",
          "### Profile",
          "- risk tolerance: moderate",
          "- timezone: Asia/Bangkok",
          "",
          "### Response style",
          "- be concise; skip disclaimers",
        ].join("\n"),
      );
    });
  });

  it("is byte-identical across calls with the same DB state (cache-discipline guarantee)", () => {
    withFresh(() => {
      save({
        userId: null,
        category: "profile",
        content: "risk tolerance: moderate",
        source: "advisor_tool",
      });
      save({
        userId: null,
        category: "finance_context",
        content: "401k at Fidelity",
        source: "advisor_tool",
      });
      save({
        userId: null,
        category: "finance_context",
        content: "Thai tax resident",
        source: "advisor_tool",
      });

      const a = buildMemoryBlock(null);
      const b = buildMemoryBlock(null);
      const c = buildMemoryBlock(null);
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(memoryBlockHash(a)).toBe(memoryBlockHash(b));
      expect(memoryBlockHash(b)).toBe(memoryBlockHash(c));
    });
  });

  it("orders rows within a category by id ascending regardless of insertion order quirks", () => {
    withFresh(() => {
      // Insert in non-monotonic content order; ids will still be ascending in
      // insertion order, which is what we rely on for stable render output.
      const r1 = save({
        userId: null,
        category: "profile",
        content: "z-last alphabetically",
        source: "user_tool",
      });
      const r2 = save({
        userId: null,
        category: "profile",
        content: "a-first alphabetically",
        source: "user_tool",
      });
      const block = buildMemoryBlock(null);
      const lines = block.split("\n").filter((l) => l.startsWith("- "));
      expect(lines).toEqual(["- z-last alphabetically", "- a-first alphabetically"]);
      expect(r1.id).toBeLessThan(r2.id);
    });
  });

  it("uses the rows override (no DB) when supplied — used for deterministic snapshot tests", () => {
    const now = "2026-05-22T00:00:00.000Z";
    const block = buildMemoryBlock(null, {
      rows: [
        {
          id: 1,
          userId: null,
          category: "profile",
          content: "stub",
          source: "user_tool",
          sourceSessionId: null,
          sourceTurnIds: null,
          confidence: null,
          validFrom: now,
          validUntil: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    expect(block).toBe(["## Your stored preferences", "", "### Profile", "- stub"].join("\n"));
  });
});
