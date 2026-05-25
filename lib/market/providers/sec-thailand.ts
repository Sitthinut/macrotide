// Thai SEC Open API provider — Thai mutual fund daily NAV.
//
// Source: official Securities and Exchange Commission of Thailand.
// Portal: https://secopendata.sec.or.th/sec-open-apis (launched 2026-01-12).
//   Old portal at https://api-portal.sec.or.th/ retires 2026-06-30.
// Runtime base: https://api.sec.or.th (Azure APIM gateway).
//
// Auth: single subscription on the new portal gives you Primary + Secondary
// keys (rotation pair — both valid). One subscription covers all six product
// groups. Header: Ocp-Apim-Subscription-Key.
//
// Rate limit: 5,000 calls per 300 seconds. Min ~16ms between requests
// recommended. HTTP 421 signals over-limit; respect Retry-After.
// Refresh windows: 09:30 + 17:30 Bangkok time.
//
// Ticker format: the user-typed fund code, case-insensitive. Can be either
// a parent fund's proj_abbr_name (e.g. `HI-DIV-RMF`) for funds without share
// classes, OR a share-class name (e.g. `K-FIXED-A`, `HIDIV-D`). When a parent
// fund has share classes, the parent itself is NOT investable — typing the
// parent code returns a helpful error listing the available classes.
//
// Routing is driven by the holding's `quote_source` column (= "thai_mutual_fund"
// here), not by a prefix in the ticker. The provider sees only the bare code.
//
// Endpoints used (v2 — new portal):
//   GET /v2/fund/general-info/profiles?fund_class_name={code}   — exact lookup
//   GET /v2/fund/general-info/profiles?project_info={code}      — partial fallback
//   GET /v2/fund/daily-info/nav?proj_id={id}
//        &fund_class_name={class}                                — narrow to one class
//        &start_nav_date={YYYY-MM-DD}&end_nav_date={YYYY-MM-DD}  — date range
//
// All v2 responses are cursor-paginated:
//   { message, page_size, next_cursor, items: [...] }
// Default/max page_size = 100; empty next_cursor signals last page.

import type { SecFundFeeItem } from "../fund-fees";
import {
  type Provider,
  ProviderError,
  type Quote,
  type SeriesInterval,
  type SeriesPoint,
  type SeriesRange,
} from "./types";

export const SEC_THAILAND_SOURCE = "thai_mutual_fund";
const BASE_URL = "https://api.sec.or.th";
// Portal recommends ≥16ms between requests under the 5000-per-300s ceiling.
// 20ms gives margin. With targeted (per-symbol) lookups instead of a global
// index build, a cold-start fetchSeries makes just 2–3 calls.
const REQUEST_DELAY_MS = 20;
const PAGE_SIZE = 100;
const SYMBOL_CACHE_TTL_MS = 24 * 60 * 60_000;

interface SecFund {
  unique_id: string;
  proj_id: string;
  proj_abbr_name: string;
  proj_name_th?: string;
  proj_name_en?: string;
  fund_status?: string;
  fund_class_name?: string;
}

interface SecDailyNav {
  proj_id: string;
  unique_id?: string;
  fund_class_name?: string;
  nav_date: string;
  last_val: number;
  net_asset?: number;
}

interface PaginatedEnvelope<T> {
  message?: string;
  page_size?: number;
  next_cursor?: string;
  items?: T[];
}

interface ResolvedFund {
  projId: string;
  /** Display name, falls back through proj_name_en → proj_name_th → abbr. */
  name: string;
  /**
   * The fund_class_name to filter NAV queries by. `"main"` for funds without
   * share classes; the share-class abbreviation otherwise.
   */
  fundClassName: string;
  cachedAt: number;
}

const symbolCache = new Map<string, ResolvedFund>();

