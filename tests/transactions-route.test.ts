import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";

// Drive the real POST handler against a shared in-memory DB context: withDb is
// mocked to run the route body inside runWithDbContext(ctx), so the route's own
// queries (buckets, fund quotes, nav_history, insert) hit the seeded test DBs.
// This locks the #130 money-facts → units derivation end to end.
const h = vi.hoisted(() => ({ ctx: null as ReturnType<typeof makeTestDbContext> | null }));
function ctx() {
  if (!h.ctx) throw new Error("test DB context not set");
  return h.ctx;
}
vi.mock("@/lib/api/with-db", () => ({
  withDb: async <T>(fn: (c: unknown) => T | Promise<T>) => {
    const { runWithDbContext } = await import("@/lib/db/context");
    const c = ctx();
    return runWithDbContext(c, () => fn(c));
  },
}));

import { eq } from "drizzle-orm";
import { POST } from "@/app/api/transactions/route";
import { runWithDbContext } from "@/lib/db/context";
import { createBucket } from "@/lib/db/queries/buckets";
import { listHoldings } from "@/lib/db/queries/holdings";
import { navHistory } from "@/lib/db/schema";
import { quoteCacheKey } from "@/lib/market/sources";

/** Units the projection derived for a ticker (the holdings cache), or undefined if not held. */
function heldUnits(ticker: string): number | undefined {
  return runWithDbContext(ctx(), () => listHoldings().find((h) => h.ticker === ticker)?.units) as
    | number
    | undefined;
}

/** Avg cost the projection derived for a ticker, or undefined if not held / cost unknown. */
function heldAvgCost(ticker: string): number | null | undefined {
  return runWithDbContext(ctx(), () => listHoldings().find((h) => h.ticker === ticker)?.avgCost) as
    | number
    | null
    | undefined;
}

const BUCKET = {
  id: "b1",
  name: "Core",
  typeLabel: "Free",
  icon: "○",
  color: "#3b82f6",
  brokerage: "FNDQ",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

function seedNav(key: string, rows: [string, number][]): void {
  for (const [date, nav] of rows)
    ctx().marketDb.insert(navHistory).values({ ticker: key, date, nav }).run();
}

async function post(transactions: unknown[]) {
  const req = new Request("http://localhost/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bucketId: "b1", transactions }),
  });
  const res = await POST(req);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  h.ctx = makeTestDbContext();
  runWithDbContext(h.ctx, () => createBucket(BUCKET));
});

