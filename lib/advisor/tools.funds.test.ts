// Tests for the fee-aware advisor tools: find_funds and find_cheaper_alternatives.
//
// These tools are the consumer side of the fund catalog — they wrap findFunds()
// and getCheaperAlternatives() with AI-SDK tool shapes and product-voice copy.
// Tests verify the tool output shapes, fee-first framing, and edge-case handling.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../db/context";
import { upsertFund, upsertFundFees } from "../db/queries/funds";
import * as schema from "../db/schema";
import { createAdvisorTools } from "./tools";

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
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function withFresh<T>(fn: () => T | Promise<T>): Promise<T> {
  const { sqlite, db } = freshDb();
  return runWithDbContext(
    { db, sqlite, isDemo: true, sessionId: "test", userId: null },
    fn,
  ) as Promise<T>;
}

// Invoke a tool's execute directly (same pattern as the main tools.test.ts).
type Exec<T> = (args: T, opts?: never) => Promise<unknown>;
function run<T>(tool: { execute?: unknown }, args: T): Promise<unknown> {
  return (tool.execute as Exec<T>)(args);
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function seedFund(
  projId: string,
  {
    assetClass = "equity",
    ter,
    abbrName,
  }: { assetClass?: string; ter?: number; abbrName?: string } = {},
) {
  upsertFund({
    projId,
    abbrName: abbrName ?? projId,
    englishName: `${projId} Fund`,
    amcName: "Demo AMC",
    fundType: assetClass === "bond" ? "Fixed Income" : "Foreign Investment Fund",
    assetClass,
    status: "active",
  });
  if (ter != null) {
    upsertFundFees([
      {
        projId,
        fundClassName: "A",
        feeType: "total_expense",
        feeTypeRaw: "Total Fee and Expense",
        actualRatePct: ter,
        rateCeilingPct: ter + 0.5,
        periodStart: "2026-01-01",
        periodEnd: null,
      },
    ]);
  }
}

// ─── find_funds ───────────────────────────────────────────────────────────────

describe("advisor tools — find_funds", () => {
  it("returns funds sorted cheapest-first with TER in output", async () => {
    const result = (await withFresh(async () => {
      seedFund("CHEAP", { ter: 0.3 });
      seedFund("PRICEY", { ter: 1.5 });
      seedFund("MID", { ter: 0.8 });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, { assetClass: "equity" });
    })) as {
      ok: boolean;
      count: number;
      funds: { abbr: string; terPct: number | null }[];
      cheapestAbbr: string;
      message: string;
    };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    // cheapest-first ordering
    expect(result.funds[0].abbr).toBe("CHEAP");
    expect(result.funds[1].abbr).toBe("MID");
    expect(result.funds[2].abbr).toBe("PRICEY");
    // TER values present
    expect(result.funds[0].terPct).toBe(0.3);
    // cheapestAbbr convenience field
    expect(result.cheapestAbbr).toBe("CHEAP");
  });

  it("puts no-TER funds last in the ranked list", async () => {
    const result = (await withFresh(async () => {
      seedFund("WITHFEE", { ter: 0.9 });
      seedFund("NOFEE"); // no TER data
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, { assetClass: "equity" });
    })) as { funds: { abbr: string; terPct: number | null }[] };

    expect(result.funds[0].abbr).toBe("WITHFEE");
    expect(result.funds[1].abbr).toBe("NOFEE");
    expect(result.funds[1].terPct).toBeNull();
  });

  it("filters by assetClass correctly", async () => {
    const result = (await withFresh(async () => {
      seedFund("EQ1", { assetClass: "equity", ter: 0.5 });
      seedFund("BD1", { assetClass: "bond", ter: 0.3 });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, { assetClass: "bond" });
    })) as { count: number; funds: { abbr: string }[] };

    expect(result.count).toBe(1);
    expect(result.funds[0].abbr).toBe("BD1");
  });

  it("returns empty result gracefully with helpful message", async () => {
    const result = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, { assetClass: "cash" });
    })) as { ok: boolean; count: number; funds: unknown[]; message: string };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.funds).toHaveLength(0);
    expect(result.message).toMatch(/no funds found/i);
  });

  it("supports free-text query search against fund name", async () => {
    const result = (await withFresh(async () => {
      upsertFund({
        projId: "SPFUND",
        abbrName: "SCBSP500",
        englishName: "SCB S&P 500 Index Fund",
        assetClass: "equity",
        fundType: "Foreign Investment Fund",
        status: "active",
      });
      upsertFundFees([
        {
          projId: "SPFUND",
          fundClassName: "A",
          feeType: "total_expense",
          feeTypeRaw: "Total Fee and Expense",
          actualRatePct: 0.5,
          rateCeilingPct: 0.6,
          periodStart: "2026-01-01",
          periodEnd: null,
        },
      ]);
      upsertFund({
        projId: "BONDFUND",
        abbrName: "K-FIXED",
        englishName: "Kasikorn Fixed Income",
        assetClass: "bond",
        fundType: "Fixed Income Fund",
        status: "active",
      });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, { query: "S&P 500" });
    })) as { count: number; funds: { abbr: string }[] };

    expect(result.count).toBe(1);
    expect(result.funds[0].abbr).toBe("SCBSP500");
  });

  it("output includes abbr, englishName, amc, fundType, terLabel fields", async () => {
    const result = (await withFresh(async () => {
      upsertFund({
        projId: "F99",
        abbrName: "TESTFUND",
        englishName: "Test Index Fund",
        amcName: "Test AMC",
        fundType: "Foreign Investment Fund",
        assetClass: "equity",
        status: "active",
      });
      upsertFundFees([
        {
          projId: "F99",
          fundClassName: "A",
          feeType: "total_expense",
          feeTypeRaw: "Total Fee and Expense",
          actualRatePct: 0.45,
          rateCeilingPct: 0.6,
          periodStart: "2026-01-01",
          periodEnd: null,
        },
      ]);
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_funds, {});
    })) as {
      funds: {
        abbr: string;
        englishName: string | null;
        amc: string | null;
        fundType: string | null;
        terLabel: string;
      }[];
    };

    expect(result.funds).toHaveLength(1);
    const f = result.funds[0];
    expect(f.abbr).toBe("TESTFUND");
    expect(f.englishName).toBe("Test Index Fund");
    expect(f.amc).toBe("Test AMC");
    expect(f.fundType).toBe("Foreign Investment Fund");
    expect(f.terLabel).toBe("0.45% p.a.");
  });
});