function apiKey(): string {
  const k = process.env.SEC_API_KEY;
  if (!k) {
    throw new ProviderError("SEC_API_KEY is not set", "sec-thailand");
  }
  return k;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Global rate gate. The SEC ceiling is 5 000 calls / 300 s (~16.7/s). A full
// nightly catalog crawl fires ~10–15k calls across a concurrency pool, so a
// per-page sleep alone won't keep us under the cap — concurrent callers would
// burst past it. This serializes call *start times* to at least
// MIN_INTERVAL_MS apart process-wide (~14/s), leaving headroom no matter the
// concurrency. Cheap single-symbol lookups pay at most one interval.
// Tunable throttle + retry knobs. Defaults are the production values; tests
// override them via __setSecThailandRetry to avoid real backoff waits.
const RETRY_DEFAULTS = {
  minIntervalMs: 70, // ~14 calls/s, under the 16.7/s ceiling
  maxRetries: 5,
  baseDelayMs: 500,
  maxBackoffMs: 30_000,
};
let retry = { ...RETRY_DEFAULTS };
let nextSlot = 0;

async function rateGate(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + retry.minIntervalMs;
  if (start > now) await sleep(start - now);
}

async function secFetch<T>(path: string, key: string): Promise<T | null> {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; ; attempt++) {
    await rateGate();
    const res = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (res.status === 204) return null;
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(
        `Thai SEC API rejected the subscription key (${res.status})`,
        "sec-thailand",
        res.status,
      );
    }
    // Retryable: rate-limit (421/429) and server errors (5xx). 401/403 above
    // are auth errors and never retried.
    if (res.status === 421 || res.status === 429 || res.status >= 500) {
      if (attempt >= retry.maxRetries) {
        throw new ProviderError(
          `Thai SEC API still failing after ${retry.maxRetries} retries (${res.status}) for ${path}`,
          "sec-thailand",
          res.status,
        );
      }
      // Honor Retry-After when present, else exponential backoff with jitter.
      const retryAfterSec = Number(res.headers.get("retry-after"));
      const backoff =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : Math.min(retry.maxBackoffMs, retry.baseDelayMs * 2 ** attempt) +
            Math.floor(Math.random() * 250);
      await sleep(backoff);
      continue;
    }
    if (!res.ok) {
      throw new ProviderError(
        `Thai SEC API returned ${res.status} for ${path}`,
        "sec-thailand",
        res.status,
      );
    }
    return (await res.json()) as T;
  }
}

async function secFetchPaginated<T>(
  path: string,
  query: Record<string, string>,
  key: string,
): Promise<T[]> {
  const items: T[] = [];
  let cursor = "";
  for (let safety = 0; safety < 200; safety++) {
    const params = new URLSearchParams({ ...query, page_size: String(PAGE_SIZE) });
    if (cursor) params.set("next_cursor", cursor);
    const env = await secFetch<PaginatedEnvelope<T>>(`${path}?${params.toString()}`, key);
    if (!env?.items?.length) break;
    items.push(...env.items);
    if (!env.next_cursor) break;
    cursor = env.next_cursor;
    await sleep(REQUEST_DELAY_MS);
  }
  return items;
}

function nameOf(f: SecFund): string {
  return f.proj_name_en ?? f.proj_name_th ?? f.proj_abbr_name;
}

/**
 * Resolve a user-typed fund code to a proj_id + class filter. Tries the
 * share-class endpoint first (cheap exact match), then falls back to
 * project_info partial-match against parent fund names. Caches both
 * successful and ambiguous resolutions for 24h.
 *
 * On ambiguity (parent fund with multiple share classes), throws a clear
 * error listing the available classes so the user can pick one.
 */
async function resolveSymbol(code: string): Promise<ResolvedFund> {
  const upper = code.trim().toUpperCase();
  if (!upper) {
    throw new ProviderError("empty Thai fund code", "sec-thailand");
  }
  const cached = symbolCache.get(upper);
  if (cached && Date.now() - cached.cachedAt < SYMBOL_CACHE_TTL_MS) {
    return cached;
  }

  const key = apiKey();

  // 1) Treat the input as a share-class name. Exact match, single API call.
  const byClass = await secFetchPaginated<SecFund>(
    "/v2/fund/general-info/profiles",
    { fund_class_name: upper },
    key,
  );
  const exactClass = byClass.find((f) => (f.fund_class_name ?? "").toUpperCase() === upper);
  if (exactClass) {
    const entry: ResolvedFund = {
      projId: exactClass.proj_id,
      name: nameOf(exactClass),
      fundClassName: exactClass.fund_class_name ?? upper,
      cachedAt: Date.now(),
    };
    symbolCache.set(upper, entry);
    return entry;
  }

  // 2) Treat the input as a parent proj_abbr_name. Partial match, then narrow.
  await sleep(REQUEST_DELAY_MS);
  const byProject = await secFetchPaginated<SecFund>(
    "/v2/fund/general-info/profiles",
    { project_info: upper },
    key,
  );
  const parentMatches = byProject.filter((f) => (f.proj_abbr_name ?? "").toUpperCase() === upper);

  // 2a) Single fund, no share classes (fund_class_name === "main" or absent).
  const mainRow = parentMatches.find((f) => {
    const c = (f.fund_class_name ?? "").trim().toLowerCase();
    return c === "main" || c === "" || c === "-";
  });
  if (mainRow) {
    const entry: ResolvedFund = {
      projId: mainRow.proj_id,
      name: nameOf(mainRow),
      fundClassName: "main",
      cachedAt: Date.now(),
    };
    symbolCache.set(upper, entry);
    return entry;
  }

  // 2b) Parent with multiple share classes — ambiguous. Surface the options.
  if (parentMatches.length > 0) {
    const classes = parentMatches
      .map((f) => f.fund_class_name)
      .filter((c): c is string => Boolean(c))
      .sort();
    throw new ProviderError(
      `"${upper}" is a parent fund with multiple share classes. ` +
        `Specify one of: ${classes.map((c) => `thfund:${c}`).join(", ")}`,
      "sec-thailand",
    );
  }

  throw new ProviderError(
    `Unknown Thai fund code "${upper}" — no match for share class or parent fund`,
    "sec-thailand",
  );
}

