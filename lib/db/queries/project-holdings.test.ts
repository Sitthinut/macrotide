// Holdings-as-projection (ADR 0004): inserting/deleting ledger events rebuilds
// the derived `holdings` rows, and the prod backfill (holding → opening anchor →
// rebuild) reproduces the original position.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { freshMarketDb } from "@/tests/db-helpers";
import { type DbContext, runWithDbContext } from "../context";
import * as schema from "../schema";
import { createBucket } from "./buckets";
import { createHolding, listHoldings } from "./holdings";
import {
  createHoldingViaLedger,
  deleteHoldingViaLedger,
  editHoldingViaLedger,
  openingFromHolding,
  rebuildHoldingsForBucket,
} from "./project-holdings";
import {
  deleteTransactionBatch,
  insertTransactions,
  listTransactionsByBucket,
} from "./transactions";

function freshCtx(): DbContext {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const dir = resolve("lib/db/migrations/app");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n")
    .replace(/--> statement-breakpoint/g, ";");
  sqlite.exec(sql);
  const market = freshMarketDb();
  return {
    appDb: drizzle(sqlite, { schema }),
    appSqlite: sqlite,
    marketDb: market.db,
    marketSqlite: market.sqlite,
    isDemo: false,
    sessionId: "s",
    userId: null,
  };
}

const BUCKET = {
  name: "B",
  typeLabel: null,
  icon: null,
  color: null,
  brokerage: "X",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

const A = "EXAMPLE-FUND-A";

describe("holdings projection — ledger writes rebuild holdings", () => {
  it("derives units + avg cost from inserted ledger events", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      insertTransactions([
        {
          bucketId: "b1",
          ticker: A,
          englishName: "Fund A",
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-01-01",
          units: 100,
          pricePerUnit: 10,
          amount: -1000,
          fxToThb: 1,
        },
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-02-01",
          units: 100,
          pricePerUnit: 30,
          amount: -3000,
          fxToThb: 1,
        },
      ]);
      const h = listHoldings("b1");
      expect(h).toHaveLength(1);
      expect(h[0].units).toBeCloseTo(200, 6);
      expect(h[0].avgCost).toBeCloseTo(20, 6);
      expect(h[0].englishName).toBe("Fund A");
    });
  });

  it("removes the holding when the position fully exits", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      insertTransactions([
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-01-01",
          units: 100,
          amount: -1000,
          fxToThb: 1,
        },
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "sell",
          tradeDate: "2024-02-01",
          units: 100,
          amount: 1200,
          fxToThb: 1,
        },
      ]);
      expect(listHoldings("b1")).toHaveLength(0);
    });
  });

  it("an uncosted opening yields a held holding with avgCost null", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      insertTransactions([
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "opening",
          tradeDate: "2024-01-01",
          units: 100,
          amount: 0,
          fxToThb: 1,
        },
      ]);
      const h = listHoldings("b1");
      expect(h[0].units).toBeCloseTo(100, 6);
      expect(h[0].avgCost).toBeNull();
    });
  });

  it("deleting an import batch rebuilds (here: back to empty)", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      insertTransactions([
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-01-01",
          units: 100,
          amount: -1000,
          fxToThb: 1,
          importBatchId: "batch-1",
        },
      ]);
      expect(listHoldings("b1")).toHaveLength(1);
      deleteTransactionBatch("batch-1", ["b1"]);
      expect(listHoldings("b1")).toHaveLength(0);
    });
  });
});

