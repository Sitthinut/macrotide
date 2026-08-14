// Contract for the share-class upsert when a fund CODE changes hands.
//
// Thai fund codes get reused: a fixed-term fund matures and its code is recycled
// for the next term, a fund re-registers under a new proj_id, or a single-class
// fund goes multi-class and the code moves off its own "main" row. This table
// never deletes, so the previous holder was still claiming the code and the
// UNIQUE index on `ticker` aborted the entire nightly refresh.
//
//   1. The incoming class takes the code; the previous holder is RETIRED (ticker
//      NULL) rather than deleted — its row stays as a holdings anchor.
//   2. A cross-FUND handover purges the cached NAV, so the new fund never inherits
//      the previous fund's price history.
//   3. A handover between two classes of the SAME fund keeps the cache — the
//      series still belongs to that fund.
//   4. Retired classes disappear from the live reads.

import { describe, expect, it } from "vitest";
import { quoteCacheKey } from "@/lib/market/sources";
import { makeTestDbContext } from "@/tests/db-helpers";
import { type DbContext, runWithDbContext } from "../context";
import { fundCatalog, fundShareClasses, navHistory } from "../schema";
import { listShareClassesByProj, upsertShareClasses } from "./share-classes";

const NAV_KEY = quoteCacheKey("thai_mutual_fund", "RECYCLED");

function seed(ctx: DbContext) {
  ctx.marketDb
    .insert(fundCatalog)
    .values([
      { projId: "OLD", abbrName: "RECYCLED", status: "active" },
      { projId: "NEW", abbrName: "RECYCLED", status: "active" },
    ])
    .run();
  ctx.marketDb.insert(navHistory).values({ ticker: NAV_KEY, date: "2026-01-01", nav: 10 }).run();
}

function inCtx(fn: (ctx: DbContext) => void) {
  const ctx = makeTestDbContext();
  seed(ctx);
  runWithDbContext(ctx, () => fn(ctx));
}

const navRows = (ctx: DbContext) => ctx.marketDb.select().from(navHistory).all();
const allClasses = (ctx: DbContext) => ctx.marketDb.select().from(fundShareClasses).all();

describe("upsertShareClasses — a code changing hands", () => {
  it("retires the previous holder instead of aborting on the UNIQUE index", () => {
    inCtx((ctx) => {
      upsertShareClasses([{ projId: "OLD", className: "main", ticker: "RECYCLED" }]);
      // The next term's fund registers under a new proj_id with the same code.
      expect(() =>
        upsertShareClasses([{ projId: "NEW", className: "main", ticker: "RECYCLED" }]),
      ).not.toThrow();

      const rows = allClasses(ctx);
      expect(rows).toHaveLength(2); // the superseded row SURVIVES as an anchor
      expect(rows.find((r) => r.projId === "OLD")?.ticker).toBeNull();
      expect(rows.find((r) => r.projId === "NEW")?.ticker).toBe("RECYCLED");
    });
  });

  it("purges the cached NAV when a DIFFERENT fund takes the code", () => {
    inCtx((ctx) => {
      upsertShareClasses([{ projId: "OLD", className: "main", ticker: "RECYCLED" }]);
      expect(navRows(ctx)).toHaveLength(1);

      upsertShareClasses([{ projId: "NEW", className: "main", ticker: "RECYCLED" }]);
      // Keeping it would draw the matured fund's price history on the new fund.
      expect(navRows(ctx)).toHaveLength(0);
    });
  });

  it("keeps the cached NAV when the code moves between classes of the SAME fund", () => {
    inCtx((ctx) => {
      upsertShareClasses([{ projId: "OLD", className: "main", ticker: "RECYCLED" }]);
      // Single-class fund goes multi-class: the code moves off its own "main" row.
      upsertShareClasses([{ projId: "OLD", className: "RECYCLED", ticker: "RECYCLED" }]);

      expect(navRows(ctx)).toHaveLength(1);
      const rows = allClasses(ctx);
      expect(rows.find((r) => r.className === "main")?.ticker).toBeNull();
      expect(rows.find((r) => r.className === "RECYCLED")?.ticker).toBe("RECYCLED");
    });
  });

  it("hides a retired class from the live class list", () => {
    inCtx(() => {
      upsertShareClasses([{ projId: "OLD", className: "main", ticker: "RECYCLED" }]);
      expect(listShareClassesByProj("OLD")).toHaveLength(1);

      upsertShareClasses([{ projId: "NEW", className: "main", ticker: "RECYCLED" }]);
      expect(listShareClassesByProj("OLD")).toHaveLength(0);
      expect(listShareClassesByProj("NEW").map((c) => c.ticker)).toEqual(["RECYCLED"]);
    });
  });

  it("leaves an unrelated class alone", () => {
    inCtx((ctx) => {
      upsertShareClasses([
        { projId: "OLD", className: "main", ticker: "RECYCLED" },
        { projId: "OLD", className: "OTHER-A", ticker: "OTHER-A" },
      ]);
      upsertShareClasses([{ projId: "NEW", className: "main", ticker: "RECYCLED" }]);

      expect(allClasses(ctx).find((r) => r.className === "OTHER-A")?.ticker).toBe("OTHER-A");
    });
  });
});
