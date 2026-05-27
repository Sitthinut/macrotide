// Unit tests for lib/market/providers/edgar-nport.ts
//
// Covers the pure logic: NPORT-P XML parsing (the part that historically broke
// when only synthetic data was tested) and the conservative master-name matcher.
// The network fetch (fetchNportHoldings) is validated by live integration check,
// not unit-mocked here.

import { describe, expect, it } from "vitest";
import { EDGAR_FUNDS, matchEdgarFund, parseNportXml } from "./edgar-nport";

// A trimmed but structurally-faithful NPORT-P primary_doc.xml: a header with
// repPdDate, then three holdings — deliberately out of weight order, one
// without an ISIN, one cash-like with cusip N/A — to exercise sort, top-N,
// the isin attribute, and the N/A cusip guard.
const SAMPLE_XML = `<?xml version="1.0"?>
<edgarSubmission>
  <formData>
    <genInfo>
      <repPdDate>2026-01-31</repPdDate>
      <seriesId>S000004310</seriesId>
    </genInfo>
    <invstOrSecs>
      <invstOrSec>
        <name>Apple Inc.</name>
        <title>Apple Inc.</title>
        <cusip>037833100</cusip>
        <identifiers><isin value="US0378331005"/></identifiers>
        <valUSD>500000000.00</valUSD>
        <pctVal>7.25</pctVal>
        <assetCat>EC</assetCat>
      </invstOrSec>
      <invstOrSec>
        <name>NVIDIA Corp</name>
        <title>NVIDIA Corp</title>
        <cusip>67066G104</cusip>
        <identifiers><isin value="US67066G1040"/></identifiers>
        <valUSD>900000000.00</valUSD>
        <pctVal>9.04</pctVal>
        <assetCat>EC</assetCat>
      </invstOrSec>
      <invstOrSec>
        <name>Cash Collateral USD</name>
        <title>Cash Collateral</title>
        <cusip>N/A</cusip>
        <valUSD>1000000.00</valUSD>
        <pctVal>0.02</pctVal>
        <assetCat>STIV</assetCat>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

describe("edgar-nport", () => {
  describe("parseNportXml", () => {
    it("extracts the report-period date", () => {
      expect(parseNportXml(SAMPLE_XML).asOfDate).toBe("2026-01-31");
    });

    it("sorts holdings by weight descending", () => {
      const { holdings } = parseNportXml(SAMPLE_XML);
      expect(holdings.map((h) => h.name)).toEqual([
        "NVIDIA Corp",
        "Apple Inc.",
        "Cash Collateral USD",
      ]);
      expect(holdings[0].weightPct).toBe(9.04);
    });

    it("reads the ISIN attribute and maps the asset-category code", () => {
      const apple = parseNportXml(SAMPLE_XML).holdings.find((h) => h.name === "Apple Inc.");
      expect(apple?.isin).toBe("US0378331005");
      expect(apple?.cusip).toBe("037833100");
      expect(apple?.assetClass).toBe("Equity (common)");
    });

    it("nulls a missing ISIN and an N/A cusip", () => {
      const cash = parseNportXml(SAMPLE_XML).holdings.find((h) => h.name.startsWith("Cash"));
      expect(cash?.isin).toBeNull();
      expect(cash?.cusip).toBeNull();
      expect(cash?.assetClass).toBe("Short-term investment");
    });

    it("honors topN", () => {
      expect(parseNportXml(SAMPLE_XML, 1).holdings).toHaveLength(1);
      expect(parseNportXml(SAMPLE_XML, 1).holdings[0].name).toBe("NVIDIA Corp");
    });

    it("returns an empty result for non-NPORT junk", () => {
      const r = parseNportXml("<html>not a filing</html>");
      expect(r.holdings).toEqual([]);
      expect(r.asOfDate).toBeNull();
    });
  });

  describe("matchEdgarFund", () => {
    it("maps an S&P 500 master name to IVV", () => {
      expect(matchEdgarFund("iShares Core S&P 500 ETF")).toBe("US4642872265");
    });

    it("maps an MSCI ACWI master to ACWI (distinct keyword)", () => {
      expect(matchEdgarFund("iShares MSCI ACWI ETF")).toBe("US4642863926");
    });

    it("maps Invesco QQQ Trust to QQQ but Invesco NASDAQ 100 ETF to QQQM", () => {
      expect(matchEdgarFund("Invesco QQQ Trust, Series 1")).toBe("US46090E1038");
      expect(matchEdgarFund("Invesco NASDAQ 100 ETF")).toBe("US46138G6492");
    });

    it("returns null for masters not in the registry", () => {
      expect(matchEdgarFund("SPDR Gold Trust")).toBeNull();
      expect(matchEdgarFund("iShares Expanded Tech Sector ETF")).toBeNull();
      expect(matchEdgarFund("PIMCO GIS Income Fund")).toBeNull();
    });

    it("is case-insensitive", () => {
      expect(matchEdgarFund("ISHARES MSCI ACWI ETF")).toBe("US4642863926");
    });
  });

  describe("EDGAR_FUNDS registry", () => {
    it("every entry is keyed by its own isin and has a primaryKeyword + ids", () => {
      for (const [key, ref] of Object.entries(EDGAR_FUNDS)) {
        expect(ref.isin, `${key} isin mismatch`).toBe(key);
        expect(ref.primaryKeyword, `${key} missing primaryKeyword`).toBeTruthy();
        expect(ref.cik, `${key} missing cik`).toBeTruthy();
        expect(ref.seriesId, `${key} missing seriesId`).toMatch(/^S\d+$/);
      }
    });
  });
});
