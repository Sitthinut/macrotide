import "server-only";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/require-user";
import { appDb, appSqlite, marketDb, marketSqlite } from "@/lib/db/client";
import { type DbContext, runWithDbContext } from "@/lib/db/context";
import { getOrCreateDemoSession } from "@/lib/db/demo";

export const DEMO_COOKIE = "macrotide_demo";

/**
 * Resolve a per-request DB context. An **authenticated session always wins**:
 * if a user is logged in we route to the owner app.db scoped to their id and
 * ignore any lingering `macrotide_demo` cookie. Only when there is NO
 * authenticated user AND a demo cookie is present do we route the app handle to
 * that session's isolated in-memory SQLite. Otherwise the owner singletons.
 *
 * The market handle (fund catalog + NAV/quote cache) is the SHARED real
 * market.db in every case — including demo, which uses it read-write like a real
 * user (reads + write-through cache fills; see lib/market/cache.ts), so a symbol
 * fetched once serves every later session. A demo session thus sees REAL market
 * data while its own buckets/holdings/plans stay isolated in its in-memory app.db.
 *
 * For owner requests we carry the authenticated user id on the context so
 * per-user query scoping (lib/db/queries/scope.ts) applies. `userId` is null in
 * single-owner / `AUTH_DISABLED` mode, which makes scoping collapse to the
 * legacy `user_id IS NULL` set — behavior is identical to single-owner mode.
 * Demo sessions are already isolated, so they stay `userId: null`.
 *
 * Wrap every route handler that touches the DB with this so demo sessions
 * remain isolated.
 */
export async function withDb<T>(fn: (ctx: DbContext) => T | Promise<T>): Promise<T> {
  // Resolve the user FIRST so an authenticated session takes precedence over a
  // stale demo cookie. A logged-in user must never be routed to demo data.
  const userId = await requireUser();
  let ctx: DbContext;
  if (userId) {
    ctx = {
      appDb,
      appSqlite,
      marketDb,
      marketSqlite,
      isDemo: false,
      sessionId: "owner",
      userId,
    };
  } else {
    // No authenticated user. Fall back to a demo session if the cookie is set,
    // otherwise the single-owner / AUTH_DISABLED owner context (userId: null).
    // Under AUTH_DISABLED there is no demo concept — a stale `macrotide_demo`
    // cookie must NOT hijack the local owner into an empty demo DB, so ignore it.
    const store = await cookies();
    // AUTH_DISABLED ⇒ no demo concept; ignore any stale cookie (matches
    // isAuthRequired() in lib/auth/session, inlined to avoid pulling the heavy
    // auth/db graph into this hot path).
    const authRequired = process.env.AUTH_DISABLED !== "1";
    const demoId = authRequired ? store.get(DEMO_COOKIE)?.value : undefined;
    if (demoId) {
      const session = getOrCreateDemoSession(demoId);
      ctx = {
        // Demo app.db is the session's isolated in-memory copy …
        appDb: session.db,
        appSqlite: session.sqlite,
        // … but market data is the shared real market.db, used read-write just
        // like a real user so demo benefits from (and warms) the same cache.
        marketDb,
        marketSqlite,
        isDemo: true,
        sessionId: demoId,
        userId: null,
      };
    } else {
      ctx = {
        appDb,
        appSqlite,
        marketDb,
        marketSqlite,
        isDemo: false,
        sessionId: "owner",
        userId: null,
      };
    }
  }

  return await runWithDbContext(ctx, async () => fn(ctx));
}
