import { and, gte, inArray } from "drizzle-orm";
import { inferHoldingCurrency } from "@/lib/market/currency";
import { buildFxConverter } from "@/lib/market/fx";
import { getAppDb, getMarketDb } from "../context";
import { holdings, navHistory } from "../schema";

export type SeriesRange = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";

export interface SeriesPoint {
  /** ISO YYYY-MM-DD */
  date: string;
  value: number;
}

export interface PortfolioSeriesResult {
  aggregate: SeriesPoint[];
  perBucket: Record<string, SeriesPoint[]>;
  /** ISO timestamp of the most recent nav_history row used. */
  asOf: string | null;
  /**
   * Currencies whose USD/THB (or cross) rate could not be resolved, so those
   * holdings were dropped from the totals this run. Empty = everything
   * converted cleanly. The UI surfaces this so a cold FX cache doesn't silently
   * undercount a mixed-currency book.
   */
  missingFx: string[];
}

function rangeStartDate(range: SeriesRange): string {
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
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compose per-bucket and aggregate value series from `nav_history` rows, with
 * every holding's value FX-converted into the base currency (THB) before it is
 * summed.
 *
 * For each holding we forward-fill the most recent NAV onto every business
 * date between the holding's first known nav and the latest date in range.
 * That way Thai funds (which skip weekends) and US ETFs (which skip TH
 * holidays) line up on a shared timeline. Each holding's native currency is
 * inferred from its routing key (see lib/market/currency.ts) and its
 * `units * nav` is converted to THB at that date's USD/THB (or cross) rate
 * before summing — without this, a USD ETF and a THB fund were added as if both
 * were baht. FX rates come from the existing keyless Frankfurter chain.
 *
 * NOTE: `units` is the holding's CURRENT unit count applied to every past date,
 * so any buy/sell inside the window distorts the historical curve. Fixing that
 * needs a transactions/lots table (tracked by backlog issue #38); until then
 * the comparison assumes the current book was held throughout the window.
 *
 * Aggregate series is `sum(perBucket[i])` on each shared date. Async because FX
 * rates are fetched (cached) from the market layer.
 */
export async function getPortfolioSeries(
  range: SeriesRange = "6mo",
): Promise<PortfolioSeriesResult> {
  // Cross-domain read: holdings live in app.db, their NAV series in market.db.
  // There is no SQL join — we read each side and join app-side on the soft
  // `${quoteSource}:${ticker}` cache key.
  const appDb = getAppDb();
  const marketDb = getMarketDb();
  const since = rangeStartDate(range);

  const allHoldings = appDb.select().from(holdings).all();
  if (allHoldings.length === 0) {
    return { aggregate: [], perBucket: {}, asOf: null, missingFx: [] };
  }

  const cacheKeys = Array.from(new Set(allHoldings.map((h) => `${h.quoteSource}:${h.ticker}`)));
  const navRows = marketDb
    .select()
    .from(navHistory)
    .where(and(inArray(navHistory.ticker, cacheKeys), gte(navHistory.date, since)))
    .orderBy(navHistory.date)
    .all();

  // ticker (cache key) → ordered [date, nav][]
  const navByKey = new Map<string, { date: string; nav: number }[]>();
  for (const r of navRows) {
    let arr = navByKey.get(r.ticker);
    if (!arr) {
      arr = [];
      navByKey.set(r.ticker, arr);
    }
    arr.push({ date: r.date, nav: r.nav });
  }

  // The shared timeline is the union of every date that ANY ticker has data
  // for, in range. We forward-fill missing values per holding.
  const dateSet = new Set<string>();
  for (const r of navRows) dateSet.add(r.date);
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) {
    return { aggregate: [], perBucket: {}, asOf: null, missingFx: [] };
  }

  // Native currency per holding (from quoteSource + ticker) and the per-date FX
  // converter into THB. THB-only books need no rates; the converter degrades
  // gracefully if a rate is cold (rateOn → null) and reports which currencies
  // failed via `missing`.
  const currencyByHolding = new Map<number, string>();
  const currencies = new Set<string>();
  for (const h of allHoldings) {
    const ccy = inferHoldingCurrency(h.quoteSource, h.ticker);
    currencyByHolding.set(h.id, ccy);
    currencies.add(ccy);
  }
  const fx = await buildFxConverter(currencies, range, dates);

  // For each cache key, build a forward-fill function over the shared dates.
  const forwardFill = (key: string): Map<string, number> => {
    const out = new Map<string, number>();
    const rows = navByKey.get(key);
    if (!rows || rows.length === 0) return out;
    let i = 0;
    let last: number | null = null;
    for (const d of dates) {
      while (i < rows.length && rows[i].date <= d) {
        last = rows[i].nav;
        i++;
      }
      if (last !== null) out.set(d, last);
    }
    return out;
  };

  const filled = new Map<string, Map<string, number>>();
  for (const key of cacheKeys) filled.set(key, forwardFill(key));

  // Group holdings by bucket once so we sum efficiently.
  const byBucket = new Map<string, typeof allHoldings>();
  for (const h of allHoldings) {
    let arr = byBucket.get(h.bucketId);
    if (!arr) {
      arr = [];
      byBucket.set(h.bucketId, arr);
    }
    arr.push(h);
  }

  const perBucket: Record<string, SeriesPoint[]> = {};
  const aggregateByDate = new Map<string, number>();

  for (const [bucketId, bucketHoldings] of byBucket) {
    const series: SeriesPoint[] = [];
    for (const d of dates) {
      let value = 0;
      let anyValue = false;
      for (const h of bucketHoldings) {
        const key = `${h.quoteSource}:${h.ticker}`;
        const nav = filled.get(key)?.get(d);
        if (nav === undefined) continue;
        // Convert native value → THB at this date's rate. A null rate (cold FX
        // cache) drops the holding from the total rather than summing raw
        // foreign NAV as if it were baht — reported via missingFx below.
        const ccy = currencyByHolding.get(h.id) ?? "USD";
        const rate = fx.rateOn(ccy, d);
        if (rate === null) continue;
        value += h.units * nav * rate;
        anyValue = true;
      }
      // Skip leading dates where no holding in this bucket has data yet.
      if (anyValue) {
        series.push({ date: d, value });
        aggregateByDate.set(d, (aggregateByDate.get(d) ?? 0) + value);
      }
    }
    perBucket[bucketId] = series;
  }

  const aggregate: SeriesPoint[] = dates
    .filter((d) => aggregateByDate.has(d))
    .map((d) => ({ date: d, value: aggregateByDate.get(d) ?? 0 }));

  return {
    aggregate,
    perBucket,
    asOf: dates[dates.length - 1] ?? null,
    missingFx: Array.from(fx.missing).sort(),
  };
}
