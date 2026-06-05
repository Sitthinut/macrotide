// Tests for the catalog TRANSFORM (the API-free half of the ELT crawl).
//
// Two layers:
//   1. Pure mapper tests — profileToFundInsert / feeItemToFeeRow turn a raw SEC
//      item into an insert shape. This is where SEC fields become catalog columns
//      (asset class, fee-type normalization, tax/region/feeder), so the
//      classification matrix is asserted here, DB-free.
//   2. Round-trip tests — land raw payloads in sec_raw, run transformFundCatalog,
//      and assert the derived fund_catalog / fund_fees rows (incl. the current_ter
//      cache and the AUM merge). This proves land → transform end to end.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";
import { getMarketDb, runWithDbContext } from "../db/context";
import { getCurrentTer } from "../db/queries/funds";
import { makeSecRaw, SEC_ENDPOINTS, type SecRawInsert, upsertSecRaw } from "../db/queries/sec-raw";
import { fundCatalog } from "../db/schema";
import type { SecFundFeeItem } from "../market/fund-fees";
import type { SecFundProfile } from "../market/providers/sec-thailand";
import {
  type AumSnapshot,
  feeItemToFeeRow,
  profileToFundInsert,
  transformFundCatalog,
} from "./transform-fund-catalog";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const makeProfile = (overrides: Partial<SecFundProfile> = {}): SecFundProfile => ({
  proj_id: "1234",
  proj_abbr_name: "TEST-FUND",
  proj_name_th: "กองทุนทดสอบ",
  proj_name_en: "Test Fund",
  amc_name: "Test AMC",
  fund_status: "Registered",
  policy_desc: "ตราสารทุน", // equity
  management_style: "AM",
  fund_class_tax_incentive_type: null,
  fund_class_detail: "สะสมมูลค่า", // accumulating
  invest_country_flag: "4", // domestic
  feederfund_master_fund: null,
  proj_term_flag: "N",
  init_date: "2010-01-15",
  fund_class_isin_code: "TH1234567890",
  fund_class_name: "main",
  ...overrides,
});

const makeFeeItem = (overrides: Partial<SecFundFeeItem> = {}): SecFundFeeItem => ({
  proj_id: "1234",
  fund_class_name: "main",
  start_date: "2024-01-01",
  end_date: null,
  prospectus_type: "Main",
  fee_type_desc: "Total Fee and Expense",
  rate: 1.5,
  actual_value: 1.2,
  last_upd_date: "2024-06-01",
  ...overrides,
});

/** Land raw rows and run the transform inside a fresh in-memory market.db. */
function transformWith(rows: SecRawInsert[], assert: () => void) {
  return runWithDbContext(makeTestDbContext(), () => {
    upsertSecRaw(rows);
    transformFundCatalog();
    assert();
  });
}

// ─── Pure mapper: profileToFundInsert ───────────────────────────────────────

describe("profileToFundInsert", () => {
  it("maps the core catalog columns from a profile", () => {
    const insert = profileToFundInsert(makeProfile(), {
      aum: 1_500_000_000,
      aumDate: "2026-05-23",
    });
    expect(insert).toMatchObject({
      projId: "1234",
      abbrName: "TEST-FUND",
      thaiName: "กองทุนทดสอบ",
      englishName: "Test Fund",
      amcName: "Test AMC",
      policyDescTh: "ตราสารทุน",
      assetClass: "equity",
      secStatus: "Registered",
      status: "active",
      managementStyle: "AM",
      distributionPolicy: "accumulating",
      investRegion: "domestic",
      isFeederFund: false,
      feederMasterFund: null,
      isFixedTerm: false,
      initDate: "2010-01-15",
      isinCode: "TH1234567890",
      aum: 1_500_000_000,
      aumDate: "2026-05-23",
    });
  });

  it("infers asset class from policy_desc, money market from the name", () => {
    const cases: Array<[string | null, string, string | null]> = [
      ["ตราสารทุน", "กองทุนทดสอบ", "equity"],
      ["ตราสารหนี้", "กองทุนทดสอบ", "bond"],
      ["ตราสารหนี้", "กองทุนเปิดเค ตลาดเงิน", "cash"], // money market → cash, from name
      ["ทรัพย์สินทางเลือก", "กองทุนทดสอบ", "alternative"],
      ["ผสม", "กองทุนทดสอบ", null], // mixed stays null
      [null, "กองทุนทดสอบ", null],
    ];
    for (const [policyDesc, nameTh, expected] of cases) {
      const insert = profileToFundInsert(
        makeProfile({ policy_desc: policyDesc, proj_name_th: nameTh }),
      );
      expect(insert.assetClass).toBe(expected);
    }
  });

  it("maps tax incentive and feeder fields", () => {
    const ssf = profileToFundInsert(
      makeProfile({
        fund_class_tax_incentive_type: "กองทุนรวมเพื่อการออม",
        feederfund_master_fund: "MASTER-GLOBAL",
      }),
    );
    expect(ssf.taxIncentiveType).toBe("SSF");
    expect(ssf.isFeederFund).toBe(true);
    expect(ssf.feederMasterFund).toBe("MASTER-GLOBAL");

    const rmf = profileToFundInsert(
      makeProfile({ fund_class_tax_incentive_type: "กองทุนรวมเพื่อการเลี้ยงชีพ" }),
    );
    expect(rmf.taxIncentiveType).toBe("RMF");
    expect(rmf.isFeederFund).toBe(false);
  });

  it("derives status from secStatus (IPO active, Liquidated inactive)", () => {
    expect(profileToFundInsert(makeProfile({ fund_status: "IPO" })).status).toBe("active");
    expect(profileToFundInsert(makeProfile({ fund_status: "Liquidated" })).status).toBe("inactive");
  });

  it("leaves AUM fields undefined when no snapshot is given (no clobber)", () => {
    const insert = profileToFundInsert(makeProfile(), null);
    expect(insert.aum).toBeUndefined();
    expect(insert.aumDate).toBeUndefined();
  });

  it("maps null optional fields gracefully", () => {
    const insert = profileToFundInsert(
      makeProfile({
        proj_name_th: null,
        proj_name_en: null,
        amc_name: null,
        policy_desc: null,
        management_style: null,
        fund_class_detail: null,
        invest_country_flag: null,
        init_date: null,
        fund_class_isin_code: null,
      }),
    );
    expect(insert).toMatchObject({
      thaiName: null,
      englishName: null,
      amcName: null,
      policyDescTh: null,
      assetClass: null,
      managementStyle: null,
      taxIncentiveType: null,
      distributionPolicy: null,
      investRegion: null,
      initDate: null,
      isinCode: null,
    });
  });
});

