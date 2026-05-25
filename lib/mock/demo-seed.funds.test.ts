// Tests for the fund catalog portion of the demo seed.
//
// Verifies that seedDemoData() populates fund_catalog + fund_fees so the
// Select UI has something to show in demo mode, and that the data satisfies
// the findFunds() cheapest-first contract.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../db/context";
import { findFunds, getCheaperAlternatives } from "../db/queries/funds";
import * as schema from "../db/schema";
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

describe("demo-seed fund catalog", () => {
  it("seeds at least one fund per asset class", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const counts = sqlite
      .prepare(
        "SELECT asset_class, COUNT(*) AS n FROM fund_catalog GROUP BY asset_class ORDER BY asset_class",
      )
      .all() as Array<{ asset_class: string; n: number }>;

    const classes = counts.map((r) => r.asset_class);
    expect(classes).toContain("equity");
    expect(classes).toContain("bond");
    expect(classes).toContain("alternative");
    expect(classes).toContain("cash");

    for (const row of counts) {
      expect(row.n).toBeGreaterThanOrEqual(1);
    }
  });

  it("seeds TER (total_expense) fee rows for every fund", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const total = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM fund_catalog WHERE status = 'active'").get() as {
        n: number;
      }
    ).n;

    const withTer = (
      sqlite
        .prepare(
          "SELECT COUNT(DISTINCT proj_id) AS n FROM fund_fees WHERE fee_type = 'total_expense' AND period_end IS NULL",
        )
        .get() as { n: number }
    ).n;

    expect(total).toBeGreaterThan(0);
    // Every demo fund should have an open-ended TER row so findFunds can rank them.
    expect(withTer).toBe(total);
  });

  it("findFunds returns results sorted cheapest-first from demo seed", () => {
    const { sqlite, db } = freshDb();
    runWithDbContext({ db, sqlite, isDemo: true, sessionId: "test", userId: null }, () => {
      seedDemoData(db);
      const funds = findFunds({ assetClass: "equity" });
      expect(funds.length).toBeGreaterThan(0);
      // All equity funds should have TER data from the seed.
      expect(funds.every((f) => f.ter != null)).toBe(true);
      // Sorted cheapest-first.
      for (let i = 1; i < funds.length; i++) {
        const prev = funds[i - 1].ter ?? Number.POSITIVE_INFINITY;
        const curr = funds[i].ter ?? Number.POSITIVE_INFINITY;
        expect(prev).toBeLessThanOrEqual(curr);
      }
    });
  });

  it("getCheaperAlternatives finds peers from demo seed equity funds", () => {
    const { sqlite, db } = freshDb();
    runWithDbContext({ db, sqlite, isDemo: true, sessionId: "test", userId: null }, () => {
      seedDemoData(db);
      // Find the most expensive equity fund and check that cheaper ones exist.
      const allEquity = findFunds({ assetClass: "equity" });
      const mostExpensive = allEquity[allEquity.length - 1];
      if (mostExpensive && mostExpensive.ter != null && allEquity.length > 1) {
        const alts = getCheaperAlternatives(mostExpensive.projId);
        // There should be at least one cheaper equity fund in the seed data.
        expect(alts.length).toBeGreaterThan(0);
        // All alternatives must be strictly cheaper.
        for (const alt of alts) {
          const altTer = alt.ter ?? Number.POSITIVE_INFINITY;
          const refTer = mostExpensive.ter ?? 0;
          expect(altTer).toBeLessThan(refTer);
        }
      }
    });
  });

  it("all seeded funds have active status and required fields", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const rows = sqlite
      .prepare("SELECT proj_id, abbr_name, english_name, amc_name, status FROM fund_catalog")
      .all() as Array<{
      proj_id: string;
      abbr_name: string | null;
      english_name: string | null;
      amc_name: string | null;
      status: string;
    }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // All demo funds should be active so they appear in findFunds() by default.
      expect(row.status).toBe("active");
      // Each fund needs an abbr_name so the UI can display a ticker.
      expect(row.abbr_name).toBeTruthy();
    }
  });

  it("TER values are positive and plausible (< 5%)", () => {
    const { sqlite, db } = freshDb();
    seedDemoData(db);

    const rows = sqlite
      .prepare(
        "SELECT actual_rate_pct FROM fund_fees WHERE fee_type = 'total_expense' AND period_end IS NULL",
      )
      .all() as Array<{ actual_rate_pct: number }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actual_rate_pct).toBeGreaterThan(0);
      expect(row.actual_rate_pct).toBeLessThan(5);
    }
  });
});
