import "server-only";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backupIfStale } from "./backup";
import * as schema from "./schema";

const DB_PATH = resolve(process.env.DB_PATH ?? "data/app.db");
const MIGRATIONS_DIR = resolve("lib/db/migrations");

// Next.js hot-reload reimports server modules — pin the connection on globalThis
// so we don't leak SQLite file handles across reloads in dev.
const globalForDb = globalThis as unknown as {
  __macrotideSqlite?: Database.Database;
  __macrotideDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function init() {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");

  const db = drizzle(sqlite, { schema });

  if (existsSync(MIGRATIONS_DIR)) {
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }

  backupIfStale(sqlite).catch((err) => {
    console.error("[macrotide] backup failed:", err);
  });

  return { sqlite, db };
}

if (!globalForDb.__macrotideDb) {
  const { sqlite, db } = init();
  globalForDb.__macrotideSqlite = sqlite;
  globalForDb.__macrotideDb = db;
}

export const ownerSqlite = globalForDb.__macrotideSqlite as Database.Database;
export const ownerDb = globalForDb.__macrotideDb as ReturnType<typeof drizzle<typeof schema>>;

// Back-compat aliases — query files used to import these as `db`/`sqlite`.
// Prefer `getDb()` from `./context` in new code so demo sessions are honored.
export const db = ownerDb;
export const sqlite = ownerSqlite;
