import { describe, expect, it } from "vitest";
import {
  classifyDistribution,
  classifyInvestRegion,
  classifyTaxIncentive,
  inferAssetClass,
  isIndexStyle,
  shouldFetchFees,
  statusFromSec,
} from "./fund-classify";

describe("statusFromSec", () => {
  it("maps Registered and IPO to active, everything else inactive", () => {
    expect(statusFromSec("Registered")).toBe("active");
    expect(statusFromSec("IPO")).toBe("active");
    expect(statusFromSec("Liquidated")).toBe("inactive");
    expect(statusFromSec("Expired")).toBe("inactive");
    expect(statusFromSec("Canceled")).toBe("inactive");
    expect(statusFromSec(null)).toBe("inactive");
  });
});

describe("shouldFetchFees", () => {
  it("only fetches fees for Registered funds", () => {
    expect(shouldFetchFees("Registered")).toBe(true);
    expect(shouldFetchFees("IPO")).toBe(false); // truncated fee JSON until live
    expect(shouldFetchFees("Liquidated")).toBe(false);
  });
});

describe("inferAssetClass", () => {
  it("maps Thai policy labels to normalized classes", () => {
    expect(inferAssetClass("ตราสารหนี้")).toBe("bond");
    expect(inferAssetClass("ตราสารทุน")).toBe("equity");
    expect(inferAssetClass("ทรัพย์สินทางเลือก")).toBe("alternative");
    expect(inferAssetClass("ตลาดเงิน")).toBe("cash");
  });
  it("returns null for mixed and unknown", () => {
    expect(inferAssetClass("ผสม")).toBeNull();
    expect(inferAssetClass("")).toBeNull();
    expect(inferAssetClass(null)).toBeNull();
  });
  it("matches money market before fixed income", () => {
    // a label that contains both should resolve to cash via ordering
    expect(inferAssetClass("ตลาดเงิน (ตราสารหนี้ระยะสั้น)")).toBe("cash");
  });
});

describe("isIndexStyle", () => {
  it("treats PN and PM as index/passive", () => {
    expect(isIndexStyle("PN")).toBe(true);
    expect(isIndexStyle("PM")).toBe(true);
    expect(isIndexStyle("AM")).toBe(false);
    expect(isIndexStyle(null)).toBe(false);
  });
});

describe("classifyTaxIncentive", () => {
  it("maps Thai wrapper labels", () => {
    expect(classifyTaxIncentive("กองทุนรวมเพื่อการออม")).toBe("SSF");
    expect(classifyTaxIncentive("กองทุนรวมไทยเพื่อความยั่งยืน")).toBe("ThaiESG");
    expect(classifyTaxIncentive("กองทุนรวมเพื่อการเลี้ยงชีพ")).toBe("RMF");
    expect(classifyTaxIncentive(null)).toBeNull();
  });
});

describe("classifyDistribution", () => {
  it("maps accumulating vs dividend share classes", () => {
    expect(classifyDistribution("ชนิดสะสมมูลค่า")).toBe("accumulating");
    expect(classifyDistribution("ชนิดจ่ายเงินปันผล")).toBe("dividend");
    expect(classifyDistribution("ชนิดผู้ลงทุนสถาบัน")).toBeNull();
  });
});

describe("classifyInvestRegion", () => {
  it("maps the invest_country_flag codes", () => {
    expect(classifyInvestRegion("1")).toBe("foreign");
    expect(classifyInvestRegion("3")).toBe("mixed");
    expect(classifyInvestRegion("4")).toBe("domestic");
    expect(classifyInvestRegion("9")).toBeNull();
  });
});
