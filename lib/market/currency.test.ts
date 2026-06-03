import { describe, expect, it } from "vitest";
import { BASE_CURRENCY, inferHoldingCurrency } from "./currency";

describe("inferHoldingCurrency", () => {
  it("treats every Thai mutual fund as THB regardless of ticker shape", () => {
    expect(inferHoldingCurrency("thai_mutual_fund", "EXAMPLE-FUND-A")).toBe("THB");
    expect(inferHoldingCurrency("thai_mutual_fund", "EXAMPLE-EQ-SSF")).toBe("THB");
  });

  it("maps Yahoo exchange suffixes to the listing currency", () => {
    expect(inferHoldingCurrency("yahoo", "PTT.BK")).toBe("THB"); // Bangkok
    expect(inferHoldingCurrency("yahoo", "^SET.BK")).toBe("THB"); // SET index
    expect(inferHoldingCurrency("yahoo", "7203.T")).toBe("JPY"); // Tokyo
    expect(inferHoldingCurrency("yahoo", "0700.HK")).toBe("HKD"); // Hong Kong
    expect(inferHoldingCurrency("yahoo", "VWRL.L")).toBe("GBP"); // London
    expect(inferHoldingCurrency("yahoo", "EXS1.DE")).toBe("EUR"); // Xetra
  });

  it("maps known non-suffixed index symbols", () => {
    expect(inferHoldingCurrency("yahoo", "^N225")).toBe("JPY"); // Nikkei
    expect(inferHoldingCurrency("yahoo", "^HSI")).toBe("HKD"); // Hang Seng
    expect(inferHoldingCurrency("yahoo", "^FTSE")).toBe("GBP");
  });

  it("defaults bare US tickers and US-index carets to USD", () => {
    expect(inferHoldingCurrency("yahoo", "VOO")).toBe("USD");
    expect(inferHoldingCurrency("yahoo", "ACWI")).toBe("USD");
    expect(inferHoldingCurrency("yahoo", "^GSPC")).toBe("USD");
    expect(inferHoldingCurrency("yahoo", "^NDX")).toBe("USD");
    expect(inferHoldingCurrency("yahoo", "GC=F")).toBe("USD"); // gold spot
  });

  it("degrades an unknown symbol to USD, not to THB", () => {
    // Falling back to USD is the honest default — the dominant foreign case —
    // rather than silently treating a foreign holding as already-baht.
    expect(inferHoldingCurrency("yahoo", "MYSTERY")).toBe("USD");
  });

  it("is case-insensitive on the ticker", () => {
    expect(inferHoldingCurrency("yahoo", "ptt.bk")).toBe("THB");
  });

  it("exposes THB as the base currency", () => {
    expect(BASE_CURRENCY).toBe("THB");
  });
});
