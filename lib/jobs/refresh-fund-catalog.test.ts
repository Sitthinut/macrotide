// Unit tests for the refresh-fund-catalog job.
//
// Strategy: mock the SEC provider functions (enumerateFundProfiles +
// fetchFundFees + fetchFundAum) and the DB query functions (upsertFund +
// upsertFundFees) so tests run without a real DB or network. All assertions
// are on the transform + orchestration logic.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock the DB query module ─────────────────────────────────────────────────
// Must happen before the job module is imported so the job picks up mocked
// versions when it calls upsertFund / upsertFundFees.

vi.mock("../db/queries/funds", () => ({
  upsertFund: vi.fn(),
  upsertFundFees: vi.fn(),
}));

import { upsertFund, upsertFundFees } from "../db/queries/funds";
import type { SecFundFeeItem } from "../market/fund-fees";
import type { SecFundProfile } from "../market/providers/sec-thailand";
import { refreshFundCatalog } from "./refresh-fund-catalog";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A Registered (active) fund with all new enrichment fields populated. */
const makeProfile = (overrides: Partial<SecFundProfile> = {}): SecFundProfile => ({
  proj_id: "1234",
  proj_abbr_name: "TEST-FUND",
  proj_name_th: "กองทุนทดสอบ",
  proj_name_en: "Test Fund",
  amc_name: "Test AMC",
  fund_status: "Registered",
  policy_desc: "ตราสารทุน", // equity → assetClass: 'equity'
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

const makeAum = () => ({ aum: 1_500_000_000, aumDate: "2026-05-23" });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnumerate(profiles: SecFundProfile[]) {
  return vi.fn().mockResolvedValue(profiles);
}

function makeFetchFees(items: SecFundFeeItem[]) {
  return vi.fn().mockResolvedValue(items);
}

function makeFetchAum(result: { aum: number; aumDate: string } | null = makeAum()) {
  return vi.fn().mockResolvedValue(result);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("refreshFundCatalog", () => {
  beforeEach(() => {
    vi.mocked(upsertFund).mockReset();
    vi.mocked(upsertFundFees).mockReset();
  });

  it("returns zero counts when no profiles are enumerated", async () => {
    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([]),
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(null),
    });

    expect(result).toEqual({
      fundsSeen: 0,
      fundsUpserted: 0,
      fundsActive: 0,
      fundsWithFees: 0,
      feeRowsUpserted: 0,
      errors: [],
    });
    expect(upsertFund).not.toHaveBeenCalled();
    expect(upsertFundFees).not.toHaveBeenCalled();
  });

  it("upserts one Registered fund with fees, AUM, and enrichment columns", async () => {
    const profile = makeProfile();
    const feeItem = makeFeeItem();
    const aum = makeAum();

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([profile]),
      _fetchFees: makeFetchFees([feeItem]),
      _fetchAum: makeFetchAum(aum),
    });

    expect(result.fundsSeen).toBe(1);
    expect(result.fundsUpserted).toBe(1);
    expect(result.fundsActive).toBe(1);
    expect(result.fundsWithFees).toBe(1);
    expect(result.feeRowsUpserted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Check catalog insert shape — new enrichment columns present.
    expect(upsertFund).toHaveBeenCalledOnce();
    expect(upsertFund).toHaveBeenCalledWith(
      expect.objectContaining({
        projId: "1234",
        abbrName: "TEST-FUND",
        thaiName: "กองทุนทดสอบ",
        englishName: "Test Fund",
        amcName: "Test AMC",
        // Asset class now derived from policy_desc (Thai label), NOT fund_type_en.
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
        aum: aum.aum,
        aumDate: aum.aumDate,
      }),
    );

    // Check fee insert shape.
    expect(upsertFundFees).toHaveBeenCalledOnce();
    const feeRows = vi.mocked(upsertFundFees).mock.calls[0][0];
    expect(feeRows).toHaveLength(1);
    expect(feeRows[0]).toMatchObject({
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

  it("normalizes fee types correctly", async () => {
    const profiles = [makeProfile()];
    const feeItems: SecFundFeeItem[] = [
      makeFeeItem({ fee_type_desc: "Front-end Fee" }),
      makeFeeItem({ fee_type_desc: "Back-end Fee", start_date: "2024-01-02" }),
      makeFeeItem({ fee_type_desc: "Management Fee", start_date: "2024-01-03" }),
      makeFeeItem({
        fee_type_desc: "ค่าธรรมเนียมและค่าใช้จ่ายรวมทั้งหมด (Total Fee and Expense)",
        start_date: "2024-01-04",
      }),
      makeFeeItem({ fee_type_desc: "Some Unknown Fee Type", start_date: "2024-01-05" }),
    ];

    await refreshFundCatalog({
      _enumerate: makeEnumerate(profiles),
      _fetchFees: makeFetchFees(feeItems),
      _fetchAum: makeFetchAum(),
    });

    const feeRows = vi.mocked(upsertFundFees).mock.calls[0][0];
    expect(feeRows.map((r: { feeType: string }) => r.feeType)).toEqual([
      "front_end",
      "back_end",
      "management",
      "total_expense",
      "other",
    ]);
  });

  it("infers asset class from policy_desc Thai label (not fund_type_en)", async () => {
    // policy_desc is the Thai asset-type label. fund_type_en does not exist in v2.
    const cases: Array<[string | null, string | null]> = [
      ["ตราสารทุน", "equity"],
      ["ตราสารหนี้", "bond"],
      ["ตลาดเงิน", "cash"],
      ["ทรัพย์สินทางเลือก", "alternative"],
      ["ผสม", null], // mixed — intentionally stays null
      [null, null],
    ];

    for (const [policyDesc, expectedAssetClass] of cases) {
      vi.mocked(upsertFund).mockReset();
      await refreshFundCatalog({
        _enumerate: makeEnumerate([
          makeProfile({ policy_desc: policyDesc, fund_status: "Registered" }),
        ]),
        _fetchFees: makeFetchFees([]),
        _fetchAum: makeFetchAum(null),
      });
      const call = vi.mocked(upsertFund).mock.calls[0][0];
      expect(call.assetClass).toBe(expectedAssetClass);
    }
  });

  it("skips fee + AUM fetch for non-Registered funds and does NOT set aum fields", async () => {
    const fetchFees = vi.fn();
    const fetchAum = vi.fn();

    const inactiveFund = makeProfile({ fund_status: "Liquidated" });
    const ipoFund = makeProfile({ proj_id: "9999", proj_abbr_name: "NEW-IPO", fund_status: "IPO" });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([inactiveFund, ipoFund]),
      _fetchFees: fetchFees,
      _fetchAum: fetchAum,
      concurrency: 1,
    });

    // Neither inactive nor IPO funds trigger API calls.
    expect(fetchFees).not.toHaveBeenCalled();
    expect(fetchAum).not.toHaveBeenCalled();
    expect(upsertFundFees).not.toHaveBeenCalled();

    // Both catalog rows are still upserted.
    expect(result.fundsUpserted).toBe(2);
    expect(result.fundsActive).toBe(0);
    expect(result.fundsWithFees).toBe(0);

    // AUM fields must be absent (undefined) on inactive fund inserts — not null —
    // so the DB upsert leaves any existing AUM intact.
    const calls = vi.mocked(upsertFund).mock.calls;
    for (const [insert] of calls) {
      expect(insert.aum).toBeUndefined();
      expect(insert.aumDate).toBeUndefined();
    }

    // Status correctly derived from secStatus.
    const liquidatedInsert = calls.find(([ins]) => ins.secStatus === "Liquidated")?.[0];
    expect(liquidatedInsert?.status).toBe("inactive");

    // IPO maps to 'active' per statusFromSec contract.
    const ipoInsert = calls.find(([ins]) => ins.secStatus === "IPO")?.[0];
    expect(ipoInsert?.status).toBe("active");
  });

  it("collects per-fund errors and continues processing remaining funds", async () => {
    const profiles = [
      makeProfile({ proj_id: "A", proj_abbr_name: "FUND-A", fund_status: "Registered" }),
      makeProfile({ proj_id: "B", proj_abbr_name: "FUND-B", fund_status: "Registered" }),
      makeProfile({ proj_id: "C", proj_abbr_name: "FUND-C", fund_status: "Registered" }),
    ];

    const fetchFees = vi.fn().mockImplementation((projId: string) => {
      if (projId === "B") return Promise.reject(new Error("network timeout"));
      return Promise.resolve([makeFeeItem({ proj_id: projId })]);
    });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate(profiles),
      _fetchFees: fetchFees,
      _fetchAum: makeFetchAum(),
      concurrency: 1,
    });

    expect(result.fundsSeen).toBe(3);
    expect(result.fundsActive).toBe(3); // all three are Registered
    // B's error is raised during the fee/AUM step; its catalog row is NOT written
    // because the whole processOne block throws after the parallel fetch.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].projId).toBe("B");
    expect(result.errors[0].error).toContain("network timeout");
    expect(result.feeRowsUpserted).toBe(2); // A and C succeed; B errored
  });

  it("skips upsertFundFees when a Registered fund has no fee rows", async () => {
    await refreshFundCatalog({
      _enumerate: makeEnumerate([makeProfile()]),
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(),
    });

    expect(upsertFund).toHaveBeenCalledOnce();
    expect(upsertFundFees).not.toHaveBeenCalled();
    expect(vi.mocked(upsertFund).mock.calls[0][0]).toMatchObject({ projId: "1234" });
  });

  it("calls onProgress for each fund processed", async () => {
    const profiles = [
      makeProfile({ proj_id: "X1", proj_abbr_name: "F1" }),
      makeProfile({ proj_id: "X2", proj_abbr_name: "F2" }),
    ];

    const progressCalls: unknown[] = [];
    await refreshFundCatalog({
      _enumerate: makeEnumerate(profiles),
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(null),
      onProgress: (info) => progressCalls.push(info),
      concurrency: 1,
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toMatchObject({ total: 2, ok: true });
    expect(progressCalls[1]).toMatchObject({ total: 2, ok: true });
  });

  it("passes limit to the enumerate function", async () => {
    const enumerate = makeEnumerate([]);
    await refreshFundCatalog({
      _enumerate: enumerate,
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(null),
      limit: 5,
    });
    expect(enumerate).toHaveBeenCalledWith(5);
  });

  it("handles funds with null optional fields gracefully", async () => {
    const profile = makeProfile({
      proj_name_th: null,
      proj_name_en: null,
      amc_name: null,
      policy_desc: null,
      management_style: null,
      fund_class_tax_incentive_type: null,
      fund_class_detail: null,
      invest_country_flag: null,
      feederfund_master_fund: null,
      proj_term_flag: null,
      init_date: null,
      fund_class_isin_code: null,
    });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([profile]),
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(null),
    });

    expect(result.errors).toHaveLength(0);
    expect(upsertFund).toHaveBeenCalledWith(
      expect.objectContaining({
        thaiName: null,
        englishName: null,
        amcName: null,
        policyDescTh: null,
        assetClass: null,
        managementStyle: null,
        taxIncentiveType: null,
        distributionPolicy: null,
        investRegion: null,
        isFeederFund: false,
        feederMasterFund: null,
        isFixedTerm: false,
        initDate: null,
        isinCode: null,
        // AUM not set (null from fetchAum → we still don't set undefined fields)
      }),
    );
  });

  it("maps tax incentive types and feeder-fund fields correctly", async () => {
    const ssf = makeProfile({
      proj_id: "SSF1",
      fund_class_tax_incentive_type: "กองทุนรวมเพื่อการออม",
      feederfund_master_fund: "MASTER-GLOBAL",
      fund_status: "Registered",
    });
    const rmf = makeProfile({
      proj_id: "RMF1",
      fund_class_tax_incentive_type: "กองทุนรวมเพื่อการเลี้ยงชีพ",
      feederfund_master_fund: null,
      fund_status: "Registered",
    });

    await refreshFundCatalog({
      _enumerate: makeEnumerate([ssf, rmf]),
      _fetchFees: makeFetchFees([]),
      _fetchAum: makeFetchAum(null),
      concurrency: 1,
    });

    const calls = vi.mocked(upsertFund).mock.calls;
    const ssfInsert = calls.find(([ins]) => ins.projId === "SSF1")?.[0];
    expect(ssfInsert?.taxIncentiveType).toBe("SSF");
    expect(ssfInsert?.isFeederFund).toBe(true);
    expect(ssfInsert?.feederMasterFund).toBe("MASTER-GLOBAL");

    const rmfInsert = calls.find(([ins]) => ins.projId === "RMF1")?.[0];
    expect(rmfInsert?.taxIncentiveType).toBe("RMF");
    expect(rmfInsert?.isFeederFund).toBe(false);
  });

  it("result summary reports fundsActive and fundsWithFees separately", async () => {
    // 2 Registered + 1 Liquidated.
    const profiles = [
      makeProfile({ proj_id: "R1", fund_status: "Registered" }),
      makeProfile({ proj_id: "R2", fund_status: "Registered" }),
      makeProfile({ proj_id: "L1", fund_status: "Liquidated" }),
    ];

    const fetchFees = vi.fn().mockImplementation((projId: string) => {
      // R2 has no fee rows.
      if (projId === "R2") return Promise.resolve([]);
      return Promise.resolve([makeFeeItem({ proj_id: projId })]);
    });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate(profiles),
      _fetchFees: fetchFees,
      _fetchAum: makeFetchAum(),
      concurrency: 1,
    });

    expect(result.fundsSeen).toBe(3);
    expect(result.fundsUpserted).toBe(3);
    expect(result.fundsActive).toBe(2); // R1 + R2
    expect(result.fundsWithFees).toBe(1); // only R1 has fee rows
    expect(result.feeRowsUpserted).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});
