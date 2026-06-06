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
import { freshMarketDb } from "@/tests/db-helpers";
import { type DbContext, getMarketDb, runWithDbContext } from "../context";
import * as schema from "../schema";
import {
  catalogQuoteSource,
  type FundFeeInsert,
  type FundInsert,
  findFunds,
  findShareClasses,
  getCheaperAlternatives,
  getCurrentFees,
  getCurrentTer,
  upsertFund,
  upsertFundFees,
} from "./funds";
import { upsertShareClasses } from "./share-classes";

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
  const market = freshMarketDb();
  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    marketDb: market.db,
    marketSqlite: market.sqlite,
  };
}

function withDb(fn: () => void) {
  const { sqlite, db, marketDb, marketSqlite } = freshDb();
  const ctx: DbContext = {
    appDb: db,
    appSqlite: sqlite,
    marketDb,
    marketSqlite,
    isDemo: false,
    sessionId: "s",
    userId: null,
  };
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

  it("treats a zero actual rate as unactualized and falls back to the ceiling", () => {
    withDb(() => {
      // New/IPO funds report actual=0 (no realized expense yet) with a real
      // ceiling. The 0 is not a free fee — read through to the ceiling.
      upsertFund(fund("IPO"));
      upsertFundFees([ter("IPO", 0, { actualRatePct: 0, rateCeilingPct: 4.49 })]);
      expect(getCurrentTer("IPO")).toBe(4.49);
    });
  });

  it("returns null when both actual and ceiling are zero (no fee data, not free)", () => {
    withDb(() => {
      // A fully-dataless row (and the SEC `main` placeholder) is 0/0. There is no
      // genuinely-free Thai fund, so this is 'unknown', not a real 0%.
      upsertFund(fund("NODATA"));
      upsertFundFees([ter("NODATA", 0, { actualRatePct: 0, rateCeilingPct: 0 })]);
      expect(getCurrentTer("NODATA")).toBeNull();
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

describe("parent current_ter picks the retail class, not a fee-waived one", () => {
  // Real bug: a fund publishes one total_expense row per class in the same open
  // period. A fee-waived special class (e.g. restricted `-X` at 0.011%) would win
  // the period tie arbitrarily and brand the whole family with a fee no retail
  // buyer pays — floating it to #1 of the cheapest-first screener while the row
  // displays the retail class's real ~1.96%. The cache must follow the class the
  // screener leads with: retail over restricted, regardless of class-name order.
  it("prefers the retail class's TER over a cheaper restricted/institutional sibling", () => {
    withDb(() => {
      upsertFund(fund("APDI", { abbrName: "APDI" }));
      // Seed classes first so upsertFundFees' cache-update can join them.
      // Adversarial naming: the retail class sorts LAST alphabetically, so an
      // alphabetical tie-break alone would pick the wrong (cheap) class.
      upsertShareClasses([
        { projId: "APDI", className: "APDI-X", ticker: "APDI-X", investorType: "retail" },
        { projId: "APDI", className: "APDI-A", ticker: "APDI-A", investorType: "restricted" },
        { projId: "APDI", className: "APDI-I", ticker: "APDI-I", investorType: "institutional" },
      ]);
      upsertFundFees([
        ter("APDI", 1.964, { fundClassName: "APDI-X" }), // retail
        ter("APDI", 0.011, { fundClassName: "APDI-A" }), // restricted, fee-waived
        ter("APDI", 0.005, { fundClassName: "APDI-I" }), // institutional — must be ignored
      ]);
      // findFunds annotates ter from the fund_catalog.current_ter cache.
      expect(findFunds({}).find((f) => f.projId === "APDI")?.ter).toBe(1.964);
    });
  });

  it("ignores the SEC 'main' 0/0 placeholder and uses a real class's fee", () => {
    withDb(() => {
      // A multi-class fund (e.g. MUSPIN-H) reports an all-zero `main` placeholder
      // row beside the real, fee-bearing class rows. The cache must not inherit
      // the placeholder's 0 and brand the family "0.00%".
      upsertFund(fund("MULTI", { abbrName: "MULTI" }));
      upsertShareClasses([
        { projId: "MULTI", className: "MULTI-AC", ticker: "MULTI-AC", investorType: "retail" },
      ]);
      upsertFundFees([
        ter("MULTI", 0, { fundClassName: "main", actualRatePct: 0, rateCeilingPct: 0 }),
        ter("MULTI", 1.16, { fundClassName: "MULTI-AC" }), // the real retail class
      ]);
      expect(findFunds({}).find((f) => f.projId === "MULTI")?.ter).toBe(1.16);
    });
  });

  it("reads an unactualized retail class through to its ceiling, not 0", () => {
    withDb(() => {
      // New/IPO fund: the retail class reports actual=0 with a real ceiling.
      upsertFund(fund("FRESH", { abbrName: "FRESH" }));
      upsertShareClasses([
        { projId: "FRESH", className: "FRESH-A", ticker: "FRESH-A", investorType: "retail" },
      ]);
      upsertFundFees([
        ter("FRESH", 0, { fundClassName: "FRESH-A", actualRatePct: 0, rateCeilingPct: 4.49 }),
      ]);
      expect(findFunds({}).find((f) => f.projId === "FRESH")?.ter).toBe(4.49);
    });
  });

  it("falls back to a restricted class when no retail/unknown class has a fee", () => {
    withDb(() => {
      upsertFund(fund("PRIV", { abbrName: "PRIV" }));
      upsertShareClasses([
        { projId: "PRIV", className: "PRIV-R", ticker: "PRIV-R", investorType: "restricted" },
        { projId: "PRIV", className: "PRIV-I", ticker: "PRIV-I", investorType: "institutional" },
      ]);
      upsertFundFees([
        ter("PRIV", 2.5, { fundClassName: "PRIV-R" }),
        ter("PRIV", 0.01, { fundClassName: "PRIV-I" }), // institutional excluded
      ]);
      expect(findFunds({}).find((f) => f.projId === "PRIV")?.ter).toBe(2.5);
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

  it("excludes no-fee-data peers (0/0) instead of ranking them as free '0.00%'", () => {
    withDb(() => {
      // A peer with no published fee (0 actual AND 0 ceiling) used to derive a
      // current_ter of 0 and top the cheapest list as an absurd 0.00% match.
      // The NULLIF derivation makes its TER null, so it's excluded entirely; a
      // real cheaper peer still surfaces.
      upsertFund(fund("HELD4"));
      upsertFund(fund("NOFEE-PEER"));
      upsertFund(fund("REAL-CHEAP"));
      upsertFundFees([
        ter("HELD4", 1.0),
        ter("NOFEE-PEER", 0, { actualRatePct: 0, rateCeilingPct: 0 }),
        ter("REAL-CHEAP", 0.4),
      ]);
      const alts = getCheaperAlternatives("HELD4").map((f) => f.projId);
      expect(alts).toEqual(["REAL-CHEAP"]);
      expect(alts).not.toContain("NOFEE-PEER");
    });
  });

  it("does NOT offer a different-region peer (same asset class, wrong exposure)", () => {
    withDb(() => {
      // Held: a foreign/global equity fund. A cheaper DOMESTIC equity fund is
      // the same broad asset class but a different exposure — must be excluded.
      upsertFund(fund("GLOBAL-EQ", { investRegion: "foreign" }));
      upsertFund(fund("DOMESTIC-EQ", { investRegion: "domestic" }));
      upsertFund(fund("GLOBAL-EQ-CHEAP", { investRegion: "foreign" }));
      upsertFundFees([
        ter("GLOBAL-EQ", 1.0),
        ter("DOMESTIC-EQ", 0.2), // cheaper but wrong region
        ter("GLOBAL-EQ-CHEAP", 0.4), // cheaper AND same region
      ]);
      const alts = getCheaperAlternatives("GLOBAL-EQ").map((f) => f.projId);
      expect(alts).toEqual(["GLOBAL-EQ-CHEAP"]);
      expect(alts).not.toContain("DOMESTIC-EQ");
    });
  });

  it("matches region exactly including null (no cross-region match on null)", () => {
    withDb(() => {
      // Held fund has no region. A cheaper fund with a non-null region must not
      // be offered; a cheaper region-less fund of the same class still is.
      upsertFund(fund("NOREGION", { investRegion: null }));
      upsertFund(fund("FOREIGN-CHEAP", { investRegion: "foreign" }));
      upsertFund(fund("NOREGION-CHEAP", { investRegion: null }));
      upsertFundFees([ter("NOREGION", 1.0), ter("FOREIGN-CHEAP", 0.2), ter("NOREGION-CHEAP", 0.5)]);
      const alts = getCheaperAlternatives("NOREGION").map((f) => f.projId);
      expect(alts).toEqual(["NOREGION-CHEAP"]);
    });
  });
});

describe("findShareClasses (search + popularity ranking)", () => {
  const seedAum = (ticker: string, aum: number) => {
    getMarketDb()
      .insert(schema.navHistory)
      .values({ ticker: `thai_mutual_fund:${ticker}`, date: "2026-06-01", nav: 10, netAsset: aum })
      .run();
  };

  // Parent abbr SCBGOLD; classes are SCBGOLD{A,RA,P} — none is the bare abbr, so
  // "SCBGOLD" has no exact class match and ranks purely by AUM.
  const seedGoldFamily = () => {
    upsertFund(fund("GOLD", { abbrName: "SCBGOLD", englishName: "SCB Gold" }));
    upsertShareClasses([
      { projId: "GOLD", className: "SCBGOLDA", ticker: "SCBGOLDA", investorType: "retail" },
      { projId: "GOLD", className: "SCBGOLDRA", ticker: "SCBGOLDRA", investorType: "retail" },
      { projId: "GOLD", className: "SCBGOLDP", ticker: "SCBGOLDP", investorType: "retail" },
    ]);
    seedAum("SCBGOLDA", 500);
    seedAum("SCBGOLDRA", 300);
    seedAum("SCBGOLDP", 100);
  };

  it("finds the family by a class ticker and ranks it by AUM (most popular first)", () => {
    withDb(() => {
      seedGoldFamily();
      // The parent-abbr search was already working; the point is the order.
      const tickers = findShareClasses({ query: "SCBGOLD" }).map((c) => c.ticker);
      expect(tickers).toEqual(["SCBGOLDA", "SCBGOLDRA", "SCBGOLDP"]); // 500 > 300 > 100
    });
  });

  it("hoists an exact class-ticker match to #1, siblings following by AUM", () => {
    withDb(() => {
      seedGoldFamily();
      // The bug: this query used to return nothing. Now SCBGOLDP is found AND first.
      const tickers = findShareClasses({ query: "SCBGOLDP" }).map((c) => c.ticker);
      expect(tickers[0]).toBe("SCBGOLDP"); // exact match wins despite lowest AUM
      expect(tickers).toEqual(["SCBGOLDP", "SCBGOLDA", "SCBGOLDRA"]);
    });
  });

  it("hides insurance classes but keeps restricted ones, down-ranked below retail", () => {
    withDb(() => {
      upsertFund(fund("MIX", { abbrName: "MIXF", englishName: "Mixed Audience Fund" }));
      upsertShareClasses([
        { projId: "MIX", className: "MIXF-A", ticker: "MIXF-A", investorType: "retail" },
        { projId: "MIX", className: "MIXF-R", ticker: "MIXF-R", investorType: "restricted" },
        { projId: "MIX", className: "MIXF-IN", ticker: "MIXF-IN", investorType: "insurance" },
      ]);
      seedAum("MIXF-A", 100);
      seedAum("MIXF-R", 9999); // huge AUM must NOT lift it above retail

      const tickers = findShareClasses({ query: "MIXF" }).map((c) => c.ticker);
      expect(tickers).toEqual(["MIXF-A", "MIXF-R"]); // insurance hidden; restricted last
    });
  });
});

describe("findShareClasses browse order (pure per-class TER)", () => {
  const seedTer = (
    projId: string,
    abbr: string,
    classes: Array<[string, number | null, string | null]>,
  ) => {
    upsertFund(fund(projId, { abbrName: abbr }));
    upsertShareClasses(
      classes.map(([ticker, ter, investorType]) => ({
        projId,
        className: ticker,
        ticker,
        investorType,
        currentTer: ter,
      })),
    );
  };

  it("ranks each class on its OWN TER — a cheap sibling does not lift an expensive class", () => {
    withDb(() => {
      // Family FAM: a cheap class (0.09) and an expensive one (0.53), both buyable.
      seedTer("FAM", "FAM", [
        ["FAM-P", 0.09, null],
        ["FAM-B", 0.53, null],
      ]);
      // Two single-class funds priced between the siblings.
      seedTer("MIDA", "MIDA", [["MIDA", 0.2, "retail"]]);
      seedTer("MIDB", "MIDB", [["MIDB", 0.4, "retail"]]);

      // Pure per-class TER: FAM-B sits at its own 0.53%, NOT grouped up with FAM-P.
      expect(findShareClasses({}).map((c) => c.ticker)).toEqual(["FAM-P", "MIDA", "MIDB", "FAM-B"]);
    });
  });

  it("breaks equal-TER ties by AUM (desc), then retail before restricted only on equal AUM", () => {
    withDb(() => {
      // All four share TER=0.5. AUM dominates audience: the biggest class leads
      // even though it's restricted. Audience only decides the equal-AUM pair.
      seedTer("EQ", "EQ", [
        ["EQ-BIG", 0.5, "restricted"], // biggest AUM → #1 despite being restricted
        ["EQ-MID", 0.5, "retail"],
        ["EQ-SMALLR", 0.5, "restricted"], // ties EQ-SMALLA on AUM → loses on audience
        ["EQ-SMALLA", 0.5, "retail"],
      ]);
      getMarketDb()
        .insert(schema.navHistory)
        .values([
          { ticker: "thai_mutual_fund:EQ-BIG", date: "2026-06-01", nav: 10, netAsset: 900 },
          { ticker: "thai_mutual_fund:EQ-MID", date: "2026-06-01", nav: 10, netAsset: 500 },
          { ticker: "thai_mutual_fund:EQ-SMALLR", date: "2026-06-01", nav: 10, netAsset: 100 },
          { ticker: "thai_mutual_fund:EQ-SMALLA", date: "2026-06-01", nav: 10, netAsset: 100 },
        ])
        .run();
      expect(findShareClasses({}).map((c) => c.ticker)).toEqual([
        "EQ-BIG", // 900, restricted — AUM beats audience
        "EQ-MID", // 500
        "EQ-SMALLA", // 100, retail — beats EQ-SMALLR on audience at equal AUM
        "EQ-SMALLR", // 100, restricted
      ]);
    });
  });

  it("sorts zero/null-TER classes last, below every priced class", () => {
    withDb(() => {
      seedTer("PRICED", "PRICED", [["PRICED", 1.5, "retail"]]);
      seedTer("ZERO", "ZERO", [["ZERO", 0, "retail"]]);
      seedTer("NULLT", "NULLT", [["NULLT", null, "retail"]]);
      const tickers = findShareClasses({}).map((c) => c.ticker);
      expect(tickers[0]).toBe("PRICED"); // a real 1.5% beats no-fee
      expect(tickers.slice(1)).toEqual(expect.arrayContaining(["ZERO", "NULLT"]));
    });
  });
});

describe("retail-availability gate + zero-TER sort (#117)", () => {
  it("treats a zero/negative TER as no-fee — sorts it last, not as cheapest", () => {
    withDb(() => {
      upsertFund(fund("ZERO", { currentTer: 0 }));
      upsertFund(fund("CHEAP", { currentTer: 0.3 }));
      upsertFund(fund("MID", { currentTer: 1.0 }));
      upsertFund(fund("NULLTER", { currentTer: null }));
      const ids = findFunds({}).map((f) => f.projId);
      expect(ids.slice(0, 2)).toEqual(["CHEAP", "MID"]); // positive TER, cheapest first
      expect(ids.slice(2)).toEqual(expect.arrayContaining(["ZERO", "NULLTER"])); // 0 + null last
    });
  });

  it("hides funds the SEC marks not-for-retail (proj_retail_type != 'R'); keeps R + unknown", () => {
    withDb(() => {
      upsertFund(fund("RETAILF", { abbrName: "RTL", projRetailType: "R" }));
      upsertFund(fund("PRIVF", { abbrName: "PRV", projRetailType: "X" })); // not for retail
      upsertFund(fund("UNKNOWNF", { abbrName: "UNK", projRetailType: null })); // pre-crawl
      upsertShareClasses([
        { projId: "RETAILF", className: "RTL", ticker: "RTL", investorType: "retail" },
        { projId: "PRIVF", className: "PRV", ticker: "PRV", investorType: "retail" },
        { projId: "UNKNOWNF", className: "UNK", ticker: "UNK", investorType: "retail" },
      ]);
      const tickers = findShareClasses({}).map((c) => c.ticker);
      expect(tickers).toContain("RTL"); // retail kept
      expect(tickers).toContain("UNK"); // null = unknown (pre-crawl) → kept (safe no-op)
      expect(tickers).not.toContain("PRV"); // proj_retail_type=X → whole fund hidden
    });
  });

  it("includeNonRetail surfaces a not-for-retail fund", () => {
    withDb(() => {
      upsertFund(fund("PRIVF", { abbrName: "PRV", projRetailType: "X" }));
      upsertShareClasses([
        { projId: "PRIVF", className: "PRV", ticker: "PRV", investorType: "retail" },
      ]);
      expect(findShareClasses({ includeNonRetail: true }).map((c) => c.ticker)).toContain("PRV");
    });
  });

  describe("catalogQuoteSource — DB-backed source detection", () => {
    it("tags a catalog share-class ticker as a Thai mutual fund (authoritative)", () => {
      withDb(() => {
        upsertFund(fund("EXAMPLEFUND"));
        upsertShareClasses([
          {
            projId: "EXAMPLEFUND",
            className: "main",
            ticker: "EXAMPLE-FUND-A",
            investorType: "retail",
          },
        ]);
        expect(catalogQuoteSource(["EXAMPLE-FUND-A"]).get("EXAMPLE-FUND-A")).toBe(
          "thai_mutual_fund",
        );
      });
    });

    it("recognizes a single-class fund by its parent abbr (no share-class row)", () => {
      withDb(() => {
        // Only the parent catalog row exists (a single-class fund exposes its abbr
        // as the holdable ticker) — still authoritative as a Thai fund.
        upsertFund(fund("SOLOFUND", { abbrName: "SOLOFUND" }));
        expect(catalogQuoteSource(["SOLOFUND"]).get("SOLOFUND")).toBe("thai_mutual_fund");
      });
    });

    it("does NOT let a hyphenated NON-catalog code masquerade as a fund", () => {
      withDb(() => {
        // Nothing seeded → not in the catalog. The heuristic would guess "Fund" off
        // the hyphen; the catalog check overrides that to custom (manual).
        expect(catalogQuoteSource(["NOT-A-REAL-FUND"]).get("NOT-A-REAL-FUND")).toBe("manual");
      });
    });

    it("leaves a market-shaped symbol on the market source", () => {
      withDb(() => {
        expect(catalogQuoteSource(["PTT.BK"]).get("PTT.BK")).toBe("market");
        expect(catalogQuoteSource(["^GSPC"]).get("^GSPC")).toBe("market");
      });
    });

    it("is case-insensitive and keys by the upper-cased ticker", () => {
      withDb(() => {
        upsertFund(fund("EXAMPLEFUND"));
        upsertShareClasses([
          {
            projId: "EXAMPLEFUND",
            className: "main",
            ticker: "EXAMPLE-FUND-A",
            investorType: "retail",
          },
        ]);
        expect(catalogQuoteSource(["example-fund-a"]).get("EXAMPLE-FUND-A")).toBe(
          "thai_mutual_fund",
        );
      });
    });
  });
});
