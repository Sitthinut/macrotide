// Thai SEC Open API provider — Thai mutual fund daily NAV.
//
// Source: official Securities and Exchange Commission of Thailand.
// Portal: https://secopendata.sec.or.th/sec-open-apis (launched 2026-01-12).
//   Old portal at https://api-portal.sec.or.th/ retires 2026-06-30.
// Runtime base: https://api.sec.or.th (Azure APIM gateway).
//
// Auth: single subscription on the new portal gives you Primary + Secondary
// keys (rotation pair — both valid). One subscription covers all six product
// groups (/bond, /fund, /digital-asset, /LicenseCheck, /onereport, /pvd).
// Header: Ocp-Apim-Subscription-Key.
//
// Rate limit: 5,000 calls per 300 seconds. Min ~16ms between requests
// recommended. HTTP 421 (not 429) signals over-limit; respect Retry-After.
// Refresh windows: 09:30 + 17:30 Bangkok time.
//
// Symbol format: "thfund:<proj_abbr_name>" (e.g. "thfund:EXAMPLE-FUND-A").
// The `thfund:` prefix names the ASSET CLASS (Thai mutual fund), not this
// provider — so holdings stay valid if we ever swap the underlying data
// source. The human-friendly abbr name resolves to a proj_id via a cached
// lookup; the daily NAV endpoint takes proj_id, not the name.
//
// Endpoints used (v2 — the new portal's paths):
//   GET /v2/fund/general-info/amcs                                → AMC list
//   GET /v2/fund/general-info/profiles?company_info={unique_id}   → funds for one AMC
//   GET /v2/fund/daily-info/nav?proj_id={id}
//        &start_nav_date={YYYY-MM-DD}&end_nav_date={YYYY-MM-DD}   → NAV time series
//
// All v2 responses are cursor-paginated:
//   { message, page_size, next_cursor, items: [...] }
// Empty `next_cursor` signals last page. Default/max `page_size` is 100.

import {
  type Provider,
  ProviderError,
  type Quote,
  type SeriesInterval,
  type SeriesPoint,
  type SeriesRange,
} from "./types";

export const SEC_THAILAND_PREFIX = "thfund:";
const BASE_URL = "https://api.sec.or.th";
// Portal recommends ≥16ms between requests under the 5000-per-300s ceiling.
// We sleep 20ms for margin. With date-range NAV queries, a typical fetchSeries
// makes only 1–3 calls total (vs ~30 in the legacy per-date model).
const REQUEST_DELAY_MS = 20;
const PAGE_SIZE = 100;
const FUND_INDEX_TTL_MS = 24 * 60 * 60_000;

interface SecAmc {
  unique_id: string;
  comp_name_th?: string;
  comp_name_en?: string;
}

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

interface FundIndexEntry {
  projId: string;
  name: string;
}

type FundIndex = {
  byAbbr: Map<string, FundIndexEntry>;
  fetchedAt: number;
};

let fundIndexCache: FundIndex | null = null;
let fundIndexInflight: Promise<FundIndex> | null = null;

