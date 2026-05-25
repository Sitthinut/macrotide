import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import { PORTFOLIOS } from "./data";
import { seedDemoData } from "./demo-seed";

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

describe("seedDemoData synthetic NAV history", () => {
  it("inserts >100 nav_history rows per seeded holding ticker", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const uniqueTickers = Array.from(
      new Set(PORTFOLIOS.flatMap((p) => p.holdings.map((h) => h.ticker))),
    );

    const counts = sqlite
      .prepare(
        "SELECT ticker, COUNT(*) AS n FROM nav_history WHERE ticker LIKE 'thai_mutual_fund:%' GROUP BY ticker",
      )
      .all() as Array<{ ticker: string; n: number }>;

    expect(counts.length).toBe(uniqueTickers.length);
    for (const row of counts) {
      // ~180 calendar days, weekends excluded → ~128 business days.
      // Allow some headroom for edge weekdays.
      expect(row.n).toBeGreaterThan(100);
      expect(row.n).toBeLessThanOrEqual(180);
    }
  });

  it("uses combined source:ticker form for all cache keys", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const navKeys = sqlite.prepare("SELECT DISTINCT ticker FROM nav_history").all() as Array<{
      ticker: string;
    }>;
    const quoteKeys = sqlite.prepare("SELECT ticker FROM fund_quotes").all() as Array<{
      ticker: string;
    }>;

    for (const { ticker } of [...navKeys, ...quoteKeys]) {
      // Holdings seed under thai_mutual_fund:; the index cache warms under yahoo:.
      expect(ticker).toMatch(/^(thai_mutual_fund|yahoo):.+/);
    }

    // Sanity: a known holding's combined key is present in both tables.
    const expectedKey = "thai_mutual_fund:K-FIXED-A";
    expect(navKeys.some((r) => r.ticker === expectedKey)).toBe(true);
    expect(quoteKeys.some((r) => r.ticker === expectedKey)).toBe(true);
  });

  it("warms the Yahoo index cache so demo Markets shows real data, not the unavailable banner", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    for (const symbol of ["^SET.BK", "^GSPC", "^IXIC", "^N225", "THB=X"]) {
      const key = `yahoo:${symbol}`;
      const quote = sqlite
        .prepare("SELECT nav, updated_at FROM fund_quotes WHERE ticker = ?")
        .get(key) as { nav: number; updated_at: string } | undefined;
      expect(quote, `${key} should have a cached quote`).toBeDefined();
      expect(quote?.nav).toBeGreaterThan(0);

      const navCount = (
        sqlite.prepare("SELECT COUNT(*) AS n FROM nav_history WHERE ticker = ?").get(key) as {
          n: number;
        }
      ).n;
      expect(navCount, `${key} should have a NAV series`).toBeGreaterThan(100);
    }
  });

  it("produces only finite, positive NAVs with no >50% daily jumps", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const rows = sqlite
      .prepare("SELECT ticker, date, nav FROM nav_history ORDER BY ticker, date")
      .all() as Array<{ ticker: string; date: string; nav: number }>;

    expect(rows.length).toBeGreaterThan(0);

    let prev: { ticker: string; nav: number } | null = null;
    for (const r of rows) {
      expect(Number.isFinite(r.nav)).toBe(true);
      expect(r.nav).toBeGreaterThan(0);
      expect(Number.isNaN(r.nav)).toBe(false);

      if (prev && prev.ticker === r.ticker) {
        const pct = Math.abs((r.nav - prev.nav) / prev.nav);
        expect(pct).toBeLessThan(0.5);
      }
      prev = { ticker: r.ticker, nav: r.nav };
    }
  });

  it("makes fund_quotes.nav match the last nav_history row per ticker", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const quotes = sqlite.prepare("SELECT ticker, nav FROM fund_quotes").all() as Array<{
      ticker: string;
      nav: number;
    }>;

    for (const q of quotes) {
      const latest = sqlite
        .prepare("SELECT nav FROM nav_history WHERE ticker = ? ORDER BY date DESC LIMIT 1")
        .get(q.ticker) as { nav: number } | undefined;
      expect(latest).toBeDefined();
      // Stored to 6 decimal places — exact match expected.
      expect(latest?.nav).toBeCloseTo(q.nav, 5);
    }
  });

  it("is deterministic across re-seeds (same ticker → same series)", () => {
    const a = freshDb();
    seedDemoData(a.db);
    const b = freshDb();
    seedDemoData(b.db);

    const fromA = a.sqlite
      .prepare(
        "SELECT date, nav FROM nav_history WHERE ticker = 'thai_mutual_fund:K-FIXED-A' ORDER BY date",
      )
      .all();
    const fromB = b.sqlite
      .prepare(
        "SELECT date, nav FROM nav_history WHERE ticker = 'thai_mutual_fund:K-FIXED-A' ORDER BY date",
      )
      .all();

    expect(fromA).toEqual(fromB);
  });

  it("skips weekends in the generated series", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const dates = sqlite
      .prepare("SELECT DISTINCT date FROM nav_history WHERE ticker = 'thai_mutual_fund:K-FIXED-A'")
      .all() as Array<{ date: string }>;

    for (const { date } of dates) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      expect(day).not.toBe(0); // Sunday
      expect(day).not.toBe(6); // Saturday
    }
  });
});
