import { afterEach, describe, expect, it } from "vitest";
import { listProviders, resolveProvider, resolveProviderChain } from "./registry";

describe("resolveProvider", () => {
  it("routes yahoo source → yahoo provider", () => {
    expect(resolveProvider("yahoo", "AAPL").id).toBe("yahoo");
    expect(resolveProvider("yahoo", "^GSPC").id).toBe("yahoo");
    expect(resolveProvider("yahoo", "PTT.BK").id).toBe("yahoo");
  });

  it("routes thai_mutual_fund source → sec-thailand provider", () => {
    expect(resolveProvider("thai_mutual_fund", "K-FIXED-A").id).toBe("sec-thailand");
    expect(resolveProvider("thai_mutual_fund", "SCBS&P500").id).toBe("sec-thailand");
  });

  it("throws for an unknown source", () => {
    expect(() => resolveProvider("alpaca", "AAPL")).toThrow(/No provider matches/);
  });

  it("ships both yahoo and sec-thailand providers", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toContain("yahoo");
    expect(ids).toContain("sec-thailand");
  });

  it("ships the real-index providers (fmp, eodhd) ahead of twelvedata", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toContain("fmp");
    expect(ids).toContain("eodhd");
    expect(ids).toContain("twelvedata");
    expect(ids.indexOf("fmp")).toBeLessThan(ids.indexOf("eodhd"));
    expect(ids.indexOf("eodhd")).toBeLessThan(ids.indexOf("twelvedata"));
  });
});

describe("resolveProviderChain — key gating / graceful fallback", () => {
  afterEach(() => {
    delete process.env.FMP_API_KEY;
    delete process.env.EODHD_API_KEY;
    delete process.env.TWELVE_DATA_API_KEY;
  });

  it("with no keys, a real-index symbol only matches the keyless Yahoo fallback", () => {
    const ids = resolveProviderChain("yahoo", "^GSPC").map((p) => p.id);
    expect(ids).toEqual(["yahoo"]);
  });

  it("prefers FMP → EODHD → twelvedata → yahoo for a US index when all keys are set", () => {
    process.env.FMP_API_KEY = "k";
    process.env.EODHD_API_KEY = "k";
    process.env.TWELVE_DATA_API_KEY = "k";
    const ids = resolveProviderChain("yahoo", "^GSPC").map((p) => p.id);
    expect(ids).toEqual(["fmp", "eodhd", "twelvedata", "yahoo"]);
  });

  it("routes the Thai SET index through EODHD (FMP does not cover it)", () => {
    process.env.FMP_API_KEY = "k";
    process.env.EODHD_API_KEY = "k";
    process.env.TWELVE_DATA_API_KEY = "k";
    const ids = resolveProviderChain("yahoo", "^SET.BK").map((p) => p.id);
    expect(ids).toEqual(["eodhd", "twelvedata", "yahoo"]);
  });
});