function apiKey(): string {
  const k = process.env.SEC_API_KEY;
  if (!k) {
    throw new ProviderError("SEC_API_KEY is not set", "sec-thailand");
  }
  return k;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Single HTTP GET against the SEC API. Returns the parsed envelope, or null
 * when the server responds 204 No Content. Throws ProviderError on auth or
 * rate-limit failures.
 */
async function secFetch<T>(path: string, key: string): Promise<T | null> {
  const url = `${BASE_URL}${path}`;
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
  // New portal: 421. Legacy portal: 429. Handle both.
  if (res.status === 421 || res.status === 429) {
    throw new ProviderError(
      `Thai SEC API rate-limited (${res.status})`,
      "sec-thailand",
      res.status,
    );
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

/**
 * Drives the v2 cursor pagination: keeps calling the endpoint with `next_cursor`
 * until the server signals end-of-data (empty cursor or no items). Returns the
 * flat list across all pages.
 */
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

async function buildFundIndex(): Promise<FundIndex> {
  const key = apiKey();
  const amcs = await secFetchPaginated<SecAmc>("/v2/fund/general-info/amcs", {}, key);
  const byAbbr = new Map<string, FundIndexEntry>();
  for (const amc of amcs) {
    await sleep(REQUEST_DELAY_MS);
    const funds = await secFetchPaginated<SecFund>(
      "/v2/fund/general-info/profiles",
      { company_info: amc.unique_id },
      key,
    );
    for (const f of funds) {
      if (!f.proj_id || !f.proj_abbr_name) continue;
      // Skip non-main class funds — multiple share-classes share one abbreviation,
      // so first-wins-on-main keeps the lookup deterministic. Callers needing
      // class-specific NAVs should pass a class-qualified symbol (future work).
      if (f.fund_class_name && f.fund_class_name !== "main") continue;
      const key = f.proj_abbr_name.toUpperCase();
      if (byAbbr.has(key)) continue;
      byAbbr.set(key, {
        projId: f.proj_id,
        name: f.proj_name_en ?? f.proj_name_th ?? f.proj_abbr_name,
      });
    }
  }
  return { byAbbr, fetchedAt: Date.now() };
}

async function getFundIndex(): Promise<FundIndex> {
  if (fundIndexCache && Date.now() - fundIndexCache.fetchedAt < FUND_INDEX_TTL_MS) {
    return fundIndexCache;
  }
  if (fundIndexInflight) return fundIndexInflight;
  fundIndexInflight = buildFundIndex()
    .then((idx) => {
      fundIndexCache = idx;
      return idx;
    })
    .finally(() => {
      fundIndexInflight = null;
    });
  return fundIndexInflight;
}

function parseSymbol(symbol: string): string {
  if (!symbol.startsWith(SEC_THAILAND_PREFIX)) {
    throw new ProviderError(
      `Expected symbol to start with "${SEC_THAILAND_PREFIX}", got "${symbol}"`,
      "sec-thailand",
    );
  }
  return symbol.slice(SEC_THAILAND_PREFIX.length).toUpperCase();
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
  matches(symbol: string): boolean {
    return symbol.startsWith(SEC_THAILAND_PREFIX);
  },
  async fetchSeries(
    symbol: string,
    range: SeriesRange,
    _interval: SeriesInterval,
  ): Promise<{ quote: Quote; series: SeriesPoint[] }> {
    const abbr = parseSymbol(symbol);
    const index = await getFundIndex();
    const entry = index.byAbbr.get(abbr);
    if (!entry) {
      throw new ProviderError(
        `Unknown Thai fund code "${abbr}" — not present in SEC FundFactsheet index`,
        "sec-thailand",
      );
    }

    const key = apiKey();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - rangeToDays(range));

    const rows = await secFetchPaginated<SecDailyNav>(
      "/v2/fund/daily-info/nav",
      {
        proj_id: entry.projId,
        start_nav_date: yyyyMmDd(startDate),
        end_nav_date: yyyyMmDd(today),
      },
      key,
    );

    const series: SeriesPoint[] = [];
    for (const r of rows) {
      // The API can return multiple class-fund rows per date; we asked for the
      // main fund via proj_id but defensive-filter on `fund_class_name` to
      // avoid picking up an unrelated share class if the server returns them.
      if (r.fund_class_name && r.fund_class_name !== "main" && r.fund_class_name !== "-") continue;
      if (r.last_val == null) continue;
      const t = Math.floor(Date.parse(`${r.nav_date}T00:00:00Z`) / 1000);
      if (!Number.isFinite(t)) continue;
      series.push({ t, close: r.last_val });
    }
    // The server may return out-of-order rows depending on pagination —
    // sort ascending by timestamp so consumers can rely on order.
    series.sort((a, b) => a.t - b.t);

    if (series.length === 0) {
      throw new ProviderError(
        `No NAV data returned for ${symbol} over the requested range`,
        "sec-thailand",
      );
    }

    const latest = series[series.length - 1];
    const previous = series.length > 1 ? series[series.length - 2] : latest;
    const quote: Quote = {
      symbol,
      name: entry.name,
      currency: "THB",
      price: latest.close,
      previousClose: previous.close,
      asOfUnix: latest.t,
    };
    return { quote, series };
  },
};

/** Test-only — reset the fund-index cache. */
export function __resetSecThailandCache(): void {
  fundIndexCache = null;
  fundIndexInflight = null;
}
