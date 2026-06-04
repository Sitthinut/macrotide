import { describe, expect, it } from "vitest";
import { summarizeContributions } from "./contributions";
import type { LedgerTxn } from "./lots";

const A = "EXAMPLE-FUND-A";
const tx = (kind: LedgerTxn["kind"], amount: number, tradeDate: string): LedgerTxn => ({
  ticker: A,
  kind,
  amount,
  tradeDate,
});

describe("summarizeContributions", () => {
  it("aggregates invested / withdrawn per month and overall", () => {
    const s = summarizeContributions([
      tx("buy", -1000, "2024-01-05"),
      tx("buy", -1000, "2024-02-05"),
      tx("sell", 500, "2024-02-20"),
    ]);
    expect(s.months).toHaveLength(2);
    expect(s.months[0]).toMatchObject({
      month: "2024-01",
      invested: 1000,
      withdrawn: 0,
      net: 1000,
    });
    expect(s.months[1]).toMatchObject({
      month: "2024-02",
      invested: 1000,
      withdrawn: 500,
      net: 500,
    });
    expect(s.totalInvested).toBeCloseTo(2000, 6);
    expect(s.totalWithdrawn).toBeCloseTo(500, 6);
    expect(s.averageContribution).toBeCloseTo(1000, 6);
    expect(s.contributionCount).toBe(2);
  });

  it("counts reinvested dividends as contributions", () => {
    const s = summarizeContributions([
      tx("buy", -1000, "2024-01-05"),
      tx("reinvest", -50, "2024-01-20"),
    ]);
    expect(s.totalInvested).toBeCloseTo(1050, 6);
    expect(s.contributionCount).toBe(2);
  });

  it("ignores cash dividends and fees in the contribution series", () => {
    const s = summarizeContributions([
      tx("buy", -1000, "2024-01-05"),
      tx("dividend", 30, "2024-01-10"),
      tx("fee", -20, "2024-01-15"),
    ]);
    expect(s.totalInvested).toBeCloseTo(1000, 6);
    expect(s.contributionCount).toBe(1);
  });

  it("detects a ~monthly cadence as the median gap between contributions", () => {
    const s = summarizeContributions([
      tx("buy", -100, "2024-01-01"),
      tx("buy", -100, "2024-01-31"),
      tx("buy", -100, "2024-03-01"),
    ]);
    // Gaps: 30, 30 → median 30.
    expect(s.cadenceDays).toBe(30);
  });

  it("returns null cadence with fewer than two contributions", () => {
    const s = summarizeContributions([tx("buy", -100, "2024-01-01")]);
    expect(s.cadenceDays).toBeNull();
  });
});