// ─── find_cheaper_alternatives ───────────────────────────────────────────────

describe("advisor tools — find_cheaper_alternatives", () => {
  it("returns cheaper peers with correct TER values sorted cheapest-first", async () => {
    const result = (await withFresh(async () => {
      seedFund("HELD", { assetClass: "equity", ter: 0.9 });
      seedFund("CHEAPER", { assetClass: "equity", ter: 0.5 });
      seedFund("CHEAPEST", { assetClass: "equity", ter: 0.25 });
      seedFund("DEARER", { assetClass: "equity", ter: 1.2 });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_cheaper_alternatives, { projId: "HELD" });
    })) as {
      ok: boolean;
      count: number;
      alternatives: { abbr: string; terPct: number | null }[];
      referenceAbbr: string;
      cheapestAlternativeAbbr: string;
      message: string;
    };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    // Cheapest-first
    expect(result.alternatives[0].abbr).toBe("CHEAPEST");
    expect(result.alternatives[1].abbr).toBe("CHEAPER");
    // DEARER excluded
    expect(result.alternatives.map((a) => a.abbr)).not.toContain("DEARER");
    expect(result.cheapestAlternativeAbbr).toBe("CHEAPEST");
    // Message mentions the fee opportunity
    expect(result.message).toMatch(/cheaper/i);
  });

  it("resolves fundAbbr to projId via getFundsByAbbr", async () => {
    const result = (await withFresh(async () => {
      seedFund("HELD_ID", { assetClass: "equity", ter: 0.8, abbrName: "MY-FUND" });
      seedFund("ALT_ID", { assetClass: "equity", ter: 0.3 });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_cheaper_alternatives, { fundAbbr: "MY-FUND" });
    })) as { ok: boolean; count: number; referenceAbbr: string };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.referenceAbbr).toBe("MY-FUND");
  });

  it("returns empty result when abbr not found in catalog", async () => {
    const result = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_cheaper_alternatives, { fundAbbr: "NONEXISTENT" });
    })) as { ok: boolean; count: number; message: string };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.message).toMatch(/could not find/i);
  });

  it("returns empty result when held fund is already the cheapest", async () => {
    const result = (await withFresh(async () => {
      seedFund("CHEAPEST_HELD", { assetClass: "equity", ter: 0.1 });
      seedFund("DEARER_OTHER", { assetClass: "equity", ter: 0.9 });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_cheaper_alternatives, { projId: "CHEAPEST_HELD" });
    })) as { ok: boolean; count: number; message: string };

    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(result.message).toMatch(/cheaper alternatives/i);
  });

  it("returns error shape when neither fundAbbr nor projId is provided", async () => {
    const result = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      return run(tools.find_cheaper_alternatives, {});
    })) as { ok: boolean; message: string };

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/fundAbbr or projId/i);
  });
});
