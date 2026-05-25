// Refresh job — enumerate all Thai mutual funds from the SEC and upsert their
// catalog metadata + fee time-series into the local DB.
//
// Design: enumerate → upsert catalog row (always) → if Registered: fetch fees + AUM.
// Idempotent: the underlying upserts key on PK, so re-running is safe.
// Concurrency: p-limit style manual pool (configurable, default 4) so we don't
// hammer the SEC API (5 000 calls / 300 s ceiling; modest concurrency helps).
// Errors per fund are collected and do NOT abort the whole run.
//
// Scope:
//   - Catalog ALL enumerated funds (Registered + IPO + Liquidated + Expired + Canceled).
//   - Fees and AUM are only fetched for Registered funds (~2,300) — IPO data is
//     truncated; inactive funds have no meaningful fee to report.
//   - Inactive/IPO funds leave aum/feeRows undefined to avoid clobbering any
//     existing values with null.

import {
  type FundFeeInsert,
  type FundInsert,
  upsertFund,
  upsertFundFees,
} from "../db/queries/funds";
import {
  classifyDistribution,
  classifyInvestRegion,
  classifyTaxIncentive,
  inferAssetClass,
  shouldFetchFees,
  statusFromSec,
} from "../market/fund-classify";
import { normalizeFeeType } from "../market/fund-fees";
import {
  enumerateFundProfiles,
  fetchFundAum,
  fetchFundFees,
  type SecFundProfile,
} from "../market/providers/sec-thailand";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RefreshFundCatalogOptions {
  /** Cap the number of funds processed. 0 (default) = process all. */
  limit?: number;
  /** Max simultaneous fee-fetch calls. Default 4. */
  concurrency?: number;
  /** Called after each fund is processed (success or failure). */
  onProgress?: (info: {
    index: number;
    total: number;
    projId: string;
    ok: boolean;
    error?: string;
  }) => void;
  /** Injectable fee-fetcher (replaces the real API call in tests). */
  _fetchFees?: typeof fetchFundFees;
  /** Injectable AUM-fetcher (replaces the real API call in tests). */
  _fetchAum?: typeof fetchFundAum;
  /** Injectable profile enumerator (replaces the real API call in tests). */
  _enumerate?: typeof enumerateFundProfiles;
}

export interface RefreshFundCatalogResult {
  fundsSeen: number;
  fundsUpserted: number;
  /** Funds with secStatus === 'Registered' (active + fee data fetched). */
  fundsActive: number;
  /** Funds for which at least one fee row was upserted. */
  fundsWithFees: number;
  feeRowsUpserted: number;
  errors: Array<{ projId: string; error: string }>;
}

// ─── Profile mapper ───────────────────────────────────────────────────────────

function profileToFundInsert(
  p: SecFundProfile,
  aum?: { aum: number; aumDate: string } | null,
): FundInsert {
  const secStatus = p.fund_status ?? null;
  const status = statusFromSec(secStatus);
  const feederMaster = p.feederfund_master_fund ?? null;

  const insert: FundInsert = {
    projId: p.proj_id,
    abbrName: p.proj_abbr_name,
    thaiName: p.proj_name_th ?? null,
    englishName: p.proj_name_en ?? null,
    amcName: p.amc_name ?? null,
    // fundType is not returned by v2; keep null so we don't wipe any existing value.
    fundType: null,
    policyDesc: p.policy_desc ?? null,
    policyDescTh: p.policy_desc ?? null,
    assetClass: inferAssetClass(p.policy_desc),
    managementStyle: p.management_style ?? null,
    taxIncentiveType: classifyTaxIncentive(p.fund_class_tax_incentive_type),
    distributionPolicy: classifyDistribution(p.fund_class_detail),
    investRegion: classifyInvestRegion(p.invest_country_flag),
    isFeederFund: !!feederMaster,
    feederMasterFund: feederMaster,
    isFixedTerm: p.proj_term_flag === "Y",
    initDate: p.init_date ?? null,
    isinCode: p.fund_class_isin_code ?? null,
    secStatus,
    status,
  };

  // Only set AUM fields when we actually fetched them (active funds).
  // Inactive funds leave these undefined so the DB upsert doesn't clobber
  // any previously-stored AUM with null.
  if (aum != null) {
    insert.aum = aum.aum;
    insert.aumDate = aum.aumDate;
  }

  return insert;
}

// ─── Core job ────────────────────────────────────────────────────────────────

/**
 * Enumerate all SEC mutual funds, upsert catalog rows, then for Registered
 * funds fetch their fee time-series + latest AUM and batch-upsert.
 *
 * Returns a summary object. Non-fatal errors (per fund) are collected in
 * `errors`; they do not abort the run.
 */
export async function refreshFundCatalog(
  opts: RefreshFundCatalogOptions = {},
): Promise<RefreshFundCatalogResult> {
  const concurrency = opts.concurrency ?? 4;
  const limitFunds = opts.limit ?? 0;
  const enumerate = opts._enumerate ?? enumerateFundProfiles;
  const getFees = opts._fetchFees ?? fetchFundFees;
  const getAum = opts._fetchAum ?? fetchFundAum;

  // 1. Enumerate all funds (active + inactive).
  const profiles = await enumerate(limitFunds);

  const total = profiles.length;
  let fundsUpserted = 0;
  let fundsActive = 0;
  let fundsWithFees = 0;
  let feeRowsUpserted = 0;
  const errors: Array<{ projId: string; error: string }> = [];

  // 2. Process in a concurrency-capped pool.
  const inFlight = new Set<Promise<void>>();

  async function processOne(p: SecFundProfile, index: number): Promise<void> {
    const projId = p.proj_id;
    try {
      const secStatus = p.fund_status ?? null;
      const fetchEnrichment = shouldFetchFees(secStatus);

      // 2a. For Registered funds: fetch fees + AUM in parallel.
      let feeItems: Awaited<ReturnType<typeof fetchFundFees>> = [];
      let aumResult: Awaited<ReturnType<typeof fetchFundAum>> = null;

      if (fetchEnrichment) {
        fundsActive++;
        [feeItems, aumResult] = await Promise.all([getFees(projId), getAum(projId)]);
      }

      // 2b. Upsert catalog row (always — active and inactive).
      upsertFund(profileToFundInsert(p, aumResult));
      fundsUpserted++;

      // 2c. Upsert fees (only when we fetched them).
      if (feeItems.length > 0) {
        const feeRows: FundFeeInsert[] = feeItems.map((item) => ({
          projId: item.proj_id,
          fundClassName: item.fund_class_name,
          feeType: normalizeFeeType(item.fee_type_desc),
          feeTypeRaw: item.fee_type_desc,
          rateCeilingPct: item.rate ?? null,
          actualRatePct: item.actual_value ?? null,
          periodStart: item.start_date,
          periodEnd: item.end_date ?? null,
          prospectusType: item.prospectus_type ?? null,
          lastUpdDate: item.last_upd_date ?? null,
        }));
        upsertFundFees(feeRows);
        feeRowsUpserted += feeRows.length;
        fundsWithFees++;
      }

      opts.onProgress?.({ index, total, projId, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ projId, error: msg });
      opts.onProgress?.({ index, total, projId, ok: false, error: msg });
    }
  }

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];

    // Drain one slot if at capacity.
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }

    const task = processOne(p, i).finally(() => {
      inFlight.delete(task);
    });
    inFlight.add(task);
  }

  // Wait for remaining in-flight tasks.
  await Promise.all(inFlight);

  return {
    fundsSeen: total,
    fundsUpserted,
    fundsActive,
    fundsWithFees,
    feeRowsUpserted,
    errors,
  };
}
