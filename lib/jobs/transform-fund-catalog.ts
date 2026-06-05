// Transform — the API-free half of the ELT crawl. Reads verbatim SEC payloads
// landed in `sec_raw` (by the land phase of refresh-fund-catalog) and derives the
// normalized `fund_catalog` + `fund_fees` rows. No network, no SEC key: it runs
// over local rows in seconds, so a classification change ships as a transform
// re-run (`npm run jobs:transform-catalog`), not an ~80-min re-crawl.
//
// The mappers below are pure (raw item → insert shape) and are the single place
// SEC fields become catalog columns — shared by the live crawl and the re-run.
//
// Scope: catalog + fees. Share classes (fund_share_classes) remain their own job
// (refresh-share-classes) — it reads the fund_fees this transform writes.

import {
  type FundFeeInsert,
  type FundInsert,
  upsertFund,
  upsertFundFees,
} from "../db/queries/funds";
import { readSecRaw, readSecRawItems, SEC_ENDPOINTS } from "../db/queries/sec-raw";
import {
  classifyDistribution,
  classifyInvestRegion,
  classifyTaxIncentive,
  deriveAssetClass,
  statusFromSec,
} from "../market/fund-classify";
import { normalizeFeeType, type SecFundFeeItem } from "../market/fund-fees";
import type { SecFundProfile, SecRiskSpectrumItem } from "../market/providers/sec-thailand";
import { invalidateFundIndex } from "../search/fund-index";

// ─── Pure mappers (raw SEC item → catalog insert shape) ─────────────────────

/** AUM snapshot as landed under the `aum` endpoint (our derived shape, not raw SEC). */
export interface AumSnapshot {
  aum: number;
  aumDate: string;
}

/**
 * Map a verbatim SEC profile (+ optional AUM snapshot + risk-spectrum code) to a
 * `fund_catalog` row. This is where the SEC's fields become our normalized
 * taxonomy. Asset class is risk-spectrum-first (the structured signal), falling
 * back to policy_desc + the money-market name match; pass `rsCode = undefined`
 * (no landed risk-spectrum) to use the fallback alone.
 *
 * AUM is set only when present (active funds): inactive funds land no AUM, so the
 * field stays undefined and the upsert leaves any existing value intact.
 */
export function profileToFundInsert(
  p: SecFundProfile,
  aum?: AumSnapshot | null,
  rsCode?: string | null,
): FundInsert {
  const secStatus = p.fund_status ?? null;
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
    assetClass: deriveAssetClass(rsCode, p.policy_desc, p.proj_name_th, p.proj_name_en),
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
    status: statusFromSec(secStatus),
    projRetailType: p.proj_retail_type ?? null,
  };

  if (aum != null) {
    insert.aum = aum.aum;
    insert.aumDate = aum.aumDate;
  }

  return insert;
}

/** Map a verbatim SEC fee item to a `fund_fees` row (normalizing the fee type). */
export function feeItemToFeeRow(item: SecFundFeeItem): FundFeeInsert {
  return {
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
  };
}

// ─── Transform job ──────────────────────────────────────────────────────────

export interface TransformFundCatalogResult {
  /** Distinct funds whose catalog row was (re)derived from landed profiles. */
  fundsUpserted: number;
  /** Funds that had at least one landed fee row. */
  fundsWithFees: number;
  /** Total fee rows derived and upserted. */
  feeRowsUpserted: number;
}

/**
 * Derive `fund_catalog` + `fund_fees` from the landed raw payloads in `sec_raw`.
 * Idempotent and API-free: safe to re-run any time to apply a mapper change to
 * the whole universe without touching the SEC API.
 *
 * Order matters for the FK + the derived TER cache: catalog rows first (fees
 * reference fund_catalog), then fees (whose upsert recomputes current_ter).
 */
export function transformFundCatalog(): TransformFundCatalogResult {
  // AUM snapshots first, keyed by projId, so the catalog mapping can merge them.
  const aumByProj = new Map<string, AumSnapshot>();
  for (const row of readSecRaw(SEC_ENDPOINTS.aum)) {
    try {
      aumByProj.set(row.projId, JSON.parse(row.payload) as AumSnapshot);
    } catch {
      // Skip an unparseable AUM row; the fund just keeps its prior AUM.
    }
  }

  // Latest risk-spectrum code per fund — the primary asset-class signal.
  const rsByProj = new Map<string, string>();
  for (const it of readSecRawItems<SecRiskSpectrumItem>(SEC_ENDPOINTS.riskSpectrum)) {
    if (it.proj_id && it.risk_spectrum) rsByProj.set(it.proj_id, it.risk_spectrum);
  }

  // 1. Catalog rows from landed profiles (one landed row per fund).
  const profiles = readSecRawItems<SecFundProfile>(SEC_ENDPOINTS.profiles);
  let fundsUpserted = 0;
  for (const p of profiles) {
    if (!p.proj_id) continue;
    upsertFund(profileToFundInsert(p, aumByProj.get(p.proj_id) ?? null, rsByProj.get(p.proj_id)));
    fundsUpserted++;
  }

  // 2. Fee rows from landed fees (one landed row per fund holds its fee array).
  const feeRows: FundFeeInsert[] = [];
  let fundsWithFees = 0;
  for (const items of readSecRawItems<SecFundFeeItem[]>(SEC_ENDPOINTS.fees)) {
    if (!Array.isArray(items) || items.length === 0) continue;
    fundsWithFees++;
    for (const item of items) feeRows.push(feeItemToFeeRow(item));
  }
  // One upsert: it batches the inserts and recomputes current_ter for every
  // touched fund in a single pass (see upsertFundFees).
  upsertFundFees(feeRows);

  // Drop the cached search index so the next search rebuilds over the fresh
  // catalog.
  invalidateFundIndex();

  return { fundsUpserted, fundsWithFees, feeRowsUpserted: feeRows.length };
}
