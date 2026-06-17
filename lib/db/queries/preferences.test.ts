import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { runWithDbContext } from "../context";
import * as schema from "../schema";
import {
  confirm,
  createLink,
  decayExtracted,
  forget,
  listActive,
  listLinks,
  listRecentlyForgotten,
  recall,
  restore,
  save,
  update,
  updateFromExtraction,
} from "./preferences";

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
  return runWithDbContext(
    { appDb: db, appSqlite: sqlite, marketDb, marketSqlite, isDemo: true, sessionId: "test" },
    fn,
  ) as T;
}

describe("preferences queries", () => {
  it("save inserts an active row, listActive returns it", () => {
    withFresh(() => {
      const row = save({
        category: "profile",
        content: "risk tolerance: moderate",
        source: "user_tool",
      });
      expect(row.validUntil).toBeNull();
      const active = listActive();
      expect(active).toHaveLength(1);
      expect(active[0].content).toBe("risk tolerance: moderate");
    });
  });

  it("listActive filters by category and orders by category then id", () => {
    withFresh(() => {
      save({ category: "profile", content: "p1", source: "user_tool" });
      save({ category: "response_style", content: "r1", source: "user_tool" });
      save({ category: "profile", content: "p2", source: "user_tool" });
      const profile = listActive("profile");
      expect(profile.map((r) => r.content)).toEqual(["p1", "p2"]);
      const all = listActive();
      expect(all.map((r) => r.category)).toEqual(["profile", "profile", "response_style"]);
    });
  });

  it("forget sets validUntil; row drops from active, shows in recently-forgotten", () => {
    withFresh(() => {
      const r = save({
        category: "fact",
        content: "wife: Sarah",
        source: "user_tool",
      });
      const result = forget(String(r.id));
      expect(result.kind).toBe("match");
      expect(result.row?.validUntil).toBeTruthy();
      expect(listActive()).toHaveLength(0);
      expect(listRecentlyForgotten()).toHaveLength(1);
    });
  });

  it("forget by substring matches single active row; ambiguous when multiple match", () => {
    withFresh(() => {
      save({ category: "fact", content: "owns NVDA shares", source: "user_tool" });
      const single = forget("NVDA");
      expect(single.kind).toBe("match");

      save({ category: "fact", content: "loves cats", source: "user_tool" });
      save({ category: "fact", content: "owns three cats", source: "user_tool" });
      const ambiguous = forget("cats");
      expect(ambiguous.kind).toBe("ambiguous");
      expect(ambiguous.candidates).toHaveLength(2);
    });
  });

  it("update supersedes the old row and inserts a new active row in one txn", () => {
    withFresh(() => {
      const orig = save({
        category: "profile",
        content: "retirement age: 50",
        source: "user_tool",
      });
      const result = update(String(orig.id), "retirement age: 55");
      expect(result.kind).toBe("match");
      expect(result.oldRow?.validUntil).toBeTruthy();
      expect(result.newRow?.content).toBe("retirement age: 55");
      expect(result.newRow?.validUntil).toBeNull();
      expect(listActive()).toHaveLength(1);
      expect(listActive()[0].id).toBe(result.newRow?.id);
    });
  });

  it("restore clears validUntil on a recently-forgotten row", () => {
    withFresh(() => {
      const r = save({ category: "fact", content: "temp", source: "user_tool" });
      forget(String(r.id));
      expect(listActive()).toHaveLength(0);
      const restored = restore(r.id);
      expect(restored?.validUntil).toBeNull();
      expect(listActive()).toHaveLength(1);
    });
  });

  it("restore is a no-op on an already-active row", () => {
    withFresh(() => {
      const r = save({ category: "fact", content: "stays", source: "user_tool" });
      const result = restore(r.id);
      expect(result).toBeUndefined();
      expect(listActive()).toHaveLength(1);
    });
  });
});

describe("recall", () => {
  it("returns active rows matching any query token (case-insensitive)", () => {
    withFresh(() => {
      save({
        category: "finance_context",
        content: "tax: files jointly in Thailand",
        source: "user_tool",
      });
      save({
        category: "profile",
        content: "retirement age: 55",
        source: "user_tool",
      });
      save({ category: "fact", content: "owns a dog", source: "user_tool" });

      const taxHits = recall("TAX situation");
      expect(taxHits.map((r) => r.content)).toEqual(["tax: files jointly in Thailand"]);

      // Multiple tokens are OR'd, so an unrelated extra word still recalls.
      const orHits = recall("retirement crypto");
      expect(orHits.map((r) => r.content)).toEqual(["retirement age: 55"]);
    });
  });

  it("excludes forgotten (inactive) rows", () => {
    withFresh(() => {
      const r = save({
        category: "fact",
        content: "wants quarterly rebalancing",
        source: "user_tool",
      });
      expect(recall("rebalancing")).toHaveLength(1);
      forget(String(r.id));
      expect(recall("rebalancing")).toHaveLength(0);
    });
  });

  it("returns [] for blank / punctuation-only queries and on no match", () => {
    withFresh(() => {
      save({ category: "fact", content: "likes index funds", source: "user_tool" });
      expect(recall("   ")).toEqual([]);
      expect(recall("!!!")).toEqual([]);
      expect(recall("bitcoin")).toEqual([]);
    });
  });

  it("orders by (category, id) and respects the limit", () => {
    withFresh(() => {
      save({ category: "profile", content: "alpha keyword", source: "user_tool" });
      save({ category: "fact", content: "beta keyword", source: "user_tool" });
      const all = recall("keyword");
      // fact sorts before profile alphabetically.
      expect(all.map((r) => r.category)).toEqual(["fact", "profile"]);
      expect(recall("keyword", 1)).toHaveLength(1);
    });
  });
});

