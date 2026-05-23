import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../context";
import * as schema from "../schema";
import { appendMessage, createThread, purgeThread, renameThread, softDeleteThread } from "./chat";
import { searchThreads, toFtsMatchQuery } from "./search";

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

describe("toFtsMatchQuery", () => {
  it("tokenizes and adds prefix wildcards", () => {
    expect(toFtsMatchQuery("rebalance now")).toBe('"rebalance"* "now"*');
  });

  it("strips FTS operator characters that would break MATCH", () => {
    expect(toFtsMatchQuery('NEAR("tax")*')).toBe('"near"* "tax"*');
  });

  it("returns null for blank / punctuation-only queries", () => {
    expect(toFtsMatchQuery("   ")).toBeNull();
    expect(toFtsMatchQuery("!!!")).toBeNull();
  });
});

describe("searchThreads", () => {
  it("finds threads by message body and returns a snippet", () => {
    withFresh(() => {
      const a = createThread({ title: "Portfolio chat" });
      appendMessage({ threadId: a.id, role: "user", content: "When should I rebalance my bonds?" });
      const b = createThread({ title: "Tax chat" });
      appendMessage({ threadId: b.id, role: "user", content: "What about capital gains tax?" });

      const hits = searchThreads("rebalance");
      expect(hits).toHaveLength(1);
      expect(hits[0].thread.id).toBe(a.id);
      expect(hits[0].matchedOn).toBe("message");
      expect(hits[0].snippet).toContain("[rebalance]");
    });
  });

  it("matches as a prefix while typing", () => {
    withFresh(() => {
      const t = createThread({ title: "Chat" });
      appendMessage({ threadId: t.id, role: "assistant", content: "Diversification matters." });
      expect(searchThreads("divers")).toHaveLength(1);
    });
  });

  it("matches on thread title (title-only hit has no snippet)", () => {
    withFresh(() => {
      const t = createThread({ title: "Retirement planning" });
      appendMessage({ threadId: t.id, role: "user", content: "hello" });
      const hits = searchThreads("retirement");
      expect(hits).toHaveLength(1);
      expect(hits[0].matchedOn).toBe("title");
      expect(hits[0].snippet).toBeNull();
    });
  });

  it("reports matchedOn 'both' when title and body match", () => {
    withFresh(() => {
      const t = createThread({ title: "Rebalancing" });
      appendMessage({ threadId: t.id, role: "user", content: "How often to rebalance?" });
      const hits = searchThreads("rebalanc");
      expect(hits).toHaveLength(1);
      expect(hits[0].matchedOn).toBe("both");
    });
  });

  it("requires all tokens to match (implicit AND)", () => {
    withFresh(() => {
      const t = createThread({ title: "Chat" });
      appendMessage({ threadId: t.id, role: "user", content: "bonds and equities" });
      expect(searchThreads("bonds equities")).toHaveLength(1);
      expect(searchThreads("bonds crypto")).toHaveLength(0);
    });
  });

  it("excludes soft-deleted threads by default", () => {
    withFresh(() => {
      const t = createThread({ title: "Chat" });
      appendMessage({ threadId: t.id, role: "user", content: "unique-token-xyz" });
      expect(searchThreads("unique-token-xyz")).toHaveLength(1);
      softDeleteThread(t.id);
      expect(searchThreads("unique-token-xyz")).toHaveLength(0);
      expect(searchThreads("unique-token-xyz", { includeDeleted: true })).toHaveLength(1);
    });
  });

  it("drops a thread's messages from the index on hard delete (delete trigger)", () => {
    withFresh(() => {
      const t = createThread({ title: "Chat" });
      appendMessage({ threadId: t.id, role: "user", content: "ephemeralword" });
      expect(searchThreads("ephemeralword")).toHaveLength(1);
      // purgeThread cascades to chat_messages, firing the AFTER DELETE trigger
      // that removes the row from the external-content FTS index.
      purgeThread(t.id);
      expect(searchThreads("ephemeralword")).toHaveLength(0);
    });
  });

  it("returns [] for a blank query", () => {
    withFresh(() => {
      const t = createThread({ title: "Chat" });
      appendMessage({ threadId: t.id, role: "user", content: "anything" });
      expect(searchThreads("   ")).toEqual([]);
    });
  });

  it("reflects a renamed title", () => {
    withFresh(() => {
      const t = createThread({ title: "Old name" });
      appendMessage({ threadId: t.id, role: "user", content: "body" });
      expect(searchThreads("brandnew")).toHaveLength(0);
      renameThread(t.id, "Brandnew topic");
      expect(searchThreads("brandnew")).toHaveLength(1);
    });
  });
});
