import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/context";
import { fundQuotes, navHistory } from "@/lib/db/schema";
import type { SeriesInterval, SeriesRange } from "./providers/types";
import { resolveProvider } from "./registry";

const QUOTE_TTL_MS = 5 * 60_000; // 5 min for live quote
const HISTORY_TTL_MS = 24 * 60 * 60_000; // 24 h for daily series
const FAIL_BACKOFF_MS = 3 * 60_000; // after an upstream error, don't refetch this key for 3 min

// Negative cache: last upstream-failure time per (source:ticker) key. Stops a
// 429'd symbol from being re-hit on every page load — that hammer-loop is what
// provokes more 429s. Process-local; resets on restart, which is fine.
const recentFailures = new Map<string, number>();

/**
 * The cache table (fund_quotes / nav_history) is keyed by a single TEXT column
 * called `ticker` for historical reasons. To support multiple data sources
 * cleanly we namespace inserts by combining source + ticker into one key
 * string. The combined key is internal — never returned to the UI.
 */
function cacheKey(source: string, ticker: string): string {
  return `${source}:${ticker}`;
}

function isFresh(updatedAt: string, ttlMs: number): boolean {
  return Date.now() - new Date(updatedAt).getTime() < ttlMs;
}

function yyyyMmDd(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export interface CachedSeries {
  /** Original ticker, as caller passed in. */
  ticker: string;
  series: { date: string; close: number }[];
  /** Most recent value (mirrors fund_quotes). */
  quote: {
    price: number;
    previousClose: number;
    asOf: string;
  } | null;
}

/**
 * Return cached daily series for `(source, ticker)` if it's <24h old,
 * otherwise refetch from the resolved provider and upsert into nav_history +
 * fund_quotes. The cached version is always preferred to keep upstream load
 * minimal.
 */
export async function getCachedSeries(
  source: string,
  ticker: string,
  range: SeriesRange = "6mo",
  interval: SeriesInterval = "1d",
): Promise<CachedSeries> {
  // Resolve the per-request DB so demo sessions write to their isolated
  // in-memory copy instead of the owner singleton.
  const db = getDb();
  const key = cacheKey(source, ticker);
  const cachedQuote = db.select().from(fundQuotes).where(eq(fundQuotes.ticker, key)).get();

  if (cachedQuote && isFresh(cachedQuote.updatedAt, HISTORY_TTL_MS)) {
    return readCached(db, key, ticker, range, cachedQuote);
  }

  // Skip the live call if this key failed within the backoff window — serve
  // stale if we have it, otherwise surface the outage.
  const lastFail = recentFailures.get(key);
  const backingOff = lastFail !== undefined && Date.now() - lastFail < FAIL_BACKOFF_MS;

  if (!backingOff) {
    const provider = resolveProvider(source, ticker);
    try {
      const fresh = await provider.fetchSeries(ticker, range, interval);
      recentFailures.delete(key);
      return persistFresh(db, key, ticker, fresh);
    } catch (err) {
      recentFailures.set(key, Date.now());
      // Fall back to the last good values rather than blanking the symbol on a
      // transient upstream error (e.g. Yahoo 429). Only rethrow on a cold cache.
      if (!cachedQuote) throw err;
    }
  }

  if (cachedQuote) return readCached(db, key, ticker, range, cachedQuote);
  throw new Error(`No cached data for ${key}; upstream is backing off`);
}

/** Read the cached series + quote for a key (used for fresh and stale serves). */
function readCached(
  db: ReturnType<typeof getDb>,
  key: string,
  ticker: string,
  range: SeriesRange,
  cachedQuote: { nav: number; d1Pct: number | null; updatedAt: string },
): CachedSeries {
  const sinceDate = rangeStart(range);
  const rows = db
    .select()
    .from(navHistory)
    .where(and(eq(navHistory.ticker, key), gte(navHistory.date, sinceDate)))
    .orderBy(navHistory.date)
    .all();
  return {
    ticker,
    series: rows.map((r) => ({ date: r.date, close: r.nav })),
    quote: {
      price: cachedQuote.nav,
      previousClose: cachedQuote.nav - (cachedQuote.d1Pct ?? 0),
      asOf: cachedQuote.updatedAt,
    },
  };
}

/** Upsert a freshly-fetched series into the cache and return it. */
function persistFresh(
  db: ReturnType<typeof getDb>,
  key: string,
  ticker: string,
  fresh: {
    quote: { price: number; previousClose: number };
    series: { t: number; close: number }[];
  },
): CachedSeries {
  if (fresh.series.length === 0) {
    return { ticker, series: [], quote: null };
  }

  const updatedAt = new Date().toISOString();
  const latest = fresh.series.at(-1);
  const prev = fresh.series.length > 1 ? fresh.series.at(-2) : null;
  const d1Pct = latest && prev ? ((latest.close - prev.close) / prev.close) * 100 : null;
  const ytdPct = computeYtdPct(fresh.series);
  const y1Pct = computeReturnPct(fresh.series, 365);

  db.insert(fundQuotes)
    .values({
      ticker: key,
      nav: fresh.quote.price,
      d1Pct,
      ytdPct,
      y1Pct,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: fundQuotes.ticker,
      set: {
        nav: fresh.quote.price,
        d1Pct,
        ytdPct,
        y1Pct,
        updatedAt,
      },
    })
    .run();

  for (const p of fresh.series) {
    const date = yyyyMmDd(p.t);
    db.insert(navHistory)
      .values({ ticker: key, date, nav: p.close })
      .onConflictDoUpdate({
        target: [navHistory.ticker, navHistory.date],
        set: { nav: p.close },
      })
      .run();
  }

  return {
    ticker,
    series: fresh.series.map((p) => ({ date: yyyyMmDd(p.t), close: p.close })),
    quote: {
      price: fresh.quote.price,
      previousClose: fresh.quote.previousClose,
      asOf: updatedAt,
    },
  };
}

function rangeStart(range: SeriesRange): string {
  const now = new Date();
  const days =
    range === "1mo"
      ? 31
      : range === "3mo"
        ? 92
        : range === "6mo"
          ? 183
          : range === "1y"
            ? 366
            : range === "5y"
              ? 5 * 366
              : 365 * 50;
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function computeYtdPct(series: { close: number; t: number }[]): number | null {
  if (series.length < 2) return null;
  const year = new Date().getUTCFullYear();
  const yearStart = series.find((p) => new Date(p.t * 1000).getUTCFullYear() === year);
  if (!yearStart) return null;
  const latest = series[series.length - 1];
  return ((latest.close - yearStart.close) / yearStart.close) * 100;
}

function computeReturnPct(series: { close: number; t: number }[], days: number): number | null {
  if (series.length < 2) return null;
  const cutoff = Date.now() / 1000 - days * 86400;
  const start = series.find((p) => p.t >= cutoff);
  if (!start) return null;
  const latest = series[series.length - 1];
  return ((latest.close - start.close) / start.close) * 100;
}

/**
 * Force-refresh a set of holdings. Each is fetched independently — a single
 * failure doesn't abort the rest.
 */
export async function refreshSymbols(
  refs: Array<{ source: string; ticker: string }>,
  range: SeriesRange = "6mo",
): Promise<{ source: string; ticker: string; ok: boolean; error?: string }[]> {
  const db = getDb();
  const results: { source: string; ticker: string; ok: boolean; error?: string }[] = [];
  for (const r of refs) {
    try {
      const key = cacheKey(r.source, r.ticker);
      db.delete(fundQuotes).where(eq(fundQuotes.ticker, key)).run();
      await getCachedSeries(r.source, r.ticker, range);
      results.push({ ...r, ok: true });
    } catch (err) {
      results.push({
        ...r,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** List cache entries by source+ticker, with the last-updated timestamp. */
export function listCachedSymbols(): {
  source: string;
  ticker: string;
  updatedAt: string;
  navCount: number;
}[] {
  const db = getDb();
  const rows = db
    .select({
      key: fundQuotes.ticker,
      updatedAt: fundQuotes.updatedAt,
      navCount: sql<number>`(SELECT COUNT(*) FROM nav_history WHERE ticker = ${fundQuotes.ticker})`,
    })
    .from(fundQuotes)
    .orderBy(desc(fundQuotes.updatedAt))
    .all();
  return rows.map((row) => {
    const idx = row.key.indexOf(":");
    return {
      source: idx >= 0 ? row.key.slice(0, idx) : "",
      ticker: idx >= 0 ? row.key.slice(idx + 1) : row.key,
      updatedAt: row.updatedAt,
      navCount: row.navCount,
    };
  });
}

void QUOTE_TTL_MS;