// Fail-closed per-user scoping (ADR 0006 §5): a logged-in user sees only their
// own notes — never another user's, never the legacy NULL-owned owner set.
describe("cross-user isolation", () => {
  it("scopes every read to the request user", () => {
    const { sqlite, db, marketDb, marketSqlite } = freshDb();
    const now = new Date();
    db.insert(schema.user)
      .values([
        {
          id: "A",
          name: "A",
          email: "a@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "B",
          name: "B",
          email: "b@example.test",
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
    const base = {
      appDb: db,
      appSqlite: sqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "test",
    };
    const as = (userId: string | null, fn: () => void) => runWithDbContext({ ...base, userId }, fn);

    as(null, () => save({ category: "fact", content: "legacy owner note", source: "user_tool" }));
    as("A", () => save({ category: "fact", content: "A's note", source: "user_tool" }));
    as("B", () => save({ category: "fact", content: "B's note", source: "user_tool" }));

    as("A", () => {
      const rows = listActive();
      expect(rows.map((r) => r.content)).toEqual(["A's note"]);
      // A cannot see, recall, or forget B's note or the NULL owner note.
      expect(recall("note").map((r) => r.content)).toEqual(["A's note"]);
      expect(forget("B's note").kind).toBe("none");
      expect(forget("legacy owner note").kind).toBe("none");
    });
    as("B", () => {
      expect(listActive().map((r) => r.content)).toEqual(["B's note"]);
    });
    as(null, () => {
      expect(listActive().map((r) => r.content)).toEqual(["legacy owner note"]);
    });
  });
});

describe("pending capture + confirm", () => {
  it("confirm activates a pending row and stamps last_confirmed_at", () => {
    withFresh(() => {
      const r = save({
        category: "finance_context",
        content: "no crypto",
        source: "advisor_tool",
        status: "pending",
      });
      expect(r.status).toBe("pending");
      expect(r.lastConfirmedAt).toBeNull();
      const result = confirm(String(r.id));
      expect(result.kind).toBe("match");
      expect(result.row?.status).toBe("active");
      expect(result.row?.lastConfirmedAt).toBeTruthy();
    });
  });
});

describe("updateFromExtraction trust-tier guard", () => {
  it("supersedes an extracted row but refuses to override an explicit one", () => {
    withFresh(() => {
      const extracted = save({
        category: "profile",
        content: "risk tolerance: moderate",
        source: "extracted",
        confidence: 0.8,
      });
      const ok = updateFromExtraction(extracted.id, "risk tolerance: aggressive", 0.85);
      expect(ok.ok).toBe(true);
      expect(listActive().map((r) => r.content)).toEqual(["risk tolerance: aggressive"]);

      const explicit = save({
        category: "finance_context",
        content: "funds only, no individual stocks",
        source: "user_tool",
      });
      const rejected = updateFromExtraction(explicit.id, "individual stocks are fine now", 0.9);
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.rejected).toBe("not_extracted");
      // The explicit note is untouched.
      expect(listActive().some((r) => r.content === "funds only, no individual stocks")).toBe(true);
    });
  });
});

describe("memory links", () => {
  it("lists live links, re-points on supersede, and drops a forgotten target", () => {
    withFresh(() => {
      const a = save({ category: "fact", content: "A", source: "user_tool" });
      const b = save({ category: "fact", content: "B", source: "user_tool" });
      createLink(a.id, b.id, "relates_to");
      expect(listLinks(a.id).map((l) => l.preference.content)).toEqual(["B"]);

      // Superseding A re-points the link to the new row.
      const upd = update(String(a.id), "A2");
      const newAId = upd.newRow?.id as number;
      expect(listLinks(newAId).map((l) => l.preference.content)).toEqual(["B"]);

      // Forgetting B (the target) drops it from the validity-aware read.
      forget(String(b.id));
      expect(listLinks(newAId)).toEqual([]);
    });
  });
});

describe("decayExtracted", () => {
  it("decays unconfirmed extracted rows but leaves explicit and confirmed ones", () => {
    withFresh(() => {
      const extracted = save({
        category: "fact",
        content: "likes gold",
        source: "extracted",
        confidence: 0.9,
      });
      const explicit = save({ category: "fact", content: "explicit", source: "user_tool" });
      const confirmed = save({
        category: "fact",
        content: "confirmed extracted",
        source: "extracted",
        confidence: 0.9,
      });
      confirm(String(confirmed.id));

      const n = decayExtracted({ step: 0.1, minAgeDays: 0 });
      expect(n).toBe(1);
      const byContent = (c: string) => listActive().find((r) => r.content === c);
      expect(byContent("likes gold")?.confidence).toBeCloseTo(0.8);
      expect(byContent("explicit")?.confidence).toBeNull();
      expect(byContent("confirmed extracted")?.confidence).toBe(0.9);
      void extracted;
      void explicit;
    });
  });
});
