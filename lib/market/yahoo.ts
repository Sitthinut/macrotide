// Minimal Yahoo Finance chart client.
//
// Endpoint: https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}
// No API key required. Requires a User-Agent header (Yahoo rejects requests
// without one). Yahoo occasionally 429s — callers should cache.
//
// Symbols of interest:
//   ^SET.BK  — Thailand SET index
//   ^GSPC    — S&P 500
//   ^IXIC    — Nasdaq Composite
//   ^N225    — Nikkei 225
//   THB=X    — USD/THB

export type YahooRange = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";
export type YahooInterval = "1d" | "1wk" | "1mo";

export interface YahooQuote {
  symbol: string;
  name: string;
  currency: string;
  /** Most recent close. */
  price: number;
  /** Previous trading day's close. Used to compute day change. */
  previousClose: number;
  /** UNIX seconds. */
  asOf: number;
}

export interface YahooSeriesPoint {
  /** UNIX seconds. */
  t: number;
  close: number;
}

interface YahooChartResponse {
  chart: {
    result?: Array<{
      meta: {
        symbol: string;
        currency: string;
        regularMarketPrice: number;
        chartPreviousClose: number;
        previousClose?: number;
        longName?: string;
        shortName?: string;
        regularMarketTime: number;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
}

// Two hosts share Yahoo's chart endpoint; rate-limit budgets are tracked
// independently. Falling back from query1 → query2 doubles available throughput
// before we have to give up.
const BASE_URLS = [
  "https://query2.finance.yahoo.com/v8/finance/chart",
  "https://query1.finance.yahoo.com/v8/finance/chart",
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class YahooError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  base: string,
  symbol: string,
  range: YahooRange,
  interval: YahooInterval,
): Promise<Response> {
  const url = new URL(`${base}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
    },
    // Next caches fetches by default in route handlers; opt out so we always
    // get fresh data and can manage our own cache in fund_quotes / nav_history.
    cache: "no-store",
  });
}

async function fetchChart(symbol: string, range: YahooRange, interval: YahooInterval) {
  let lastError: YahooError | null = null;
  // Try each host with retry-on-429 backoff.
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const base of BASE_URLS) {
      try {
        const res = await fetchOnce(base, symbol, range, interval);
        if (res.status === 429) {
          lastError = new YahooError(`Yahoo returned 429 for ${symbol}`, 429);
          continue;
        }
        if (!res.ok) {
          throw new YahooError(`Yahoo returned ${res.status} for ${symbol}`, res.status);
        }
        const json = (await res.json()) as YahooChartResponse;
        if (json.chart.error) {
          throw new YahooError(`${json.chart.error.code}: ${json.chart.error.description}`);
        }
        const result = json.chart.result?.[0];
        if (!result) throw new YahooError(`No chart result for ${symbol}`);
        return result;
      } catch (err) {
        lastError = err instanceof YahooError ? err : new YahooError(String(err));
        if (lastError.status && lastError.status !== 429) throw lastError;
      }
    }
    // Both hosts 429'd; wait then retry.
    if (attempt < 2) {
      await sleep(800 * (attempt + 1) + Math.random() * 400);
    }
  }
  throw lastError ?? new YahooError(`Failed to fetch ${symbol}`);
}

export async function getQuote(symbol: string): Promise<YahooQuote> {
  const r = await fetchChart(symbol, "1mo", "1d");
  return {
    symbol: r.meta.symbol,
    name: r.meta.longName ?? r.meta.shortName ?? r.meta.symbol,
    currency: r.meta.currency,
    price: r.meta.regularMarketPrice,
    previousClose: r.meta.previousClose ?? r.meta.chartPreviousClose,
    asOf: r.meta.regularMarketTime,
  };
}

export async function getSeries(
  symbol: string,
  range: YahooRange = "6mo",
  interval: YahooInterval = "1d",
): Promise<{ quote: YahooQuote; series: YahooSeriesPoint[] }> {
  const r = await fetchChart(symbol, range, interval);
  const timestamps = r.timestamp ?? [];
  const closes = r.indicators.quote[0]?.close ?? [];
  const series: YahooSeriesPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    if (c == null) continue;
    series.push({ t: timestamps[i], close: c });
  }
  return {
    quote: {
      symbol: r.meta.symbol,
      name: r.meta.longName ?? r.meta.shortName ?? r.meta.symbol,
      currency: r.meta.currency,
      price: r.meta.regularMarketPrice,
      previousClose: r.meta.previousClose ?? r.meta.chartPreviousClose,
      asOf: r.meta.regularMarketTime,
    },
    series,
  };
}

export async function getQuotes(symbols: string[]): Promise<YahooQuote[]> {
  // Yahoo's chart endpoint is one-symbol-at-a-time; parallelize.
  const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
