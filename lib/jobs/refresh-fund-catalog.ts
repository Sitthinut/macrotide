// Refresh job — enumerate all Thai mutual funds from the SEC and upsert their
// catalog metadata + fee time-series into the local DB.
//
// Design: enumerate → upsert catalog row → fetch fees → batch-upsert fees.
// Idempotent: the underlying upserts key on PK, so re-running is safe.
// Concurrency: p-limit style manual pool (configurable, default 4) so we don't
// hammer the SEC API (5 000 calls / 300 s ceiling; modest concurrency helps).
// Errors per fund are collected and do NOT abort the whole run.

import {
  type FundFeeInsert,
  type FundInsert,
  upsertFund,
  upsertFundFees,
} from "../db/queries/funds";
import { normalizeFeeType } from "../market/fund-fees";
import {
  enumerateFundProfiles,
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
  /** Injectable profile enumerator (replaces the real API call in tests). */
  _enumerate?: typeof enumerateFundProfiles;
}

export interface RefreshFundCatalogResult {
  fundsSeen: number;
  fundsUpserted: number;
  feeRowsUpserted: number;
  errors: Array<{ projId: string; error: string }>;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

/**
 * Best-effort mapping of SEC fund_type_en to our normalized asset class.
 * The SEC type strings are English labels; we do substring matching rather
 * than an exhaustive enum so new types degrade gracefully to null.
 */
function inferAssetClass(fundTypeEn: string | null | undefined): string | null {
  if (!fundTypeEn) return null;
  const t = fundTypeEn.toLowerCase();
  if (t.includes("equity") || t.includes("stock")) return "equity";
  if (t.includes("fixed income") || t.includes("bond") || t.includes("debt")) return "bond";
  if (t.includes("money market") || t.includes("cash")) return "cash";
  if (
    t.includes("alternative") ||
    t.includes("property") ||
    t.includes("commodity") ||
    t.includes("infra")
  )
    return "alternative";
  return null;
}

function profileToFundInsert(p: SecFundProfile): FundInsert {
  return {
    projId: p.proj_id,
    abbrName: p.proj_abbr_name,
    thaiName: p.proj_name_th ?? null,
    englishName: p.proj_name_en ?? null,
    amcName: p.amc_name ?? null,
    fundType: p.fund_type_en ?? p.fund_type_th ?? null,
    policyDesc: p.policy_desc ?? null,
    assetClass: inferAssetClass(p.fund_type_en),
    status: "active",
  };
}

// ─── Core job ────────────────────────────────────────────────────────────────

/**
 * Enumerate all SEC mutual funds, upsert catalog rows, then for each fund
 * fetch its fee time-series and batch-upsert.
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

  // 1. Enumerate
  const profiles = await enumerate(limitFunds);

  const total = profiles.length;
  let fundsUpserted = 0;
  let feeRowsUpserted = 0;
  const errors: Array<{ projId: string; error: string }> = [];

  // 2. Process in a concurrency-capped pool.
  //    We iterate the profiles array and maintain a set of in-flight Promises.
  const inFlight = new Set<Promise<void>>();

  async function processOne(p: SecFundProfile, index: number): Promise<void> {
    const projId = p.proj_id;
    try {
      // 2a. Upsert catalog row
      upsertFund(profileToFundInsert(p));
      fundsUpserted++;

      // 2b. Fetch + upsert fees
      const feeItems = await getFees(projId);
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

    // Drain one slot if at capacity
    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }

    const task = processOne(p, i).finally(() => {
      inFlight.delete(task);
    });
    inFlight.add(task);
  }

  // Wait for remaining in-flight tasks
  await Promise.all(inFlight);

  return {
    fundsSeen: total,
    fundsUpserted,
    feeRowsUpserted,
    errors,
  };
}
