import { describe, expect, it } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";
import { runWithDbContext } from "../db/context";
import { upsertFundQuote } from "../db/queries/quotes";
import { deriveRowsWithNav, quoteCacheKey } from "./derive-rows";
import type { DerivedRow, ExtractedRow } from "./ocr";

function withDb<T>(fn: () => T): T {
  return runWithDbContext(makeTestDbContext(), fn) as T;
}

function seedNav(ticker: string, nav: number): void {
  upsertFundQuote({ ticker: quoteCacheKey(ticker), nav, updatedAt: new Date().toISOString() });
}

describe("quoteCacheKey", () => {
  it("builds the composite source:TICKER key fund_quotes is keyed by", () => {
    // Hyphenated code → Thai mutual fund; bare ETF → yahoo.
    expect(quoteCacheKey("k-usa-a")).toBe("thai_mutual_fund:K-USA-A");
    expect(quoteCacheKey(" voo ")).toBe("yahoo:VOO");
  });
});

describe("deriveRowsWithNav", () => {
  it("returns [] for no rows without touching the DB", () => {
    // No DB context needed — must short-circuit before any query.
    expect(deriveRowsWithNav([])).toEqual([]);
  });

  it("derives units + avgCost from market NAV when only value is shown", () => {
    const rows = withDb(() => {
      seedNav("K-USA-A", 20); // value 1000 ÷ NAV 20 = 50 units
      const extracted: ExtractedRow[] = [{ ticker: "K-USA-A", value: 1000, pl: 100 }];
      return deriveRowsWithNav(extracted) as DerivedRow[];
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.units).toBeCloseTo(50);
    expect(r.estimated).toBe(true);
    expect(r.needsUnits).toBe(false);
    expect(r.quoteSource).toBe("thai_mutual_fund");
    // avgCost = (value − pl) / units = (1000 − 100) / 50 = 18
    expect(r.avgCost).toBeCloseTo(18);
  });

  it("trusts units/avgCost printed on the image — derives nothing", () => {
    const rows = withDb(() => {
      // No NAV seeded: everything needed is already on the image, so deriveRow
      // fills in nothing and `estimated` stays false.
      const extracted: ExtractedRow[] = [{ ticker: "VOO", units: 10, avgCost: 5, nav: 6 }];
      return deriveRowsWithNav(extracted) as DerivedRow[];
    });
    expect(rows[0].units).toBe(10);
    expect(rows[0].avgCost).toBe(5);
    expect(rows[0].estimated).toBe(false);
    expect(rows[0].quoteSource).toBe("yahoo");
  });

  it("flags needsUnits when there is no NAV on file and none on the image", () => {
    const rows = withDb(() => {
      const extracted: ExtractedRow[] = [{ ticker: "K-NOPRICE-A", value: 500 }];
      return deriveRowsWithNav(extracted) as DerivedRow[];
    });
    expect(rows[0].units).toBeUndefined();
    expect(rows[0].needsUnits).toBe(true);
  });
});
