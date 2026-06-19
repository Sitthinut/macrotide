import { describe, expect, it } from "vitest";
import type { CashDecomp, SeriesPoint } from "@/lib/static/types";
import { applyCashMode, returnValue, uninvestedCash } from "./cash-mode";

const sp = (pairs: [string, number][]): SeriesPoint[] => pairs.map(([d, v]) => ({ d, v }));

// A book: ฿1,000 invested in funds + ฿500 cash, of which ฿200 reserved.
const decomp: CashDecomp = {
  cashValue: sp([
    ["2026-01-01", 500],
    ["2026-02-01", 500],
  ]),
  reservedCashValue: sp([
    ["2026-01-01", 200],
    ["2026-02-01", 200],
  ]),
  cashContrib: sp([
    ["2026-01-01", 500],
    ["2026-02-01", 500],
  ]),
  reservedCashContrib: sp([
    ["2026-01-01", 200],
    ["2026-02-01", 200],
  ]),
};

const value = sp([
  ["2026-01-01", 1500],
  ["2026-02-01", 1600],
]);
const netInvested = sp([
  ["2026-01-01", 1500],
  ["2026-02-01", 1500],
]);

describe("applyCashMode", () => {
  it("incl. cash keeps non-reserved cash, drops only reserved", () => {
    const { series, netInvested: contrib } = applyCashMode("incl", value, netInvested, decomp);
    // 1600 − 200 reserved = 1400 value; 1500 − 200 reserved = 1300 contrib.
    expect(series.at(-1)?.v).toBe(1400);
    expect(contrib.at(-1)?.v).toBe(1300);
  });

  it("funds only drops ALL cash from both lines", () => {
    const { series, netInvested: contrib } = applyCashMode("funds", value, netInvested, decomp);
    // 1600 − 500 cash = 1100 value; 1500 − 500 cash = 1000 contrib.
    expect(series.at(-1)?.v).toBe(1100);
    expect(contrib.at(-1)?.v).toBe(1000);
  });

  it("passes inputs through unchanged when there's no decomposition", () => {
    const { series, netInvested: contrib } = applyCashMode("funds", value, netInvested, undefined);
    expect(series).toEqual(value);
    expect(contrib).toEqual(netInvested);
  });

  it("treats a missing contribution line as empty", () => {
    const { netInvested: contrib } = applyCashMode("incl", value, undefined, decomp);
    expect(contrib).toEqual([]);
  });
});

describe("returnValue", () => {
  it("removes reserved cash in incl. mode and all cash in funds mode", () => {
    expect(returnValue("incl", 1600, decomp)).toBe(1400);
    expect(returnValue("funds", 1600, decomp)).toBe(1100);
  });
  it("returns the full value when there's no decomposition", () => {
    expect(returnValue("funds", 1600, undefined)).toBe(1600);
  });
});

describe("uninvestedCash", () => {
  it("is all cash minus reserved", () => {
    expect(uninvestedCash(decomp)).toBe(300);
  });
  it("is zero without a decomposition", () => {
    expect(uninvestedCash(undefined)).toBe(0);
  });
});
