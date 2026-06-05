// Refresh job — the EXTRACT/LOAD half of the ELT crawl. Enumerate all Thai mutual
// funds from the SEC, fetch their fees/AUM, and LAND the verbatim payloads in
// `sec_raw`. The normalized fund_catalog + fund_fees columns are then derived by
// transformFundCatalog() (the API-free transform) over those landed rows.
//
// Design: enumerate → (per fund) fetch fees + AUM + optional enrichment → land
//         verbatim profile/fees/AUM in sec_raw → after the crawl, run the
//         transform to (re)derive catalog + fees from everything landed.
// Why ELT: nothing fetched is discarded at land time, and re-deriving a column
//         (a classification fix, a recovered field) is a seconds-long transform
//         re-run (`npm run jobs:transform-catalog`), not an ~80-min re-crawl.
// Idempotent: landing keys on (endpoint, projId, rowKey) and the transform's
//         upserts key on PK, so re-running either is safe.
// Concurrency: p-limit style manual pool (configurable, default 4) so we don't
// hammer the SEC API (5 000 calls / 300 s ceiling; modest concurrency helps).
// Errors per fund are collected and do NOT abort the whole run.
//
// Enrichment (perf/allocation/holdings/portfolio/feeder) still writes its own
// dedicated snapshot tables in this loop — those tables already store near-raw
// snapshots, so they are not routed through sec_raw in this iteration.
//
// ─── Enrichment env flags (all default OFF) ────────────────────────────────
// SEC_INGEST_PERFORMANCE=1  — fetch /v2/fund/factsheet/performance (all types)
// SEC_INGEST_ALLOCATION=1   — fetch /v2/fund/factsheet/asset-allocation
// SEC_INGEST_HOLDINGS=1     — fetch /v2/fund/factsheet/top5-holdings
// SEC_INGEST_PORTFOLIO=1    — fetch /v2/fund/outstanding/portfolio (full holdings,
//                             paginated) + /v2/fund/outstanding/portfolio-asset-type.
//                             WARNING: Full portfolio ingestion roughly doubles
//                             crawl API calls (many funds have 100+ holdings).
//                             Recommend running on a weekly cadence, not nightly.
// EXTERNAL_INGEST_FEEDER_HOLDINGS=1 — for feeder funds whose master is a
//                             US-registered fund in the EDGAR_FUNDS registry,
//                             fetch its latest SEC NPORT-P holdings (official,
//                             free). A couple of HTTP requests per matched fund.
//
// Merging this branch does NOT change prod behavior until at least one flag is set.
//
// Scope:
//   - Catalog ALL enumerated funds (Registered + IPO + Liquidated + Expired + Canceled).
//   - Fees, AUM, and enrichment are only fetched for Registered funds (~2,300).
//   - Inactive/IPO funds leave aum/feeRows undefined to avoid clobbering any
//     existing values with null.

import {
  type FeederLookThroughHoldingInsert,
  getFeederMasterMap,
  upsertFeederLookThroughHoldings,
  upsertFeederMasterMap,
} from "../db/queries/feeder-enrichment";
import {
  type FundAssetAllocationInsert,
  type FundPerformanceInsert,
  type FundPortfolioAssetTypeInsert,
  type FundPortfolioInsert,
  type FundTopHoldingInsert,
  upsertFundAssetAllocation,
  upsertFundPerformance,
  upsertFundPortfolio,
  upsertFundPortfolioAssetType,
  upsertFundTopHoldings,
} from "../db/queries/fund-enrichment";
import { makeSecRaw, SEC_ENDPOINTS, type SecRawInsert, upsertSecRaw } from "../db/queries/sec-raw";
import { shouldFetchFees } from "../market/fund-classify";
import { EDGAR_FUNDS, fetchNportHoldings, matchEdgarFund } from "../market/providers/edgar-nport";
import {
  enumerateFundProfiles,
  fetchFundAssetAllocation,
  fetchFundAum,
  fetchFundFees,
  fetchFundPerformance,
  fetchFundPortfolio,
  fetchFundPortfolioAssetType,
  fetchFundTop5Holdings,
  type SecFundProfile,
} from "../market/providers/sec-thailand";
import { transformFundCatalog } from "./transform-fund-catalog";

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
  /** Injectable performance-fetcher (replaces the real API call in tests). */
  _fetchPerformance?: typeof fetchFundPerformance;
  /** Injectable asset-allocation-fetcher (replaces the real API call in tests). */
  _fetchAssetAllocation?: typeof fetchFundAssetAllocation;
  /** Injectable top-5-holdings-fetcher (replaces the real API call in tests). */
  _fetchTop5Holdings?: typeof fetchFundTop5Holdings;
  /** Injectable portfolio-fetcher (replaces the real API call in tests). */
  _fetchPortfolio?: typeof fetchFundPortfolio;
  /** Injectable portfolio-asset-type-fetcher (replaces the real API call in tests). */
  _fetchPortfolioAssetType?: typeof fetchFundPortfolioAssetType;
  /** Injectable feeder look-through fetcher (replaces the real EDGAR HTTP call in tests). */
  _fetchFeederHoldings?: typeof fetchNportHoldings;
}

