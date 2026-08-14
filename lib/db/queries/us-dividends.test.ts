// Contract for us_dividends writes:
//   1. One ex-date can carry MORE THAN ONE real payment — a regular plus a
//      supplemental, or a base plus a variable component. Both are kept.
//   2. The feed restates a single payment with a corrected payable date; that is
//      one payment and is collapsed to one row.
//   3. setDividends replaces a symbol's rows wholesale and leaves other symbols
//      alone.

import { describe, expect, it } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";
import type { UsDividend } from "../../market/corporate-actions";
import { runWithDbContext } from "../context";
import { usSecurities } from "../schema";
import { getDividends, setDividends } from "./us-dividends";

const div = (d: Partial<UsDividend> & { exDate: string; cashAmount: number }): UsDividend => ({
  payableDate: null,
  recordDate: null,
  special: false,
  ...d,
});

function inCtx(fn: () => void) {
  const ctx = makeTestDbContext();
  ctx.marketDb
    .insert(usSecurities)
    .values({ symbol: "TEST", name: "Test Corp", securityType: "stock", status: "active" })
    .run();
  runWithDbContext(ctx, fn);
}

describe("setDividends", () => {
  it("keeps a regular and a supplemental dividend sharing one ex-date", () => {
    // Ford, 2026-02-18: $0.15 regular + a $0.15 supplemental. Same ex-date, same
    // record date, same amount — only `special` separates them, and both are real
    // cash. Collapsing them would halve the reported trailing yield.
    inCtx(() => {
      const n = setDividends(
        "TEST",
        [
          div({ exDate: "2026-02-18", recordDate: "2026-02-18", cashAmount: 0.15, special: false }),
          div({ exDate: "2026-02-18", recordDate: "2026-02-18", cashAmount: 0.15, special: true }),
        ],
        "2026-07-22T00:00:00Z",
      );
      expect(n).toBe(2);
      const { dividends } = getDividends("TEST");
      expect(dividends).toHaveLength(2);
      expect(dividends.map((d) => d.special).sort()).toEqual([false, true]);
    });
  });

  it("keeps a base and a variable component sharing one ex-date", () => {
    // Hecla / Utz shape: two non-special rows differing only in amount.
    inCtx(() => {
      setDividends(
        "TEST",
        [
          div({ exDate: "2026-05-23", recordDate: "2026-05-24", cashAmount: 0.00375 }),
          div({ exDate: "2026-05-23", recordDate: "2026-05-24", cashAmount: 0.0025 }),
        ],
        "2026-07-22T00:00:00Z",
      );
      expect(getDividends("TEST").dividends).toHaveLength(2);
    });
  });

  it("collapses one payment restated with a corrected payable date", () => {
    // QQQ, 2022-09-19: identical rate and record date, payable reported as both
    // 09-23 and 10-31. One dividend, reported twice — counting both would inflate
    // trailing yield.
    inCtx(() => {
      const n = setDividends(
        "TEST",
        [
          div({
            exDate: "2022-09-19",
            recordDate: "2022-09-20",
            payableDate: "2022-09-23",
            cashAmount: 0.51856,
          }),
          div({
            exDate: "2022-09-19",
            recordDate: "2022-09-20",
            payableDate: "2022-10-31",
            cashAmount: 0.51856,
          }),
        ],
        "2026-07-22T00:00:00Z",
      );
      expect(n).toBe(1);
      const { dividends } = getDividends("TEST");
      expect(dividends).toHaveLength(1);
      // First-seen wins, so the originally-reported payable date is kept.
      expect(dividends[0].payableDate).toBe("2022-09-23");
    });
  });

  it("replaces a symbol's rows and stamps the fetch time", () => {
    inCtx(() => {
      setDividends("TEST", [div({ exDate: "2025-01-01", cashAmount: 1 })], "2026-01-01T00:00:00Z");
      setDividends("TEST", [div({ exDate: "2026-01-01", cashAmount: 2 })], "2026-07-22T00:00:00Z");
      const { dividends, fetchedAt } = getDividends("TEST");
      expect(dividends.map((d) => d.exDate)).toEqual(["2026-01-01"]);
      expect(fetchedAt).toBe("2026-07-22T00:00:00Z");
    });
  });
});