function rangeToDays(range: SeriesRange): number {
  switch (range) {
    case "1mo":
      return 31;
    case "3mo":
      return 92;
    case "6mo":
      return 183;
    case "1y":
      return 366;
    case "5y":
      return 5 * 366;
    case "max":
      return 365 * 20;
  }
}

function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const secThailandProvider: Provider = {
  id: "sec-thailand",
  matches(source: string, _ticker: string): boolean {
    return source === SEC_THAILAND_SOURCE;
  },
  async fetchSeries(
    ticker: string,
    range: SeriesRange,
    _interval: SeriesInterval,
  ): Promise<{ quote: Quote; series: SeriesPoint[] }> {
    const entry = await resolveSymbol(ticker);

    const key = apiKey();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - rangeToDays(range));

    const navQuery: Record<string, string> = {
      proj_id: entry.projId,
      start_nav_date: yyyyMmDd(startDate),
      end_nav_date: yyyyMmDd(today),
    };
    // For share classes, narrow the response server-side. For "main" the
    // server returns just the one row per date anyway, but we still apply
    // a defensive client-side filter below.
    if (entry.fundClassName !== "main") {
      navQuery.fund_class_name = entry.fundClassName;
    }

    const rows = await secFetchPaginated<SecDailyNav>("/v2/fund/daily-info/nav", navQuery, key);

    const wantClass = entry.fundClassName.toLowerCase();
    const series: SeriesPoint[] = [];
    for (const r of rows) {
      const rc = (r.fund_class_name ?? "").trim().toLowerCase();
      // Defensive: keep rows that match the wanted class (treating "", "-",
      // "main" as equivalent for parent funds).
      const isMainLike = rc === "" || rc === "-" || rc === "main";
      const matchesWanted = wantClass === "main" ? isMainLike : rc === wantClass;
      if (!matchesWanted) continue;
      if (r.last_val == null) continue;
      const t = Math.floor(Date.parse(`${r.nav_date}T00:00:00Z`) / 1000);
      if (!Number.isFinite(t)) continue;
      series.push({ t, close: r.last_val });
    }
    series.sort((a, b) => a.t - b.t);

    if (series.length === 0) {
      throw new ProviderError(
        `No NAV data returned for ${ticker} over the requested range`,
        "sec-thailand",
      );
    }

    const latest = series[series.length - 1];
    const previous = series.length > 1 ? series[series.length - 2] : latest;
    const quote: Quote = {
      ticker,
      name: entry.name,
      currency: "THB",
      price: latest.close,
      previousClose: previous.close,
      asOfUnix: latest.t,
    };
    return { quote, series };
  },
};

// ─── Fund catalog enumeration ────────────────────────────────────────────────

/**
 * Raw profile item returned by the /v2/fund/general-info/profiles endpoint
 * when enumerating the full fund universe (no query filter).
 *
 * Field names verified against a live data-inventory spike (29 total fields).
 * NOTE: the v2 endpoint does NOT return fund_type_en/fund_type_th — those
 * fields do not exist. Asset class is derived from policy_desc (Thai label)
 * via inferAssetClass in lib/market/fund-classify.ts.
 */
