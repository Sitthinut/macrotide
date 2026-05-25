// Unit tests for the refresh-fund-catalog job.
//
// Strategy: mock the SEC provider functions (enumerateFundProfiles +
// fetchFundFees) and the DB query functions (upsertFund + upsertFundFees) so
// tests run without a real DB or network. All assertions are on the transform +
// orchestration logic.

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

const makeProfile = (overrides: Partial<SecFundProfile> = {}): SecFundProfile => ({
  proj_id: "1234",
  proj_abbr_name: "TEST-FUND",
  proj_name_th: "กองทุนทดสอบ",
  proj_name_en: "Test Fund",
  amc_name: "Test AMC",
  fund_type_en: "Equity Fund",
  fund_type_th: null,
  policy_desc: "Invests in equities",
  fund_class_name: "main",
  fund_status: "A",
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEnumerate(profiles: SecFundProfile[]) {
  return vi.fn().mockResolvedValue(profiles);
}

function makeFetchFees(items: SecFundFeeItem[]) {
  return vi.fn().mockResolvedValue(items);
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
    });

    expect(result).toEqual({
      fundsSeen: 0,
      fundsUpserted: 0,
      feeRowsUpserted: 0,
      errors: [],
    });
    expect(upsertFund).not.toHaveBeenCalled();
    expect(upsertFundFees).not.toHaveBeenCalled();
  });

  it("upserts one fund and its fees", async () => {
    const profile = makeProfile();
    const feeItem = makeFeeItem();

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([profile]),
      _fetchFees: makeFetchFees([feeItem]),
    });

    expect(result.fundsSeen).toBe(1);
    expect(result.fundsUpserted).toBe(1);
    expect(result.feeRowsUpserted).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Check catalog insert shape
    expect(upsertFund).toHaveBeenCalledOnce();
    expect(upsertFund).toHaveBeenCalledWith(
      expect.objectContaining({
        projId: "1234",
        abbrName: "TEST-FUND",
        thaiName: "กองทุนทดสอบ",
        englishName: "Test Fund",
        amcName: "Test AMC",
        fundType: "Equity Fund",
        policyDesc: "Invests in equities",
        assetClass: "equity",
        status: "active",
      }),
    );

    // Check fee insert shape
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

  it("infers asset class from fund_type_en", async () => {
    const cases: Array<[string | null, string | null]> = [
      ["Equity Fund", "equity"],
      ["Fixed Income Fund", "bond"],
      ["Money Market Fund", "cash"],
      ["Property and Infrastructure Fund", "alternative"],
      ["Mixed Fund", null],
      [null, null],
    ];

    for (const [fundTypeEn, expectedAssetClass] of cases) {
      vi.mocked(upsertFund).mockReset();
      await refreshFundCatalog({
        _enumerate: makeEnumerate([makeProfile({ fund_type_en: fundTypeEn })]),
        _fetchFees: makeFetchFees([]),
      });
      const call = vi.mocked(upsertFund).mock.calls[0][0];
      expect(call.assetClass).toBe(expectedAssetClass);
    }
  });

  it("collects per-fund errors and continues processing remaining funds", async () => {
    const profiles = [
      makeProfile({ proj_id: "A", proj_abbr_name: "FUND-A" }),
      makeProfile({ proj_id: "B", proj_abbr_name: "FUND-B" }),
      makeProfile({ proj_id: "C", proj_abbr_name: "FUND-C" }),
    ];

    const fetchFees = vi.fn().mockImplementation((projId: string) => {
      if (projId === "B") return Promise.reject(new Error("network timeout"));
      return Promise.resolve([makeFeeItem({ proj_id: projId })]);
    });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate(profiles),
      _fetchFees: fetchFees,
      concurrency: 1,
    });

    expect(result.fundsSeen).toBe(3);
    // All 3 catalog rows are upserted (upsertFund succeeds before fee fetch).
    // B's error is raised during the fee fetch step; the catalog row is still written.
    expect(result.fundsUpserted).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].projId).toBe("B");
    expect(result.errors[0].error).toContain("network timeout");
    expect(result.feeRowsUpserted).toBe(2); // A and C have fees; B's fee fetch failed
  });

  it("skips upsertFundFees when a fund has no fee rows", async () => {
    await refreshFundCatalog({
      _enumerate: makeEnumerate([makeProfile()]),
      _fetchFees: makeFetchFees([]),
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
      onProgress: (info) => progressCalls.push(info),
      concurrency: 1,
    });

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toMatchObject({ total: 2, ok: true });
    expect(progressCalls[1]).toMatchObject({ total: 2, ok: true });
  });

  it("passes limit to the enumerate function", async () => {
    const enumerate = makeEnumerate([]);
    await refreshFundCatalog({ _enumerate: enumerate, _fetchFees: makeFetchFees([]), limit: 5 });
    expect(enumerate).toHaveBeenCalledWith(5);
  });

  it("handles funds with null optional fields gracefully", async () => {
    const profile = makeProfile({
      proj_name_th: null,
      proj_name_en: null,
      amc_name: null,
      fund_type_en: null,
      fund_type_th: null,
      policy_desc: null,
    });

    const result = await refreshFundCatalog({
      _enumerate: makeEnumerate([profile]),
      _fetchFees: makeFetchFees([]),
    });

    expect(result.errors).toHaveLength(0);
    expect(upsertFund).toHaveBeenCalledWith(
      expect.objectContaining({
        thaiName: null,
        englishName: null,
        amcName: null,
        fundType: null,
        policyDesc: null,
        assetClass: null,
      }),
    );
  });
});