export interface RefreshFundCatalogResult {
  fundsSeen: number;
  fundsUpserted: number;
  /** Funds with secStatus === 'Registered' (active + fee data fetched). */
  fundsActive: number;
  /** Funds for which at least one fee row was upserted. */
  fundsWithFees: number;
  feeRowsUpserted: number;
  /** Funds for which at least one performance row was upserted. */
  fundsWithPerformance: number;
  /** Funds for which asset allocation was upserted. */
  fundsWithAllocation: number;
  /** Funds for which top-5 holdings were upserted. */
  fundsWithHoldings: number;
  /** Funds for which portfolio data was upserted. */
  fundsWithPortfolio: number;
  /** Feeder funds for which master-fund look-through holdings were fetched. */
  fundsWithFeederLookThrough: number;
  errors: Array<{ projId: string; error: string }>;
}

// ─── Enrichment flags ─────────────────────────────────────────────────────────

function envFlag(name: string): boolean {
  return process.env[name] === "1" || process.env[name] === "true";
}

// ─── Core job ────────────────────────────────────────────────────────────────

/**
 * Enumerate all SEC mutual funds, land their verbatim profile + fee + AUM
 * payloads in `sec_raw`, then derive `fund_catalog` + `fund_fees` from everything
 * landed via {@link transformFundCatalog}. Optionally also fetches enrichment
 * data (performance, allocation, holdings, portfolio) into its dedicated tables
 * when the corresponding SEC_INGEST_* env flags are set.
 *
 * Returns a summary object. Non-fatal errors (per fund) are collected in
 * `errors`; they do not abort the run. A fund that errors during its fetch lands
 * nothing, so the transform produces no catalog row for it (unchanged behavior).
 */
