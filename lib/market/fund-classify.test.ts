import { describe, expect, it } from "vitest";
import {
  assetClassFromRiskSpectrum,
  classifyDistribution,
  classifyInvestorType,
  classifyInvestRegion,
  classifyTaxIncentive,
  deriveAssetClass,
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
  });
  it("returns null for mixed and unknown", () => {
    expect(inferAssetClass("ผสม")).toBeNull();
    expect(inferAssetClass("")).toBeNull();
    expect(inferAssetClass(null)).toBeNull();
  });
  it("recovers money market as cash from the fund name (policy_desc says bond)", () => {
    // The SEC's policy_desc has no money-market value — every money-market fund
    // is labelled ตราสารหนี้ (bond). The fund NAME carries the money-market
    // marker (Thai ตลาดเงิน or English "money market"), and that must win over
    // the bond policy label. Some funds spell it only one way.
    expect(inferAssetClass("ตราสารหนี้", "กองทุนเปิดเค ตลาดเงิน")).toBe("cash");
    expect(inferAssetClass("ตราสารหนี้", "กองทุนเปิดไทยพาณิชย์ตราสารรัฐตลาดเงิน")).toBe("cash");
    // English-only marker (Thai name uses a transliteration, not ตลาดเงิน)
    expect(inferAssetClass("ตราสารหนี้", "กองทุนเปิด ดาโอ มันนี่ มาร์เก็ต", "DAOL Money Market Fund")).toBe(
      "cash",
    );
  });
  it("ignores the name for non-money-market funds (no false positives)", () => {
    expect(inferAssetClass("ตราสารทุน", "กองทุนเปิดหุ้นไทย", "K Thai Equity Fund")).toBe("equity");
    expect(inferAssetClass("ตราสารหนี้", "กองทุนเปิดตราสารหนี้ระยะสั้น", "Short Term Bond")).toBe("bond");
  });
});

describe("assetClassFromRiskSpectrum", () => {
  it("maps the clean risk codes to an asset class", () => {
    expect(assetClassFromRiskSpectrum("RS1")).toBe("cash");
    expect(assetClassFromRiskSpectrum("RS2")).toBe("cash");
    expect(assetClassFromRiskSpectrum("RS3")).toBe("bond");
    expect(assetClassFromRiskSpectrum("RS4")).toBe("bond");
    expect(assetClassFromRiskSpectrum("RS6")).toBe("equity");
    expect(assetClassFromRiskSpectrum("RS7")).toBe("equity");
    expect(assetClassFromRiskSpectrum("RS8")).toBe("alternative");
  });

  it("returns undefined (defer to fallback) for ambiguous / unknown codes", () => {
    // RS5 mixes balanced + high-yield-bond funds; RS81/RS8+ are complex.
    expect(assetClassFromRiskSpectrum("RS5")).toBeUndefined();
    expect(assetClassFromRiskSpectrum("RS81")).toBeUndefined();
    expect(assetClassFromRiskSpectrum("RS8+")).toBeUndefined();
    expect(assetClassFromRiskSpectrum("RS99")).toBeUndefined();
    expect(assetClassFromRiskSpectrum(null)).toBeUndefined();
    expect(assetClassFromRiskSpectrum(undefined)).toBeUndefined();
  });
});

describe("deriveAssetClass", () => {
  it("uses the risk spectrum first, overriding the policy label", () => {
    // policy says bond, RS1 says money market → cash wins.
    expect(deriveAssetClass("RS1", "ตราสารหนี้")).toBe("cash");
    // policy is blank, RS6 recovers equity.
    expect(deriveAssetClass("RS6", null)).toBe("equity");
  });

  it("falls back to policy / name when the RS code is ambiguous or absent", () => {
    // RS5 → defer: policy (bond) decides.
    expect(deriveAssetClass("RS5", "ตราสารหนี้")).toBe("bond");
    // No RS code → policy label.
    expect(deriveAssetClass(null, "ตราสารทุน")).toBe("equity");
    // No RS, no useful policy, but the money-market name match still fires.
    expect(deriveAssetClass(undefined, "ตราสารหนี้", "กองทุนเปิดเค ตลาดเงิน")).toBe("cash");
    // Nothing to go on → null.
    expect(deriveAssetClass(undefined, "ผสม")).toBeNull();
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

describe("classifyInvestorType", () => {
  it("defaults a bare/absent detail to retail (single-class 'main' funds)", () => {
    expect(classifyInvestorType(null)).toBe("retail");
    expect(classifyInvestorType("")).toBe("retail");
  });

  it("classifies the general public as retail", () => {
    expect(classifyInvestorType("ชนิดเพื่อผู้ลงทุนทั่วไป")).toBe("retail");
  });

  it("tags provident/private/special-group classes as restricted (down-ranked, not hidden)", () => {
    expect(classifyInvestorType("ชนิดผู้ลงทุนกลุ่ม/บุคคล")).toBe("restricted");
    expect(classifyInvestorType("ชนิดผู้ลงทุนกลุ่ม")).toBe("restricted");
    expect(classifyInvestorType("ชนิดผู้ลงทุนกลุ่มพิเศษ(สะสมมูลค่า)")).toBe("restricted");
    expect(classifyInvestorType("ชนิดผู้ลงทุนพิเศษ")).toBe("restricted");
  });

  it("tags unit-linked classes as insurance via ควบประกัน", () => {
    expect(classifyInvestorType("ชนิดควบประกัน")).toBe("insurance");
    expect(classifyInvestorType("ชนิดสะสมมูลค่า สำหรับผู้ที่ลงทุนในกรมธรรม์ประกันชีวิตควบหน่วยลงทุน")).toBe(
      "insurance",
    );
  });

  it("classifies institutional", () => {
    expect(classifyInvestorType("สำหรับผู้ลงทุนสถาบัน")).toBe("institutional");
  });

  it("lets general-public availability win over an insurance/group channel (dual-purpose RU class)", () => {
    // Offered to ทั่วไป AND via unit-linked policy → retail-buyable, not hidden.
    expect(
      classifyInvestorType(
        "หน่วยลงทุนชนิดไม่จ่ายปันผล สำหรับผู้ลงทุนทั่วไป หรือกรมธรรม์ประกันชีวิตควบหน่วยลงทุน (RU)",
      ),
    ).toBe("retail");
  });

  it("does NOT match bare 'ประกัน' — a class that explicitly has NO insurance benefit stays unclassified", () => {
    expect(classifyInvestorType("ชนิดรับซื้อคืนอัตโนมัติและไม่มีสิทธิประโยชน์ประกัน")).toBeNull();
  });

  it("leaves an unrecognized distribution/channel detail null (kept, neither hidden nor mislabeled)", () => {
    expect(classifyInvestorType("ชนิดจ่ายเงินปันผล")).toBeNull();
    expect(classifyInvestorType("ชนิดช่องทางอิเล็กทรอนิกส์")).toBeNull();
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