describe("holdings write paths route through the ledger", () => {
  it("create writes an opening anchor + stamps metadata on the derived row", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      const h = createHoldingViaLedger({
        bucketId: "b1",
        ticker: A,
        englishName: "Fund A",
        quoteSource: "thai_mutual_fund",
        units: 100,
        avgCost: 12,
        category: "Equity",
        color: "#abc",
      });
      expect(h?.units).toBeCloseTo(100, 6);
      expect(h?.avgCost).toBeCloseTo(12, 6);
      expect(h?.category).toBe("Equity"); // metadata preserved
      const ledger = listTransactionsByBucket("b1");
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("opening");
    });
  });

  it("edit: metadata-only change writes NO new ledger event", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      const h = createHoldingViaLedger({
        bucketId: "b1",
        ticker: A,
        englishName: "Fund A",
        quoteSource: "market",
        units: 100,
        avgCost: 12,
      });
      editHoldingViaLedger(h?.id as number, { color: "#fff", category: "Bond" });
      expect(listTransactionsByBucket("b1")).toHaveLength(1); // unchanged
      expect(listHoldings("b1")[0].category).toBe("Bond");
    });
  });

  it("edit: position change on a single-event holding edits it IN PLACE", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      const h = createHoldingViaLedger({
        bucketId: "b1",
        ticker: A,
        englishName: "Fund A",
        quoteSource: "market",
        units: 100,
        avgCost: 12,
      });
      editHoldingViaLedger(h?.id as number, { units: 150, avgCost: 14 });
      const ledger = listTransactionsByBucket("b1");
      expect(ledger).toHaveLength(1); // still one event — edited, not appended
      expect(ledger[0].units).toBeCloseTo(150, 6);
      expect(listHoldings("b1")[0].avgCost).toBeCloseTo(14, 6);
    });
  });

  it("edit: position change on a multi-event holding appends a snapshot", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      insertTransactions([
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-01-01",
          units: 100,
          amount: -1000,
          fxToThb: 1,
        },
        {
          bucketId: "b1",
          ticker: A,
          quoteSource: "market",
          kind: "buy",
          tradeDate: "2024-02-01",
          units: 100,
          amount: -3000,
          fxToThb: 1,
        },
      ]);
      const id = listHoldings("b1")[0].id;
      editHoldingViaLedger(id, { units: 250 });
      const ledger = listTransactionsByBucket("b1");
      expect(ledger).toHaveLength(3); // two buys + one snapshot
      expect(ledger.some((t) => t.kind === "snapshot")).toBe(true);
      expect(listHoldings("b1")[0].units).toBeCloseTo(250, 6);
    });
  });

  it("delete removes the holding and its ledger events", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      const h = createHoldingViaLedger({
        bucketId: "b1",
        ticker: A,
        englishName: "Fund A",
        quoteSource: "market",
        units: 100,
        avgCost: 12,
      });
      expect(deleteHoldingViaLedger(h?.id as number)).toBe(true);
      expect(listHoldings("b1")).toHaveLength(0);
      expect(listTransactionsByBucket("b1")).toHaveLength(0);
    });
  });
});

describe("holdings projection — backfill equivalence", () => {
  it("holding → opening anchor → rebuild reproduces the same position", () => {
    runWithDbContext(freshCtx(), () => {
      createBucket({ ...BUCKET, id: "b1" });
      // A hand-typed snapshot holding, as today.
      const before = createHolding({
        bucketId: "b1",
        ticker: A,
        englishName: "Fund A",
        units: 250,
        avgCost: 12.5,
        quoteSource: "thai_mutual_fund",
        source: "Broker X",
      });

      // Backfill it into an opening anchor, then rebuild the projection.
      insertTransactions([openingFromHolding(before)]);
      rebuildHoldingsForBucket("b1");

      const after = listHoldings("b1");
      expect(after).toHaveLength(1);
      expect(after[0].units).toBeCloseTo(before.units, 6);
      expect(after[0].avgCost).toBeCloseTo(before.avgCost as number, 6);
      expect(after[0].quoteSource).toBe(before.quoteSource);
      expect(after[0].source).toBe(before.source);
      // And the ledger now carries exactly one opening event.
      const ledger = listTransactionsByBucket("b1");
      expect(ledger).toHaveLength(1);
      expect(ledger[0].kind).toBe("opening");
    });
  });
});