export async function refreshFundCatalog(
  opts: RefreshFundCatalogOptions = {},
): Promise<RefreshFundCatalogResult> {
  const concurrency = opts.concurrency ?? 4;
  const limitFunds = opts.limit ?? 0;
  const enumerate = opts._enumerate ?? enumerateFundProfiles;
  const getFees = opts._fetchFees ?? fetchFundFees;
  const getAum = opts._fetchAum ?? fetchFundAum;
  const getPerformance = opts._fetchPerformance ?? fetchFundPerformance;
  const getAssetAllocation = opts._fetchAssetAllocation ?? fetchFundAssetAllocation;
  const getTop5Holdings = opts._fetchTop5Holdings ?? fetchFundTop5Holdings;
  const getPortfolio = opts._fetchPortfolio ?? fetchFundPortfolio;
  const getPortfolioAssetType = opts._fetchPortfolioAssetType ?? fetchFundPortfolioAssetType;
  const getFeederHoldings = opts._fetchFeederHoldings ?? fetchNportHoldings;

  // Read enrichment flags once per run (not per fund).
  const doPerformance = envFlag("SEC_INGEST_PERFORMANCE");
  const doAllocation = envFlag("SEC_INGEST_ALLOCATION");
  const doHoldings = envFlag("SEC_INGEST_HOLDINGS");
  const doPortfolio = envFlag("SEC_INGEST_PORTFOLIO");
  const doFeederLookThrough = envFlag("EXTERNAL_INGEST_FEEDER_HOLDINGS");

  // 1. Enumerate all funds (active + inactive).
  const profiles = await enumerate(limitFunds);

  const total = profiles.length;
  let fundsUpserted = 0;
  let fundsActive = 0;
  let fundsWithFees = 0;
  let feeRowsUpserted = 0;
  let fundsWithPerformance = 0;
  let fundsWithAllocation = 0;
  let fundsWithHoldings = 0;
  let fundsWithPortfolio = 0;
  let fundsWithFeederLookThrough = 0;
  const errors: Array<{ projId: string; error: string }> = [];

  // Enrichment writes are DEFERRED: their tables FK-reference fund_catalog, which
  // the transform below builds only after the land loop. We fetch + build the
  // rows in the loop (so the concurrency pool still parallelizes the network),
  // buffer the writes here, and flush them after transformFundCatalog() has
  // created the catalog rows — FK-safe even on a first-ever crawl.
  const deferredEnrichmentWrites: Array<() => void> = [];

  // 2. Process in a concurrency-capped pool.
  const inFlight = new Set<Promise<void>>();

  async function processOne(p: SecFundProfile, index: number): Promise<void> {
    const projId = p.proj_id;
    try {
      const secStatus = p.fund_status ?? null;
      const fetchEnrichment = shouldFetchFees(secStatus);

      // 2a. For Registered funds: fetch fees + AUM (always) and enrichment (if flagged).
      let feeItems: Awaited<ReturnType<typeof fetchFundFees>> = [];
      let aumResult: Awaited<ReturnType<typeof fetchFundAum>> = null;

      if (fetchEnrichment) {
        fundsActive++;

        // Core fetches (always for active funds).
        [feeItems, aumResult] = await Promise.all([getFees(projId), getAum(projId)]);

        // Enrichment fetches (gated by env flags).
        if (doPerformance) {
          const perfItems = await getPerformance(projId);
          if (perfItems.length > 0) {
            const perfRows: FundPerformanceInsert[] = perfItems.map((item) => ({
              projId: item.proj_id,
              fundClassName: item.fund_class_name,
              startDate: item.start_date,
              endDate: item.end_date ?? null,
              prospectusType: item.prospectus_type ?? null,
              performanceTypeDesc: item.performance_type_desc,
              referencePeriod: item.reference_period,
              performanceValue: item.performance_value ?? null,
              lastUpdDate: item.last_upd_date ?? null,
            }));
            deferredEnrichmentWrites.push(() => upsertFundPerformance(projId, perfRows));
            fundsWithPerformance++;
          }
        }

        if (doAllocation) {
          const allocItems = await getAssetAllocation(projId);
          if (allocItems.length > 0) {
            const allocRows: FundAssetAllocationInsert[] = allocItems.map((item) => ({
              projId: item.proj_id,
              startDate: item.start_date,
              endDate: item.end_date ?? null,
              prospectusType: item.prospectus_type ?? null,
              assetSeq: item.asset_seq,
              assetName: item.asset_name ?? null,
              assetRatio: item.asset_ratio ?? null,
              lastUpdDate: item.last_upd_date ?? null,
            }));
            deferredEnrichmentWrites.push(() => upsertFundAssetAllocation(projId, allocRows));
            fundsWithAllocation++;
          }
        }

        if (doHoldings) {
          const holdingItems = await getTop5Holdings(projId);
          if (holdingItems.length > 0) {
            const holdingRows: FundTopHoldingInsert[] = holdingItems.map((item) => ({
              projId: item.proj_id,
              startDate: item.start_date,
              endDate: item.end_date ?? null,
              prospectusType: item.prospectus_type ?? null,
              assetSeq: item.asset_seq,
              assetName: item.asset_name ?? null,
              assetRatio: item.asset_ratio ?? null,
              lastUpdDate: item.last_upd_date ?? null,
            }));
            deferredEnrichmentWrites.push(() => upsertFundTopHoldings(projId, holdingRows));
            fundsWithHoldings++;
          }
        }

        if (doPortfolio) {
          // Full portfolio + asset-type summary in parallel.
          const [portItems, portTypeItems] = await Promise.all([
            getPortfolio(projId),
            getPortfolioAssetType(projId),
          ]);

          // Both /outstanding endpoints return EVERY reported period (years of
          // history). We store it all incrementally (upsert* inserts only new
          // periods, never deletes) so the accumulated series backs future
          // time-series features; the read side shows only the latest period.
          if (portItems.length > 0) {
            const portRows: FundPortfolioInsert[] = portItems.map((item) => ({
              projId: item.proj_id,
              period: item.period,
              asOfDate: item.as_of_date ?? null,
              assetliabId: item.assetliab_id ?? null,
              assetliabDesc: item.assetliab_desc ?? null,
              issueCode: item.issue_code ?? null,
              isinCode: item.isin_code ?? null,
              issuer: item.issuer ?? null,
              assetliabValue: item.assetliab_value ?? null,
              percentNav: item.percent_nav ?? null,
              lastUpdDate: item.last_upd_date ?? null,
            }));
            deferredEnrichmentWrites.push(() => upsertFundPortfolio(projId, portRows));
            fundsWithPortfolio++;
          }

          if (portTypeItems.length > 0) {
            const portTypeRows: FundPortfolioAssetTypeInsert[] = portTypeItems.map((item) => ({
              projId: item.proj_id,
              period: item.period,
              assetliabCode: item.assetliab_code,
              assetliabDesc: item.assetliab_desc ?? null,
              marketValue: item.market_value ?? null,
              percentNav: item.percent_nav ?? null,
            }));
            deferredEnrichmentWrites.push(() => upsertFundPortfolioAssetType(projId, portTypeRows));
          }
        }

        // Feeder fund look-through: resolve the master fund, then fetch its
        // latest SEC NPORT-P holdings. Resolution order:
        //   1. An explicit feeder_master_map entry (operator-curated) — always
        //      wins, and is never overwritten by an automatic guess.
        //   2. A conservative name match against the EDGAR_FUNDS registry — used
        //      only when unambiguous (see matchEdgarFund), so a wrong fund is
        //      never silently assigned. Anything ambiguous is skipped and left
        //      for a manual feeder_master_map entry.
        // The SEC `feederfund_master_fund` field is a master-fund NAME string,
        // so name resolution maps it to a registry fund (keyed by ISIN). A
        // master we don't have a US-registered NPORT-P filer for is skipped.
        if (doFeederLookThrough && p.feederfund_master_fund) {
          const masterName = p.feederfund_master_fund;
          const explicit = getFeederMasterMap(projId);
          const masterIsin = explicit?.masterIsin ?? matchEdgarFund(masterName);
          const ref = masterIsin ? EDGAR_FUNDS[masterIsin] : undefined;
          if (ref) {
            const { asOfDate, holdings } = await getFeederHoldings(ref);
            if (holdings.length > 0) {
              // Only record an auto-derived map; never clobber an operator's
              // explicit mapping with the SEC-sourced name.
              if (!explicit) {
                deferredEnrichmentWrites.push(() =>
                  upsertFeederMasterMap({
                    projId,
                    masterIsin: ref.isin,
                    masterName,
                    provider: "sec-nport",
                  }),
                );
              }

              const lookThroughRows: FeederLookThroughHoldingInsert[] = holdings.map((h, i) => ({
                projId,
                rank: i + 1,
                name: h.name,
                ticker: h.ticker,
                assetClass: h.assetClass,
                isin: h.isin,
                weightPct: h.weightPct,
                asOfDate,
              }));
              deferredEnrichmentWrites.push(() =>
                upsertFeederLookThroughHoldings(projId, lookThroughRows),
              );
              fundsWithFeederLookThrough++;
            }
          }
          // No resolvable / non-US-registered master — silently skip.
        }
      }

      // 2b. Land verbatim payloads in sec_raw. Done only after the fetches above
      // succeed, so a fund that errors mid-fetch lands nothing and the transform
      // produces no catalog row for it (matches the pre-ELT behavior). The
      // profile is landed for every fund (active + inactive); fees/AUM only when
      // fetched (active funds). The transform derives the catalog/fees rows.
      const rawRows: SecRawInsert[] = [makeSecRaw(SEC_ENDPOINTS.profiles, projId, "", p)];
      if (feeItems.length > 0) {
        // Land the whole fee array under one row so a re-land replaces the fund's
        // fee snapshot atomically; the transform flattens it.
        rawRows.push(makeSecRaw(SEC_ENDPOINTS.fees, projId, "", feeItems));
        feeRowsUpserted += feeItems.length;
        fundsWithFees++;
      }
      if (aumResult != null) {
        rawRows.push(makeSecRaw(SEC_ENDPOINTS.aum, projId, "", aumResult));
      }
      upsertSecRaw(rawRows);
      fundsUpserted++;

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

  // Derive fund_catalog + fund_fees from everything just landed. This is the
  // same transform `jobs:transform-catalog` runs standalone; it also drops the
  // cached search index so the next search rebuilds over the fresh catalog.
  transformFundCatalog();

  // Now that the catalog rows exist, flush the buffered enrichment writes (their
  // tables FK-reference fund_catalog).
  for (const write of deferredEnrichmentWrites) write();

  return {
    fundsSeen: total,
    fundsUpserted,
    fundsActive,
    fundsWithFees,
    feeRowsUpserted,
    fundsWithPerformance,
    fundsWithAllocation,
    fundsWithHoldings,
    fundsWithPortfolio,
    fundsWithFeederLookThrough,
    errors,
  };
}
