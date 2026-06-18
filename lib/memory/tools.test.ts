import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { runWithDbContext } from "../db/context";
import * as schema from "../db/schema";
import { createMemoryTools, type MemoryTools } from "./tools";

// The tool `execute` is typed as optional and its return is a union with an
// AsyncIterable stream variant; in tests we always get the plain object back.
// This narrows to the slice the UI contract cares about.
interface ToolResult {
  ok: boolean;
  memoryEvent?: {
    kind: string;
    id: number;
    oldId?: number;
    category: string;
    status?: string;
    content?: string;
  };
}

function run<K extends keyof MemoryTools>(
  tools: MemoryTools,
  name: K,
  // biome-ignore lint/suspicious/noExplicitAny: test driver — args vary per tool
  args: any,
): Promise<ToolResult> {
  const t = tools[name] as unknown as {
    execute: (a: unknown, o: unknown) => Promise<ToolResult>;
  };
  return t.execute(args, { toolCallId: "t", messages: [] });
}

// Mirrors lib/db/queries/preferences.test.ts — an in-memory app.db with all
// migrations replayed, run inside a db context so ownedBy()/ownerId() resolve.
function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = resolve("lib/db/migrations/app");
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/--> statement-breakpoint/g, ";");
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema });
  const market = freshMarketDb();
  return { sqlite, db, marketDb: market.db, marketSqlite: market.sqlite };
}

function withFresh<T>(fn: () => T | Promise<T>): Promise<T> {
  const { sqlite, db, marketDb, marketSqlite } = freshDb();
  return runWithDbContext(
    { appDb: db, appSqlite: sqlite, marketDb, marketSqlite, isDemo: true, sessionId: "test" },
    fn,
  ) as Promise<T>;
}

// The chat UI (ChatScreen MemoryEventLine) turns a tool's `memoryEvent` field
// into a status line, so the shape is a contract worth pinning.
describe("memory tools — memoryEvent (UI contract)", () => {
  it("save emits a save event with the captured content", async () => {
    await withFresh(async () => {
      const tools = createMemoryTools({ userId: null });
      const out = await run(tools, "save_preference", {
        category: "response_style",
        content: "be concise",
      });
      expect(out.ok).toBe(true);
      expect(out.memoryEvent).toMatchObject({
        kind: "save",
        category: "response_style",
        content: "be concise",
      });
      expect(typeof out.memoryEvent?.id).toBe("number");
    });
  });

  it("update emits an update event carrying the superseded oldId", async () => {
    await withFresh(async () => {
      const tools = createMemoryTools({ userId: null });
      const saved = await run(tools, "save_preference", {
        category: "profile",
        content: "retirement age 60",
      });
      const out = await run(tools, "update_preference", {
        id_or_substring: String(saved.memoryEvent?.id),
        new_content: "retirement age 62",
      });
      expect(out.ok).toBe(true);
      expect(out.memoryEvent).toMatchObject({ kind: "update", oldId: saved.memoryEvent?.id });
      expect(out.memoryEvent?.id).not.toBe(saved.memoryEvent?.id);
    });
  });

  it("forget emits a forget event", async () => {
    await withFresh(async () => {
      const tools = createMemoryTools({ userId: null });
      const saved = await run(tools, "save_preference", {
        category: "fact",
        content: "likes index funds",
      });
      const out = await run(tools, "forget_preference", {
        id_or_substring: String(saved.memoryEvent?.id),
      });
      expect(out.memoryEvent).toMatchObject({ kind: "forget", id: saved.memoryEvent?.id });
    });
  });

  it("confirm emits a confirm event reinforcing an existing note", async () => {
    await withFresh(async () => {
      const tools = createMemoryTools({ userId: null });
      const saved = await run(tools, "save_preference", {
        category: "finance_context",
        content: "no crypto",
      });
      const out = await run(tools, "confirm_preference", {
        id_or_substring: String(saved.memoryEvent?.id),
      });
      expect(out.memoryEvent).toMatchObject({ kind: "confirm", id: saved.memoryEvent?.id });
    });
  });
});
