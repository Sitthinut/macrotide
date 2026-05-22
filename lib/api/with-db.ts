import "server-only";
import { cookies } from "next/headers";
import { ownerDb, ownerSqlite } from "@/lib/db/client";
import { type DbContext, runWithDbContext } from "@/lib/db/context";
import { getOrCreateDemoSession } from "@/lib/db/demo";

export const DEMO_COOKIE = "macrotide_demo";

/**
 * Resolve a per-request DB context. If the request carries a `macrotide_demo`
 * cookie, we route reads/writes to that session's in-memory SQLite. Otherwise
 * the owner singleton is used.
 *
 * Wrap every route handler that touches `getDb()` with this so demo sessions
 * remain isolated.
 */
export async function withDb<T>(fn: (ctx: DbContext) => T | Promise<T>): Promise<T> {
  const store = await cookies();
  const demoId = store.get(DEMO_COOKIE)?.value;
  const ctx: DbContext = demoId
    ? (() => {
        const session = getOrCreateDemoSession(demoId);
        return {
          db: session.db,
          sqlite: session.sqlite,
          isDemo: true,
          sessionId: demoId,
        };
      })()
    : { db: ownerDb, sqlite: ownerSqlite, isDemo: false, sessionId: "owner" };

  return await runWithDbContext(ctx, async () => fn(ctx));
}
