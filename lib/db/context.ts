import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import { ownerDb, ownerSqlite } from "./client";
import type * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export type DbContext = {
  db: Db;
  sqlite: Database.Database;
  /** Demo sessions get an isolated in-memory DB; mutations never touch the owner's data. */
  isDemo: boolean;
  /** Stable identifier for the active session (owner uses "owner"). */
  sessionId: string;
};

const storage = new AsyncLocalStorage<DbContext>();

export function runWithDbContext<T>(ctx: DbContext, fn: () => T | Promise<T>): T | Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Resolve the current request's DB. Outside a route handler (background jobs,
 * scripts, dev-server boot) we fall back to the owner singleton.
 */
export function getDbContext(): DbContext {
  const ctx = storage.getStore();
  if (ctx) return ctx;
  return { db: ownerDb, sqlite: ownerSqlite, isDemo: false, sessionId: "owner" };
}

export function getDb(): Db {
  return getDbContext().db;
}

export function isDemoRequest(): boolean {
  return getDbContext().isDemo;
}
