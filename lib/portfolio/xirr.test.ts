import { describe, expect, it } from "vitest";
import type { LedgerTxn } from "./lots";
import { type CashFlow, txnsToCashFlows, xirr } from "./xirr";

describe("xirr", () => {
  it("solves a simple one-year +10% round trip", () => {
    const r = xirr([
      { date: "2023-01-01", amount: -1000 },
      { date: "2024-01-01", amount: 1100 },
    ]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(0.1, 4);
  });

  it("solves a one-year doubling (+100%)", () => {
    const r = xirr([
      { date: "2023-01-01", amount: -1000 },
      { date: "2024-01-01", amount: 2000 },
    ]);
    expect(r as number).toBeCloseTo(1.0, 4);
  });

  it("returns null when all flows share a sign (no terminal value yet)", () => {
    expect(
      xirr([
        { date: "2024-01-01", amount: -100 },
        { date: "2024-02-01", amount: -100 },
        { date: "2024-03-01", amount: -100 },
      ]),
    ).toBeNull();
  });

  it("returns null with fewer than two flows", () => {
    expect(xirr([{ date: "2024-01-01", amount: -100 }])).toBeNull();
  });

  it("solves an all-buys-still-holding DCA series once a terminal value is appended", () => {
    const flows: CashFlow[] = [];
    for (let m = 0; m < 12; m++) {
      flows.push({ date: `2023-${String(m + 1).padStart(2, "0")}-01`, amount: -100 });
    }
    // Terminal market value appended by the caller (units × NAV, THB).
    flows.push({ date: "2024-01-01", amount: 1300 });
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0); // gained vs the 1200 invested
    // The returned rate is a genuine root: NPV(r) ≈ 0.
    expect(npv(flows, r as number)).toBeCloseTo(0, 4);
  });

  it("finds the root for an irregular, multi-sign series (Newton or bisection)", () => {
    const flows: CashFlow[] = [
      { date: "2022-01-15", amount: -5000 },
      { date: "2022-07-20", amount: -3000 },
      { date: "2023-02-10", amount: 2000 },
      { date: "2024-03-01", amount: 8000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(npv(flows, r as number)).toBeCloseTo(0, 3);
  });
});

describe("txnsToCashFlows", () => {
  const base = (k: LedgerTxn["kind"], amount: number, tradeDate: string): LedgerTxn => ({
    ticker: "EXAMPLE-FUND-A",
    kind: k,
    amount,
    tradeDate,
  });

  it("excludes reinvest and split (internal, no external cash)", () => {
    const flows = txnsToCashFlows([
      base("buy", -1000, "2024-01-01"),
      base("reinvest", -50, "2024-02-01"),
      base("split", 0, "2024-03-01"),
      base("dividend", 30, "2024-04-01"),
      base("sell", 1200, "2024-05-01"),
    ]);
    expect(flows).toHaveLength(3);
    expect(flows.map((f) => f.amount)).toEqual([-1000, 30, 1200]);
  });

  it("passes amounts through with their existing sign and sorts by date", () => {
    const flows = txnsToCashFlows([
      base("sell", 1200, "2024-05-01"),
      base("buy", -1000, "2024-01-01"),
    ]);
    expect(flows[0].date).toBe("2024-01-01");
    expect(flows[0].amount).toBe(-1000);
  });
});

function npv(flows: CashFlow[], rate: number): number {
  const t0 = Math.floor(Date.parse(flows[0].date) / 86_400_000);
  let sum = 0;
  for (const f of flows) {
    const years = (Math.floor(Date.parse(f.date) / 86_400_000) - t0) / 365;
    sum += f.amount / (1 + rate) ** years;
  }
  return sum;
}
