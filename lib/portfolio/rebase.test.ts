import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "@/lib/static/types";
import { rebaseBenchmark } from "./rebase";

const pf = (...vals: [string, number][]): SeriesPoint[] => vals.map(([d, v]) => ({ d, v }));

describe("rebaseBenchmark", () => {
  it("rebases the benchmark to the portfolio value at the first common date", () => {
    const portfolio = pf(["Jan 2", 1000], ["Jan 3", 1100], ["Jan 4", 1200]);
    const benchmark = pf(["Jan 2", 50], ["Jan 3", 55], ["Jan 4", 60]);

    const out = rebaseBenchmark(portfolio, benchmark);

    // Benchmark starts at portfolio's 1000 and tracks its own % move (+10%, +20%).
    expect(out).toEqual(pf(["Jan 2", 1000], ["Jan 3", 1100], ["Jan 4", 1200]));
  });

  it("renders across non-overlapping lengths by intersecting on common dates", () => {
    // Different calendars: portfolio has Jan 3 (TH holiday for the benchmark),
    // benchmark has Jan 2 the portfolio lacks. They overlap on Jan 4/5.
    const portfolio = pf(["Jan 3", 1000], ["Jan 4", 1020], ["Jan 5", 1050]);
    const benchmark = pf(["Jan 2", 200], ["Jan 4", 210], ["Jan 5", 220]);

    const out = rebaseBenchmark(portfolio, benchmark);
    expect(out).not.toBeNull();
    // First common date is Jan 4: benchmark rebased to portfolio's 1020 there.
    const byD = new Map(out?.map((p) => [p.d, p.v]));
    expect(byD.get("Jan 4")).toBeCloseTo(1020);
    expect(byD.get("Jan 5")).toBeCloseTo((220 / 210) * 1020);
    // Jan 3 precedes the first common date → null (gap), not zero.
    expect(byD.get("Jan 3")).toBeNull();
  });

  it("forward-fills the benchmark across portfolio dates it does not cover", () => {
    const portfolio = pf(["Jan 2", 1000], ["Jan 3", 1010], ["Jan 4", 1020]);
    // Benchmark missing Jan 3 — should hold Jan 2's value forward.
    const benchmark = pf(["Jan 2", 100], ["Jan 4", 110]);

    const out = rebaseBenchmark(portfolio, benchmark);
    const byD = new Map(out?.map((p) => [p.d, p.v]));
    expect(byD.get("Jan 2")).toBeCloseTo(1000);
    expect(byD.get("Jan 3")).toBeCloseTo(1000); // forward-filled, then rebased
    expect(byD.get("Jan 4")).toBeCloseTo((110 / 100) * 1000);
  });

  it("returns null when the series never overlap", () => {
    const portfolio = pf(["Jan 2", 1000], ["Jan 3", 1010]);
    const benchmark = pf(["Feb 1", 100], ["Feb 2", 110]);
    expect(rebaseBenchmark(portfolio, benchmark)).toBeNull();
  });

  it("returns null for empty / missing inputs and a zero base", () => {
    expect(rebaseBenchmark([], pf(["Jan 2", 100]))).toBeNull();
    expect(rebaseBenchmark(pf(["Jan 2", 1000]), null)).toBeNull();
    expect(rebaseBenchmark(pf(["Jan 2", 1000]), [])).toBeNull();
    // Zero benchmark base can't be rebased (division by zero).
    expect(rebaseBenchmark(pf(["Jan 2", 1000]), pf(["Jan 2", 0]))).toBeNull();
  });
});