describe("POST /api/transactions — facts-only ledger (ADR 0004)", () => {
  it("stores a value-only Balance's VALUE fact (units NULL) and derives units in the projection", async () => {
    seedNav("thai_mutual_fund:EXAMPLE-FUND-A", [
      ["2026-02-01", 12.5],
      ["2026-03-15", 99], // a later NAV must NOT be used for a 2026-03-01 balance
    ]);
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "EXAMPLE-FUND-A",
        quoteSource: "thai_mutual_fund",
        value: 200000,
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    // The LEDGER stores the FACT, never a derived unit count.
    expect(body.inserted[0].value).toBe(200000);
    expect(body.inserted[0].units).toBeNull();
    // The PROJECTION derives units from NAV on the balance's OWN date (12.5, not 99).
    expect(heldUnits("EXAMPLE-FUND-A")).toBeCloseTo(16000);
  });

  it("derives units for a LOWERCASE-cataloged fund's value-only Balance (cache-key case, #134)", async () => {
    // The ttb SSF/RMF family is cataloged in lowercase. The NAV cache is keyed by
    // the canonical quoteCacheKey (source:UPPER(ticker)) on write, and the fold
    // looks it up the same way — so a lowercase ticker must resolve to the same
    // row. Pre-#134 the write side used the catalog's native (lowercase) case
    // while the fold uppercased, so the lookup missed and the position silently
    // dropped from holdings. Seed via the SAME builder the writer uses, then post
    // a Balance carrying the lowercase ticker.
    seedNav(quoteCacheKey("thai_mutual_fund", "example-ssf"), [["2026-03-01", 12.5]]);
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "example-ssf",
        quoteSource: "thai_mutual_fund",
        value: 200000,
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    expect(body.inserted[0].value).toBe(200000);
    expect(body.inserted[0].units).toBeNull();
    // 200000 ÷ 12.5 = 16000 — derived despite the lowercase catalog case.
    expect(heldUnits("example-ssf")).toBeCloseTo(16000);
  });

  it("stores an amount-only buy's AMOUNT fact (units NULL) and derives units in the projection", async () => {
    seedNav("thai_mutual_fund:EXAMPLE-FUND-B", [["2026-03-01", 20]]);
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-FUND-B",
        quoteSource: "thai_mutual_fund",
        amount: 1000,
      },
    ]);
    expect(status).toBe(201);
    // The LEDGER keeps the ฿ amount fact, not a frozen unit estimate.
    expect(body.inserted[0].units).toBeNull();
    // The PROJECTION derives units from NAV(tradeDate): 1000 ÷ 20 = 50.
    expect(heldUnits("EXAMPLE-FUND-B")).toBeCloseTo(50);
  });

  it("derives an amount-only buy's units from its execution price over NAV", async () => {
    seedNav("thai_mutual_fund:EXAMPLE-FUND-B", [["2026-03-01", 20]]);
    await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-FUND-B",
        quoteSource: "thai_mutual_fund",
        pricePerUnit: 25,
        amount: 1000,
      },
    ]);
    expect(heldUnits("EXAMPLE-FUND-B")).toBeCloseTo(40); // 1000 ÷ 25, not ÷ 20
  });

  it("derives a UNITS-only buy's amount from units × NAV (symmetric twin)", async () => {
    seedNav("thai_mutual_fund:EXAMPLE-FUND-B", [["2026-03-01", 20]]);
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-FUND-B",
        quoteSource: "thai_mutual_fund",
        units: 50, // just units — no amount, no price
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    // Ledger stores units as the fact; amount 0 (the fold fills it from NAV).
    expect(body.inserted[0].units).toBeCloseTo(50);
    expect(body.inserted[0].amount).toBe(0);
    // The fold derives the cost: 50 × NAV(20) = ฿1000 → avg cost 20, units held.
    expect(heldUnits("EXAMPLE-FUND-B")).toBeCloseTo(50);
    expect(heldAvgCost("EXAMPLE-FUND-B")).toBeCloseTo(20);
  });

  it("a units-only buy with no NAV holds the units (cost stays unknown)", async () => {
    const { status } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-NONAV",
        quoteSource: "thai_mutual_fund",
        units: 50,
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    expect(heldUnits("EXAMPLE-NONAV")).toBeCloseTo(50); // saved + held, no NAV to cost it
  });

  it("saves a value-only Balance even with no NAV yet — the fact is kept, units derive when NAV lands", async () => {
    // No NAV seeded anywhere. The old behaviour rejected this (422); facts-only
    // SAVES the value fact, and the projection simply can't price it yet.
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "EXAMPLE-NOPRICE",
        quoteSource: "thai_mutual_fund",
        value: 200000,
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    expect(body.inserted[0].value).toBe(200000);
    expect(body.inserted[0].units).toBeNull();
    // No NAV → unresolved → not held yet (no fabricated unit count); it appears once
    // that date's NAV lands and the projection re-folds.
    expect(heldUnits("EXAMPLE-NOPRICE")).toBeUndefined();
  });

  it("stores a value-only Balance's invested TOTAL as a signed amount; derives avg cost at the fold", async () => {
    // The Thai-app case: the source shows a current value AND an invested total, but no
    // unit count and no per-unit avg cost. We persist BOTH ฿ facts (value + cost total)
    // and derive units + per-unit avg cost at the fold — never freezing a NAV-derived cost.
    seedNav("thai_mutual_fund:EXAMPLE-FUND-A", [["2026-03-01", 12.5]]);
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "EXAMPLE-FUND-A",
        quoteSource: "thai_mutual_fund",
        value: 200000,
        amount: 180000, // the invested cost TOTAL (magnitude) — server signs it
      },
    ]);
    expect(status).toBe(201);
    // Ledger keeps the value fact + the cost as a signed amount (opening = cash out).
    expect(body.inserted[0].value).toBe(200000);
    expect(body.inserted[0].units).toBeNull();
    expect(body.inserted[0].pricePerUnit).toBeNull(); // no frozen per-unit cost
    expect(body.inserted[0].amount).toBe(-180000); // reaches XIRR as invested cash
    // Fold derives units (200000 ÷ 12.5 = 16000) and per-unit avg cost (180000 ÷ 16000 = 11.25).
    expect(heldUnits("EXAMPLE-FUND-A")).toBeCloseTo(16000);
    expect(heldAvgCost("EXAMPLE-FUND-A")).toBeCloseTo(11.25);
  });

  it("signs a costed opening's amount so it reaches XIRR (was hardcoded 0)", async () => {
    const { body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "EXAMPLE-FUND-C",
        quoteSource: "thai_mutual_fund",
        units: 100,
        pricePerUnit: 10,
        amount: 1000, // units × avg cost — the cash put to work
      },
    ]);
    expect(body.inserted[0].amount).toBe(-1000);
    expect(heldAvgCost("EXAMPLE-FUND-C")).toBeCloseTo(10);
  });

  it("an unpriceable value-only anchor does NOT wipe an existing position", async () => {
    // A prior units-based buy establishes a position (no NAV needed — units are read).
    await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-WIPE",
        quoteSource: "thai_mutual_fund",
        units: 50,
        pricePerUnit: 5,
        amount: 250,
      },
    ]);
    expect(heldUnits("EXAMPLE-WIPE")).toBeCloseTo(50);
    // A later value-only anchor with NO NAV anywhere can't be priced. It must be
    // DROPPED at the fold, not folded as zero units — which would clear the holding.
    await post([
      {
        tradeDate: "2026-06-01",
        kind: "opening", // promoted to a restatement (snapshot) — second anchor
        ticker: "EXAMPLE-WIPE",
        quoteSource: "thai_mutual_fund",
        value: 1000,
        amount: 0,
      },
    ]);
    expect(heldUnits("EXAMPLE-WIPE")).toBeCloseTo(50); // preserved, not wiped to 0
  });

  it("re-folds holdings on READ — a NAV correction shows up with no new ledger write", async () => {
    // The read-through fold (ADR 0004): holdings reads re-derive units from the live
    // NAV, so a corrected NAV reflects immediately — no rebuild-on-write staleness.
    seedNav("thai_mutual_fund:EXAMPLE-FUND-A", [["2026-03-01", 12.5]]);
    await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "EXAMPLE-FUND-A",
        quoteSource: "thai_mutual_fund",
        value: 200000,
        amount: 0,
      },
    ]);
    expect(heldUnits("EXAMPLE-FUND-A")).toBeCloseTo(16000); // 200000 ÷ 12.5

    // Correct that date's NAV in market.db — NO ledger write, NO rebuild.
    ctx()
      .marketDb.update(navHistory)
      .set({ nav: 10 })
      .where(eq(navHistory.ticker, "thai_mutual_fund:EXAMPLE-FUND-A"))
      .run();

    // The very next holdings read reflects the corrected NAV.
    expect(heldUnits("EXAMPLE-FUND-A")).toBeCloseTo(20000); // 200000 ÷ 10
  });

  it("values a CUSTOM value-only Balance from its current price (no NAV)", async () => {
    // A self-priced asset has no NAV; its units come from value ÷ the current price.
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "opening",
        ticker: "MYSTERY",
        quoteSource: "manual",
        value: 50000,
        marketPrice: 25, // the current price the user gave
        amount: 0,
      },
    ]);
    expect(status).toBe(201);
    expect(body.inserted[0].value).toBe(50000);
    expect(body.inserted[0].units).toBeNull();
    // 50000 ÷ 25 = 2000 units, held and valued off the current price.
    expect(heldUnits("MYSTERY")).toBeCloseTo(2000);
  });

  it("passes a normal units+price buy through untouched", async () => {
    const { status, body } = await post([
      {
        tradeDate: "2026-03-01",
        kind: "buy",
        ticker: "EXAMPLE-FUND-C",
        quoteSource: "thai_mutual_fund",
        units: 10,
        pricePerUnit: 5,
        amount: 50,
      },
    ]);
    expect(status).toBe(201);
    expect(body.inserted[0].units).toBeCloseTo(10);
  });
});
