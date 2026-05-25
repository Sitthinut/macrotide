// Fund-catalog query contract. The subtle parts the consumers depend on:
//   1. getCurrentFees picks the open period (periodEnd NULL), else newest start.
//   2. getCurrentTer reads the Total Fee and Expense actual rate.
//   3. findFunds ranks cheapest-first and sorts funds with no TER last.
//   4. getCheaperAlternatives returns only strictly-cheaper same-class peers.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { type DbContext, runWithDbContext } from "../context";
import * as schema from "../schema";
import {
  type FundFeeInsert,
  type FundInsert,
  findFunds,
  getCheaperAlternatives,
  getCurrentFees,
  getCurrentTer,
  upsertFund,
  upsertFundFees,
} from "./funds";

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

function withDb(fn: () => void) {
  const { sqlite, db } = freshDb();
  const ctx: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: null };
  runWithDbContext(ctx, fn);
}

function fund(projId: string, over: Partial<FundInsert> = {}): FundInsert {
  return {
    projId,
    abbrName: projId,
    englishName: projId,
    assetClass: "equity",
    fundType: "Equity",
    status: "active",
    ...over,
  };
}

function ter(projId: string, actual: number, over: Partial<FundFeeInsert> = {}): FundFeeInsert {
  return {
    projId,
    fundClassName: "A",
    feeType: "total_expense",
    feeTypeRaw: "ค่าธรรมเนียมและค่าใช้จ่ายรวมทั้งหมด (Total Fee and Expense)",
    actualRatePct: actual,
    rateCeilingPct: actual + 1,
    periodStart: "2026-05-01",
    periodEnd: null,
    ...over,
  };
}

describe("getCurrentFees / getCurrentTer", () => {
  it("prefers the open period over a newer closed one", () => {
    withDb(() => {
      upsertFund(fund("F1"));
      upsertFundFees([
        ter("F1", 0.49, { periodStart: "2026-05-01", periodEnd: null }),
        ter("F1", 0.99, { periodStart: "2026-06-01", periodEnd: "2026-06-30" }),
      ]);
      expect(getCurrentTer("F1")).toBe(0.49);
    });
  });

  it("falls back to the newest closed period when none are open", () => {
    withDb(() => {
      upsertFund(fund("F2"));
      upsertFundFees([
        ter("F2", 0.8, { periodStart: "2026-01-01", periodEnd: "2026-03-31" }),
        ter("F2", 0.6, { periodStart: "2026-04-01", periodEnd: "2026-06-30" }),
      ]);
      expect(getCurrentTer("F2")).toBe(0.6);
    });
  });

  it("falls back to the ceiling rate when actual is missing", () => {
    withDb(() => {
      upsertFund(fund("F3"));
      upsertFundFees([ter("F3", 0, { actualRatePct: null, rateCeilingPct: 1.5 })]);
      expect(getCurrentTer("F3")).toBe(1.5);
    });
  });

  it("returns null when the fund has no TER row", () => {
    withDb(() => {
      upsertFund(fund("F4"));
      expect(getCurrentTer("F4")).toBeNull();
      expect(getCurrentFees("F4").total_expense).toBeUndefined();
    });
  });
});

