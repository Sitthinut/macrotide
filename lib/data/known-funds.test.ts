import { describe, expect, it } from "vitest";
import {
  filterKnownTickers,
  KNOWN_TICKERS,
  mergeWithHoldings,
  type TickerSuggestion,
} from "./known-funds";

const sample: TickerSuggestion[] = [
  { ticker: "K-FIXED-A", name: "K Fixed Income Fund — A", quote_source: "thai_mutual_fund" },
  { ticker: "K-USA-A(A)", name: "K USA Equity Fund — A (Accum.)", quote_source: "thai_mutual_fund" },
  { ticker: "AAPL", name: "Apple Inc.", quote_source: "market" },
  { ticker: "MSFT", name: "Microsoft Corporation", quote_source: "market" },
  { ticker: "^GSPC", name: "S&P 500 Index", quote_source: "market" },
];

describe("filterKnownTickers", () => {
  it("returns the input unchanged (up to limit) on empty query", () => {
    expect(filterKnownTickers(sample, "")).toEqual(sample);
    expect(filterKnownTickers(sample, "   ")).toEqual(sample);
  });

  it("matches case-insensitively on ticker", () => {
    const out = filterKnownTickers(sample, "aapl");
    expect(out.map((e) => e.ticker)).toContain("AAPL");
  });

  it("matches case-insensitively on name", () => {
    const out = filterKnownTickers(sample, "apple");
    expect(out.map((e) => e.ticker)).toContain("AAPL");
  });

  it("matches partial ticker substrings", () => {
    const out = filterKnownTickers(sample, "FIXED");
    expect(out.map((e) => e.ticker)).toContain("K-FIXED-A");
  });

  it("ranks ticker-prefix matches above name-substring matches", () => {
    // Query "K" — prefix-matches K-FIXED-A and K-USA-A(A); also substring in
    // none of the other names. Both ticker-prefix entries should rank before
    // any name-only matches.
    const out = filterKnownTickers(sample, "K");
    expect(out[0].ticker.startsWith("K")).toBe(true);
    expect(out[1].ticker.startsWith("K")).toBe(true);
  });

  it("honours the limit parameter", () => {
    expect(filterKnownTickers(sample, "", 2)).toHaveLength(2);
    expect(filterKnownTickers(sample, "a", 1)).toHaveLength(1);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterKnownTickers(sample, "zzz-nonexistent")).toEqual([]);
  });

  it("surfaces holdings entries ahead of static entries within the same match tier", () => {
    const list: TickerSuggestion[] = [
      { ticker: "AAPL", name: "Apple Inc.", quote_source: "market" },
      { ticker: "APPLE-FUND", name: "Apple Fund", quote_source: "thai_mutual_fund", fromHoldings: true },
    ];
    const out = filterKnownTickers(list, "apple");
    expect(out[0].ticker).toBe("APPLE-FUND");
  });
});

describe("mergeWithHoldings", () => {
  it("returns the static list when no holdings are provided", () => {
    const out = mergeWithHoldings([]);
    expect(out).toHaveLength(KNOWN_TICKERS.length);
    expect(out.every((e) => e.fromHoldings !== true)).toBe(true);
  });

  it("places holdings entries before the static list", () => {
    const out = mergeWithHoldings([
      { ticker: "MY-FUND", englishName: "My Custom Fund", quoteSource: "thai_mutual_fund" },
    ]);
    expect(out[0]).toMatchObject({
      ticker: "MY-FUND",
      name: "My Custom Fund",
      quote_source: "thai_mutual_fund",
      fromHoldings: true,
    });
  });

  it("dedupes when a holding ticker also appears in the static list", () => {
    const out = mergeWithHoldings([
      { ticker: "AAPL", englishName: "Apple (my entry)", quoteSource: "market" },
    ]);
    const apples = out.filter((e) => e.ticker.toUpperCase() === "AAPL");
    expect(apples).toHaveLength(1);
    expect(apples[0].name).toBe("Apple (my entry)");
    expect(apples[0].fromHoldings).toBe(true);
  });

  it("dedupes duplicate holdings tickers (case-insensitive)", () => {
    const out = mergeWithHoldings([
      { ticker: "K-FIXED-A", englishName: "First", quoteSource: "thai_mutual_fund" },
      { ticker: "k-fixed-a", englishName: "Second", quoteSource: "thai_mutual_fund" },
    ]);
    const matches = out.filter((e) => e.ticker.toUpperCase() === "K-FIXED-A");
    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe("First");
  });

  it("narrows unrecognised quote_source values to market", () => {
    const out = mergeWithHoldings([
      { ticker: "WEIRD", englishName: "Weird", quoteSource: "something-else" },
    ]);
    expect(out[0].quote_source).toBe("market");
  });
});
