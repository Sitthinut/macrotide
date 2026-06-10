import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { closeStaleSessions } from "../../jobs/close-stale-sessions";
import { getDb, runWithDbContext } from "../context";
import * as schema from "../schema";
import { chatThreads } from "../schema";
import {
  appendMessage,
  archiveThread,
  createThread,
  findIdleThreads,
  getThread,
  listByStatus,
  listMessages,
  markIdle,
} from "./chat";

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

/** ISO timestamp `days` days before now. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
}

/** Create a thread and force its `updatedAt` (last-activity) to a past time. */
function threadAged(days: number): string {
  const t = createThread();
  getDb()
    .update(chatThreads)
    .set({ updatedAt: daysAgo(days) })
    .where(eq(chatThreads.id, t.id))
    .run();
  return t.id;
}

describe("session lifecycle queries", () => {
  it("createThread starts in 'active' with null archivedAt", () => {
    withFresh(() => {
      const t = createThread();
      expect(t.status).toBe("active");
      expect(t.archivedAt).toBeNull();
    });
  });

  it("markIdle flips status to 'idle' without setting archivedAt", () => {
    withFresh(() => {
      const t = createThread();
      const updated = markIdle(t.id);
      expect(updated?.status).toBe("idle");
      expect(updated?.archivedAt).toBeNull();
    });
  });

  it("archiveThread sets status 'archived' and stamps archivedAt", () => {
    withFresh(() => {
      const t = createThread();
      const updated = archiveThread(t.id);
      expect(updated?.status).toBe("archived");
      expect(updated?.archivedAt).toBeTruthy();
    });
  });

  it("listByStatus filters by lifecycle status and excludes trashed threads", () => {
    withFresh(() => {
      const a = createThread();
      const b = createThread();
      markIdle(b.id);
      // Trash an active thread — it should drop out of the active listing.
      const trashed = createThread();
      getDb()
        .update(chatThreads)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(chatThreads.id, trashed.id))
        .run();

      expect(listByStatus("active").map((r) => r.id)).toEqual([a.id]);
      expect(listByStatus("idle").map((r) => r.id)).toEqual([b.id]);
      expect(listByStatus("archived")).toHaveLength(0);
    });
  });

  it("findIdleThreads returns active threads older than the window, ignoring recent ones", () => {
    withFresh(() => {
      const old = threadAged(10);
      threadAged(2); // recent — excluded

      const idle = findIdleThreads(7);
      expect(idle.map((r) => r.id)).toEqual([old]);
    });
  });

  it("findIdleThreads boundary is inclusive at exactly N days", () => {
    withFresh(() => {
      // Exactly 7 days old: updatedAt == now-7d at insert; by query time a few
      // ms have elapsed so it sits just past the cutoff and is included.
      const exact = threadAged(7);
      const idle = findIdleThreads(7);
      expect(idle.map((r) => r.id)).toContain(exact);

      // Just inside the window (6 days) is excluded.
      const recent = threadAged(6);
      expect(findIdleThreads(7).map((r) => r.id)).not.toContain(recent);
    });
  });

  it("findIdleThreads ignores threads not in 'active' status", () => {
    withFresh(() => {
      const archived = threadAged(30);
      archiveThread(archived);
      expect(findIdleThreads(7)).toHaveLength(0);
    });
  });
});

describe("closeStaleSessions backstop", () => {
  // Stub closeSession so lifecycle assertions don't depend on a live model.
  // Mirrors the real contract: only an `active` thread closes (→ idle). The
  // real closeSession (extract-then-idle, idempotency, best-effort) is covered
  // in lib/memory/session-close.test.ts.
  const closeStub =
    (savedPerThread = 0) =>
    async (threadId: string) => {
      const before = getThread(threadId);
      if (before?.status !== "active") {
        return { threadId, closed: false as const, thread: before };
      }
      markIdle(threadId);
      return {
        threadId,
        closed: true as const,
        extraction: {
          threadId,
          summary: "",
          saved: Array.from({ length: savedPerThread }, (_, i) => ({
            id: i,
            category: "fact" as const,
            content: "x",
            confidence: 0.9,
            injected: true,
          })),
          provider: "stub",
        },
        thread: getThread(threadId),
      };
    };

  it("closes active threads idle longer than the window, leaving fresh ones active", async () => {
    await withFresh(async () => {
      const stale = threadAged(10);
      const fresh = threadAged(1);
      const result = await closeStaleSessions({ close: closeStub() });
      expect(result.closedThreadIds).toEqual([stale]);
      expect(getThread(stale)?.status).toBe("idle");
      expect(getThread(fresh)?.status).toBe("active");
    });
  });

  it("respects a custom idleDays option", async () => {
    await withFresh(async () => {
      const t = threadAged(3);
      expect((await closeStaleSessions({ idleDays: 7, close: closeStub() })).closedCount).toBe(0);
      expect((await closeStaleSessions({ idleDays: 2, close: closeStub() })).closedCount).toBe(1);
      expect(getThread(t)?.status).toBe("idle");
    });
  });

  it("is idempotent — a second run closes nothing", async () => {
    await withFresh(async () => {
      threadAged(10);
      expect((await closeStaleSessions({ close: closeStub() })).closedCount).toBe(1);
      expect((await closeStaleSessions({ close: closeStub() })).closedCount).toBe(0);
    });
  });

  it("aggregates extracted-fact counts across closed sessions", async () => {
    await withFresh(async () => {
      threadAged(10);
      threadAged(10);
      const result = await closeStaleSessions({ close: closeStub(2) });
      expect(result.closedCount).toBe(2);
      expect(result.extractedCount).toBe(4);
    });
  });
});

describe("appendMessage — cards payload round-trip", () => {
  it("persists propose_* card payloads and returns them from listMessages", () => {
    withFresh(() => {
      const t = createThread();
      const cards = {
        transactionsImport: {
          rows: [{ ticker: "VOO", units: 10, pricePerUnit: 400, amount: 4000 }],
          source: "Broker",
          note: "from a screenshot",
        },
      };
      appendMessage({ threadId: t.id, role: "user", content: "import" });
      appendMessage({ threadId: t.id, role: "assistant", content: "Drafted below.", cards });

      const rows = listMessages(t.id);
      const assistant = rows.find((r) => r.role === "assistant");
      expect(assistant?.cards).toBe(JSON.stringify(cards));
      expect(JSON.parse(assistant?.cards ?? "null")).toEqual(cards);
    });
  });

  it("stores NULL cards for a turn with no card payload", () => {
    withFresh(() => {
      const t = createThread();
      appendMessage({ threadId: t.id, role: "assistant", content: "just text" });
      const row = listMessages(t.id).find((r) => r.role === "assistant");
      expect(row?.cards).toBeNull();
    });
  });
});
