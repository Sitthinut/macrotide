import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { fundQuotes, navHistory } from "@/lib/db/schema";
import { getSeries, type YahooInterval, type YahooRange } from "./yahoo";

const QUOTE_TTL_MS = 5 * 60_000; // 5 min for live quote
const HISTORY_TTL_MS = 24 * 60 * 60_000; // 24 h for daily series

function isFresh(updatedAt: string, ttlMs: number): boolean {
  return Date.now() - new Date(updatedAt).getTime() < ttlMs;
}

function yyyyMmDd(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export interface CachedSeries {
  symbol: string;
  series: { date: string; close: number }[];
  /** Most recent value (mirrors fund_quotes). */
  quote: {
    price: number;
    previousClose: number;
    asOf: string;
  } | null;
}

/**
 * Return cached daily series for `symbol` if it's <24h old, otherwise refetch
 * from Yahoo and upsert into nav_history + fund_quotes. The cached version is
 * always preferred to keep Yahoo load minimal.
 */
export async function getCachedSeries(
  symbol: string,
  range: YahooRange = "6mo",
  interval: YahooInterval = "1d",
): Promise<CachedSeries> {
  const cachedQuote = db.select().from(fundQuotes).where(eq(fundQuotes.ticker, symbol)).get();

  if (cachedQuote && isFresh(cachedQuote.updatedAt, HISTORY_TTL_MS)) {
    const sinceDate = rangeStart(range);
    const rows = db
      .select()
      .from(navHistory)
      .where(and(eq(navHistory.ticker, symbol), gte(navHistory.date, sinceDate)))
      .orderBy(navHistory.date)
      .all();
    return {
      symbol,
      series: rows.map((r) => ({ date: r.date, close: r.nav })),
      quote: {
        price: cachedQuote.nav,
        previousClose: cachedQuote.nav - (cachedQuote.d1Pct ?? 0),
        asOf: cachedQuote.updatedAt,
      },
    };
  }

  // Refresh from Yahoo.
  const fresh = await getSeries(symbol, range, interval);
  if (fresh.series.length === 0) {
    return { symbol, series: [], quote: null };
  }

  const updatedAt = new Date().toISOString();
  const latest = fresh.series.at(-1);
  const prev = fresh.series.length > 1 ? fresh.series.at(-2) : null;
  const d1Pct = latest && prev ? ((latest.close - prev.close) / prev.close) * 100 : null;
  const ytdPct = computeYtdPct(fresh.series);
  const y1Pct = computeReturnPct(fresh.series, 365);

  db.insert(fundQuotes)
    .values({
      ticker: symbol,
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
      .values({ ticker: symbol, date, nav: p.close })
      .onConflictDoUpdate({
        target: [navHistory.ticker, navHistory.date],
        set: { nav: p.close },
      })
      .run();
  }

  return {
    symbol,
    series: fresh.series.map((p) => ({ date: yyyyMmDd(p.t), close: p.close })),
    quote: {
      price: fresh.quote.price,
      previousClose: fresh.quote.previousClose,
      asOf: updatedAt,
    },
  };
}

function rangeStart(range: YahooRange): string {
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
 * Force-refresh a set of symbols. Used by the `npm run market:refresh` job
 * and by an admin/manual endpoint. Each symbol is fetched independently —
 * a single failure doesn't abort the rest.
 */
export async function refreshSymbols(
  symbols: string[],
  range: YahooRange = "6mo",
): Promise<{ symbol: string; ok: boolean; error?: string }[]> {
  const results: { symbol: string; ok: boolean; error?: string }[] = [];
  for (const s of symbols) {
    try {
      // Force a refresh by deleting the quote row so isFresh fails.
      db.delete(fundQuotes).where(eq(fundQuotes.ticker, s)).run();
      await getCachedSeries(s, range);
      results.push({ symbol: s, ok: true });
    } catch (err) {
      results.push({
        symbol: s,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** List symbols that have any cached history, with their last-updated timestamp. */
export function listCachedSymbols(): { ticker: string; updatedAt: string; navCount: number }[] {
  const rows = db
    .select({
      ticker: fundQuotes.ticker,
      updatedAt: fundQuotes.updatedAt,
      navCount: sql<number>`(SELECT COUNT(*) FROM nav_history WHERE ticker = ${fundQuotes.ticker})`,
    })
    .from(fundQuotes)
    .orderBy(desc(fundQuotes.updatedAt))
    .all();
  return rows;
}

void QUOTE_TTL_MS;