// ─── Pure mapper: feeItemToFeeRow ───────────────────────────────────────────

describe("feeItemToFeeRow", () => {
  it("maps a fee item and keeps the raw type label", () => {
    expect(feeItemToFeeRow(makeFeeItem())).toMatchObject({
      projId: "1234",
      fundClassName: "main",
      feeType: "total_expense",
      feeTypeRaw: "Total Fee and Expense",
      rateCeilingPct: 1.5,
      actualRatePct: 1.2,
      periodStart: "2024-01-01",
      periodEnd: null,
      prospectusType: "Main",
      lastUpdDate: "2024-06-01",
    });
  });

  it("normalizes the SEC fee-type labels", () => {
    const labels: Array<[string, string]> = [
      ["Front-end Fee", "front_end"],
      ["Back-end Fee", "back_end"],
      ["Management Fee", "management"],
      ["ค่าธรรมเนียมและค่าใช้จ่ายรวมทั้งหมด (Total Fee and Expense)", "total_expense"],
      ["Some Unknown Fee Type", "other"],
    ];
    for (const [raw, expected] of labels) {
      expect(feeItemToFeeRow(makeFeeItem({ fee_type_desc: raw })).feeType).toBe(expected);
    }
  });
});

// ─── Round-trip: land raw → transform → derived rows ────────────────────────

describe("transformFundCatalog", () => {
  it("derives a catalog row + fee rows + current_ter from landed raw", () =>
    transformWith(
      [
        makeSecRaw(SEC_ENDPOINTS.profiles, "1234", "", makeProfile()),
        makeSecRaw(SEC_ENDPOINTS.fees, "1234", "", [makeFeeItem()]),
        makeSecRaw(SEC_ENDPOINTS.aum, "1234", "", {
          aum: 1_500_000_000,
          aumDate: "2026-05-23",
        } satisfies AumSnapshot),
      ],
      () => {
        const fund = getMarketDb()
          .select()
          .from(fundCatalog)
          .where(eq(fundCatalog.projId, "1234"))
          .get();
        expect(fund).toMatchObject({
          projId: "1234",
          abbrName: "TEST-FUND",
          assetClass: "equity",
          aum: 1_500_000_000,
          aumDate: "2026-05-23",
          // current_ter cache picks the actual TER rate (1.2), not the ceiling.
          currentTer: 1.2,
        });
        expect(getCurrentTer("1234")).toBe(1.2);
      },
    ));

  it("returns counts and upserts every landed fund", () =>
    transformWith(
      [
        makeSecRaw(SEC_ENDPOINTS.profiles, "R1", "", makeProfile({ proj_id: "R1" })),
        makeSecRaw(SEC_ENDPOINTS.profiles, "R2", "", makeProfile({ proj_id: "R2" })),
        makeSecRaw(SEC_ENDPOINTS.fees, "R1", "", [makeFeeItem({ proj_id: "R1" })]),
      ],
      () => {
        const result = transformFundCatalog(); // idempotent re-run returns the counts
        expect(result.fundsUpserted).toBe(2);
        expect(result.fundsWithFees).toBe(1);
        expect(result.feeRowsUpserted).toBe(1);
      },
    ));

  it("is idempotent — a second transform yields the same single catalog row", () =>
    transformWith([makeSecRaw(SEC_ENDPOINTS.profiles, "1234", "", makeProfile())], () => {
      transformFundCatalog();
      const rows = getMarketDb().select().from(fundCatalog).all();
      expect(rows).toHaveLength(1);
    }));

  it("merges AUM only when landed (inactive fund keeps null)", () =>
    transformWith(
      [
        makeSecRaw(
          SEC_ENDPOINTS.profiles,
          "L1",
          "",
          makeProfile({ proj_id: "L1", fund_status: "Liquidated" }),
        ),
      ],
      () => {
        const fund = getMarketDb().select().from(fundCatalog).all()[0];
        expect(fund.status).toBe("inactive");
        expect(fund.aum).toBeNull();
      },
    ));
});
