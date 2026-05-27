import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupIfStale } from "./backup";
import * as appSchema from "./schema/app";
import * as marketSchema from "./schema/market";

// The database is split along a lifecycle boundary:
//   - app.db    — system of record (accounts, buckets, holdings, plans, chat,
//                 preferences). Precious; backed up nightly.
//   - market.db — regenerable market data (fund catalog, fees, NAV/quote cache,
//                 feeder look-through). Rebuildable from upstream; NOT backed up.
const APP_DB_PATH = resolve(process.env.DB_PATH ?? "data/app.db");
const MARKET_DB_PATH = resolve(process.env.MARKET_DB_PATH ?? "data/market.db");
const APP_MIGRATIONS_DIR = resolve("lib/db/migrations/app");
const MARKET_MIGRATIONS_DIR = resolve("lib/db/migrations/market");

// `next build` collects page data for routes in parallel worker processes, each
// of which imports this module and would run `migrate()` against the same fresh
// data/*.db — racing on CREATE TABLE ("table `buckets` already exists"). The
// globalThis pin only dedupes within one process, not across build workers. At
// build time routes are imported for static analysis only (never served), so we
// skip migrations + the backup entirely; they run normally at server startup.
const BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";

// Next.js hot-reload reimports server modules — pin the connections on
// globalThis so we don't leak SQLite file handles across reloads in dev.
const globalForDb = globalThis as unknown as {
  __macrotideAppSqlite?: Database.Database;
  __macrotideAppDb?: ReturnType<typeof drizzle<typeof appSchema>>;
  __macrotideMarketSqlite?: Database.Database;
  __macrotideMarketDb?: ReturnType<typeof drizzle<typeof marketSchema>>;
};

function open(path: string): Database.Database {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  return sqlite;
}

function initApp() {
  const sqlite = open(APP_DB_PATH);
  const db = drizzle(sqlite, { schema: appSchema });

  if (existsSync(APP_MIGRATIONS_DIR) && !BUILD_PHASE) {
    migrate(db, { migrationsFolder: APP_MIGRATIONS_DIR });
  }

  // Back up app.db only — it is the precious system of record. market.db is
  // regenerable from upstream and is deliberately not backed up.
  if (!BUILD_PHASE) {
    backupIfStale(sqlite).catch((err) => {
      console.error("[macrotide] backup failed:", err);
    });
  }

  return { sqlite, db };
}

function initMarket() {
  const sqlite = open(MARKET_DB_PATH);
  const db = drizzle(sqlite, { schema: marketSchema });

  if (existsSync(MARKET_MIGRATIONS_DIR) && !BUILD_PHASE) {
    migrate(db, { migrationsFolder: MARKET_MIGRATIONS_DIR });
  }

  return { sqlite, db };
}

if (!globalForDb.__macrotideAppDb) {
  const { sqlite, db } = initApp();
  globalForDb.__macrotideAppSqlite = sqlite;
  globalForDb.__macrotideAppDb = db;
}

if (!globalForDb.__macrotideMarketDb) {
  const { sqlite, db } = initMarket();
  globalForDb.__macrotideMarketSqlite = sqlite;
  globalForDb.__macrotideMarketDb = db;
}

export const appSqlite = globalForDb.__macrotideAppSqlite as Database.Database;
export const appDb = globalForDb.__macrotideAppDb as ReturnType<typeof drizzle<typeof appSchema>>;
export const marketSqlite = globalForDb.__macrotideMarketSqlite as Database.Database;
export const marketDb = globalForDb.__macrotideMarketDb as ReturnType<
  typeof drizzle<typeof marketSchema>
>;

// Back-compat aliases — `ownerDb`/`ownerSqlite` historically meant "the app's
// own (non-demo) database". They now point at app.db. Prefer the typed
// accessors from `./context` (getAppDb / getMarketDb) in new code so demo
// sessions are honored.
export const ownerDb = appDb;
export const ownerSqlite = appSqlite;
