// Contract for the pure fee-check presentation logic (#74 §5): severity order,
// top-N split, the "N more" count, and the calm summary line. No DB, no React.

import { describe, expect, it } from "vitest";
import {
  FEE_CHECK_TOP_N,
  feeCheckSummary,
  orderFeeChecks,
  presentFeeChecks,
} from "./fee-creep-presentation";

function f(heldTicker: string, savingsPp: number) {
  return { heldTicker, savingsPp };
}

describe("orderFeeChecks", () => {
  it("orders by biggest saving first (most wasted fee)", () => {
    const out = orderFeeChecks([f("A", 0.1), f("B", 0.9), f("C", 0.5)]);
    expect(out.map((x) => x.heldTicker)).toEqual(["B", "C", "A"]);
  });

  it("breaks ties on ticker for a stable order", () => {
    const out = orderFeeChecks([f("Z", 0.5), f("A", 0.5), f("M", 0.5)]);
    expect(out.map((x) => x.heldTicker)).toEqual(["A", "M", "Z"]);
  });

  it("does not mutate the input", () => {
    const input = [f("A", 0.1), f("B", 0.9)];
    orderFeeChecks(input);
    expect(input.map((x) => x.heldTicker)).toEqual(["A", "B"]);
  });
});

describe("feeCheckSummary", () => {
  it("is empty when there are no findings", () => {
    expect(feeCheckSummary(0)).toBe("");
    expect(feeCheckSummary(-1)).toBe("");
  });

  it("is singular for one and has no deadline language", () => {
    const s = feeCheckSummary(1);
    expect(s).toContain("One fund");
    expect(s).toContain("review when you have time");
    expect(s).not.toMatch(/to-do|deadline|now|urgent/i);
  });

  it("is plural with a count for several", () => {
    expect(feeCheckSummary(4)).toBe(
      "4 funds have cheaper equivalents — review when you have time.",
    );
  });
});

describe("presentFeeChecks", () => {
  it("shows the top N as full cards and tucks the rest behind 'N more'", () => {
    const findings = Array.from(
      { length: 7 },
      (_, i) => f(`T${i}`, (7 - i) / 10), // T0=0.7 … T6=0.1 (already severity-descending)
    );
    const view = presentFeeChecks(findings);
    expect(view.top).toHaveLength(FEE_CHECK_TOP_N);
    expect(view.top.map((x) => x.heldTicker)).toEqual(["T0", "T1", "T2"]);
    expect(view.moreCount).toBe(7 - FEE_CHECK_TOP_N);
    expect(view.rest).toHaveLength(view.moreCount);
    expect(view.summary).toBe(feeCheckSummary(7));
  });

  it("has no tail when findings fit within top N", () => {
    const view = presentFeeChecks([f("A", 0.9), f("B", 0.2)]);
    expect(view.top).toHaveLength(2);
    expect(view.rest).toEqual([]);
    expect(view.moreCount).toBe(0);
  });

  it("respects a custom topN", () => {
    const view = presentFeeChecks([f("A", 0.9), f("B", 0.5), f("C", 0.2)], 1);
    expect(view.top.map((x) => x.heldTicker)).toEqual(["A"]);
    expect(view.moreCount).toBe(2);
  });

  it("returns an empty view for no findings", () => {
    const view = presentFeeChecks([]);
    expect(view.top).toEqual([]);
    expect(view.rest).toEqual([]);
    expect(view.moreCount).toBe(0);
    expect(view.summary).toBe("");
  });
});