export interface SecFundProfile {
  proj_id: string;
  proj_abbr_name: string;
  proj_name_th?: string | null;
  proj_name_en?: string | null;
  /** Asset management company name (e.g. "Kasikorn Asset Management"). */
  amc_name?: string | null;
  /** Raw SEC fund status: 'Registered' | 'IPO' | 'Liquidated' | 'Expired' | 'Canceled'. */
  fund_status?: string | null;
  /** Short Thai asset-type label (ตราสารหนี้ / ตราสารทุน / ผสม / ทรัพย์สินทางเลือก / ตลาดเงิน). */
  policy_desc?: string | null;
  /** Management style code: 'AM' active | 'PN' passive/index | 'SM' systematic | 'PM' passive multi-factor | 'BH' buy-and-hold. */
  management_style?: string | null;
  /** Thai label for tax-incentive wrapper (e.g. "กองทุนรวมเพื่อการออม" → SSF). */
  fund_class_tax_incentive_type?: string | null;
  /** Thai share-class detail (จ่ายเงินปันผล = dividend, สะสมมูลค่า = accumulating). */
  fund_class_detail?: string | null;
  /** Geographic mandate flag: '1' = foreign | '3' = mixed | '4' = domestic. */
  invest_country_flag?: string | null;
  /** Master fund name if this is a feeder fund; null/undefined otherwise. */
  feederfund_master_fund?: string | null;
  /** 'Y' if the fund has a fixed maturity date. */
  proj_term_flag?: string | null;
  /** Fund inception date (ISO date string). */
  init_date?: string | null;
  /** ISIN code (~30% coverage). */
  fund_class_isin_code?: string | null;
  /** Share-class name (e.g. 'A', 'B', 'main'). Used only for symbol resolution. */
  fund_class_name?: string | null;
}

/**
 * Enumerate every fund profile from the SEC. Follows cursor pagination until
 * exhausted. De-dupes on proj_id, keeping the first occurrence (profiles
 * endpoint may return multiple rows for parent + share classes — we want one
 * catalog row per parent project).
 *
 * Limit is applied AFTER de-dup so the caller gets up to `limit` unique
 * proj_ids (useful for spike/dev runs; omit or set 0 for full crawl).
 */
export async function enumerateFundProfiles(limit = 0): Promise<SecFundProfile[]> {
  const key = apiKey();
  const seen = new Set<string>();
  const profiles: SecFundProfile[] = [];

  let cursor = "";
  for (let safety = 0; safety < 500; safety++) {
    const params = new URLSearchParams({ page_size: String(PAGE_SIZE) });
    if (cursor) params.set("next_cursor", cursor);
    const env = await secFetch<PaginatedEnvelope<SecFundProfile>>(
      `/v2/fund/general-info/profiles?${params.toString()}`,
      key,
    );
    if (!env?.items?.length) break;

    for (const item of env.items) {
      if (!item.proj_id) continue;
      if (seen.has(item.proj_id)) continue;
      seen.add(item.proj_id);
      profiles.push(item);
      if (limit > 0 && profiles.length >= limit) break;
    }

    if (!env.next_cursor || (limit > 0 && profiles.length >= limit)) break;
    cursor = env.next_cursor;
    await sleep(REQUEST_DELAY_MS);
  }

  return profiles;
}

/**
 * Fetch all fee rows for one fund (identified by its proj_id) from the SEC
 * factsheet fees endpoint. Returns an empty array on 204 / no data.
 */
export async function fetchFundFees(projId: string): Promise<SecFundFeeItem[]> {
  const key = apiKey();
  return secFetchPaginated<SecFundFeeItem>("/v2/fund/factsheet/fees", { proj_id: projId }, key);
}

interface SecDailyNavRow {
  proj_id: string;
  nav_date: string;
  net_asset?: number | null;
  last_val?: number | null;
}

/**
 * Fetch the most recent total net asset value (AUM) for one fund.
 * Uses a 7-day window so we catch the latest published figure even over
 * a long weekend. Returns { aum, aumDate } from the most recent row, or
 * null if no data is available. Only call this for Registered (active) funds.
 */
export async function fetchFundAum(
  projId: string,
): Promise<{ aum: number; aumDate: string } | null> {
  const key = apiKey();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 7);

  const rows = await secFetchPaginated<SecDailyNavRow>(
    "/v2/fund/daily-info/nav",
    {
      proj_id: projId,
      start_nav_date: yyyyMmDd(start),
      end_nav_date: yyyyMmDd(today),
    },
    key,
  );

  // Find the most recent row that has a net_asset value.
  const sorted = rows
    .filter((r) => r.net_asset != null && r.nav_date)
    .sort((a, b) => (b.nav_date > a.nav_date ? 1 : b.nav_date < a.nav_date ? -1 : 0));

  if (sorted.length === 0) return null;
  const best = sorted[0];
  // net_asset is guaranteed non-null due to the filter above.
  return { aum: best.net_asset as number, aumDate: best.nav_date };
}

/** Test-only — reset the per-symbol cache. */
export function __resetSecThailandCache(): void {
  symbolCache.clear();
  retry = { ...RETRY_DEFAULTS };
  nextSlot = 0;
}

/** Test-only: override throttle/retry timing so tests don't incur real waits. */
export function __setSecThailandRetry(overrides: Partial<typeof RETRY_DEFAULTS>): void {
  retry = { ...retry, ...overrides };
}