describe("findFunds", () => {
  it("ranks cheapest-first and sorts no-TER funds last", () => {
    withDb(() => {
      upsertFund(fund("CHEAP"));
      upsertFund(fund("PRICEY"));
      upsertFund(fund("NOFEE"));
      upsertFundFees([ter("CHEAP", 0.2), ter("PRICEY", 1.1)]);
      // NOFEE has no fee rows.
      const ranked = findFunds({ assetClass: "equity" }).map((f) => f.projId);
      expect(ranked).toEqual(["CHEAP", "PRICEY", "NOFEE"]);
    });
  });

  it("filters by asset class and excludes inactive funds by default", () => {
    withDb(() => {
      upsertFund(fund("EQ"));
      upsertFund(fund("BD", { assetClass: "bond" }));
      upsertFund(fund("DEAD", { status: "inactive" }));
      upsertFundFees([ter("EQ", 0.3), ter("BD", 0.1), ter("DEAD", 0.05)]);
      const eq = findFunds({ assetClass: "equity" }).map((f) => f.projId);
      expect(eq).toEqual(["EQ"]); // not BD (bond), not DEAD (inactive)
    });
  });

  it("indexOnly filters to PN and PM management styles", () => {
    withDb(() => {
      upsertFund(fund("ACTIVE", { managementStyle: "AM" }));
      upsertFund(fund("PASSIVE_PN", { managementStyle: "PN" }));
      upsertFund(fund("PASSIVE_PM", { managementStyle: "PM" }));
      upsertFund(fund("SYSTEMATIC", { managementStyle: "SM" }));
      upsertFundFees([
        ter("ACTIVE", 1.2),
        ter("PASSIVE_PN", 0.3),
        ter("PASSIVE_PM", 0.4),
        ter("SYSTEMATIC", 0.8),
      ]);
      const ids = findFunds({ indexOnly: true }).map((f) => f.projId);
      expect(ids).toContain("PASSIVE_PN");
      expect(ids).toContain("PASSIVE_PM");
      expect(ids).not.toContain("ACTIVE");
      expect(ids).not.toContain("SYSTEMATIC");
    });
  });

  it("taxIncentive filter restricts to the given wrapper", () => {
    withDb(() => {
      upsertFund(fund("SSF1", { taxIncentiveType: "SSF" }));
      upsertFund(fund("RMF1", { taxIncentiveType: "RMF" }));
      upsertFund(fund("ESGT1", { taxIncentiveType: "ThaiESG" }));
      upsertFund(fund("PLAIN"));
      upsertFundFees([ter("SSF1", 0.5), ter("RMF1", 0.6), ter("ESGT1", 0.55), ter("PLAIN", 0.4)]);
      const ssf = findFunds({ taxIncentive: "SSF" }).map((f) => f.projId);
      expect(ssf).toEqual(["SSF1"]);

      const esgt = findFunds({ taxIncentive: "ThaiESG" }).map((f) => f.projId);
      expect(esgt).toEqual(["ESGT1"]);
    });
  });

  it("region filter restricts to the given geographic mandate", () => {
    withDb(() => {
      upsertFund(fund("FOREIGN", { investRegion: "foreign" }));
      upsertFund(fund("DOMESTIC", { investRegion: "domestic" }));
      upsertFund(fund("MIXED", { investRegion: "mixed" }));
      upsertFundFees([ter("FOREIGN", 0.5), ter("DOMESTIC", 0.4), ter("MIXED", 0.6)]);
      const foreign = findFunds({ region: "foreign" }).map((f) => f.projId);
      expect(foreign).toEqual(["FOREIGN"]);

      const domestic = findFunds({ region: "domestic" }).map((f) => f.projId);
      expect(domestic).toEqual(["DOMESTIC"]);
    });
  });

  it("excludeFixedTerm (default true) removes fixed-term funds", () => {
    withDb(() => {
      upsertFund(fund("ONGOING", { isFixedTerm: false }));
      upsertFund(fund("FIXTERM", { isFixedTerm: true }));
      upsertFundFees([ter("ONGOING", 0.5), ter("FIXTERM", 0.3)]);
      // default: excludeFixedTerm=true
      const defaultResult = findFunds({}).map((f) => f.projId);
      expect(defaultResult).toContain("ONGOING");
      expect(defaultResult).not.toContain("FIXTERM");

      // opt-in to include fixed-term
      const withFixed = findFunds({ excludeFixedTerm: false }).map((f) => f.projId);
      expect(withFixed).toContain("ONGOING");
      expect(withFixed).toContain("FIXTERM");
    });
  });

  it("can combine indexOnly + taxIncentive + region filters", () => {
    withDb(() => {
      // The target: PN index + SSF + foreign
      upsertFund(
        fund("MATCH", {
          managementStyle: "PN",
          taxIncentiveType: "SSF",
          investRegion: "foreign",
        }),
      );
      // Non-matching variations
      upsertFund(fund("NOIDX", { taxIncentiveType: "SSF", investRegion: "foreign" }));
      upsertFund(fund("NOTAX", { managementStyle: "PN", investRegion: "foreign" }));
      upsertFund(
        fund("WRONGREG", {
          managementStyle: "PN",
          taxIncentiveType: "SSF",
          investRegion: "domestic",
        }),
      );
      upsertFundFees([
        ter("MATCH", 0.5),
        ter("NOIDX", 0.4),
        ter("NOTAX", 0.45),
        ter("WRONGREG", 0.55),
      ]);
      const result = findFunds({
        indexOnly: true,
        taxIncentive: "SSF",
        region: "foreign",
      }).map((f) => f.projId);
      expect(result).toEqual(["MATCH"]);
    });
  });
});

describe("getCheaperAlternatives", () => {
  it("returns only strictly cheaper same-class peers, cheapest first", () => {
    withDb(() => {
      upsertFund(fund("HELD"));
      upsertFund(fund("CHEAPER"));
      upsertFund(fund("CHEAPEST"));
      upsertFund(fund("DEARER"));
      upsertFundFees([
        ter("HELD", 0.8),
        ter("CHEAPER", 0.5),
        ter("CHEAPEST", 0.2),
        ter("DEARER", 1.0),
      ]);
      const alts = getCheaperAlternatives("HELD").map((f) => f.projId);
      expect(alts).toEqual(["CHEAPEST", "CHEAPER"]);
    });
  });

  it("returns nothing when the held fund has no TER to compare", () => {
    withDb(() => {
      upsertFund(fund("HELD2"));
      upsertFund(fund("OTHER", {}));
      upsertFundFees([ter("OTHER", 0.1)]);
      expect(getCheaperAlternatives("HELD2")).toEqual([]);
    });
  });
});
