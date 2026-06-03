import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { inferHoldingCurrency } from "@/lib/market/currency";
import { buildFxConverter } from "@/lib/market/fx";
import { demoHoldingSeries } from "@/lib/mock/demo-history-read";
import { getAppDb, getMarketDb, isDemoRequest, type MarketDb } from "../context";
import { fundCatalog, holdings, navHistory } from "../schema";

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
  /**
   * True if any held holding is a fund whose `fund_catalog.distributionPolicy`
   * is "dividend" — i.e. it pays distributions out rather than accumulating
   * them. The balance line is price return (units × NAV) and never reinvests
   * those payouts, so when this is set the user's real total return is higher
   * than the line shown. Drives the performance-vs-index disclaimer copy.
   * Only `thai_mutual_fund` holdings can match the catalog (joined app-side on
   * the bare ticker = `fund_catalog.abbr_name`); non-Thai holdings never match
   * and correctly don't trigger it.
   */
  hasDistributingHolding: boolean;
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
/**
 * Demo-mode replacement for the market.db `nav_history` read. Builds the same
 * `{ ticker (cache key), date, nav }` rows the DB would, but from the committed
 * fixture: fixture points are the holding's TOTAL THB value, so per-unit
 * `nav = value / units` recovers what the downstream `units * nav * fx` math
 * expects. Holdings with no fixture series (unmapped) are simply omitted —
 * graceful degradation, identical to a market.db cache miss.
 */
function demoNavRows(
  allHoldings: { quoteSource: string; ticker: string; units: number }[],
  since: string,
): { ticker: string; date: string; nav: number }[] {
  const seen = new Set<string>();
  const rows: { ticker: string; date: string; nav: number }[] = [];
  for (const h of allHoldings) {
    const key = `${h.quoteSource}:${h.ticker}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!h.units) continue;
    // demoHoldingSeries supplies the in-window points plus a carry-in dated to
    // `since`, so every holding has a value on the window's first date.
    const series = demoHoldingSeries(key, since);
    if (!series) continue;
    for (const p of series) rows.push({ ticker: key, date: p.date, nav: p.value / h.units });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Owner-mode nav_history read with CARRY-IN. Returns the in-window rows
 * (`date >= since`) PLUS, for each cache key that has NO row exactly on `since`,
 * its most recent pre-window nav re-dated to `since`. That seeds the forward-fill
 * so the window's FIRST date is never partial (e.g. a window that opens on a
 * weekend/holiday still shows every holding). The carry-in date is `since`
 * itself, so it never widens the plotted timeline before the window start.
 */
function marketNavRows(
  marketDb: MarketDb,
  cacheKeys: string[],
  since: string,
): { ticker: string; date: string; nav: number }[] {
  const inWindow = marketDb
    .select({ ticker: navHistory.ticker, date: navHistory.date, nav: navHistory.nav })
    .from(navHistory)
    .where(and(inArray(navHistory.ticker, cacheKeys), gte(navHistory.date, since)))
    .orderBy(navHistory.date)
    .all();

  // Latest pre-window nav per cache key: group by ticker, take max(date) < since,
  // then the nav on that row. One grouped query, not a per-key scan. Relies on
  // SQLite's documented "bare column" rule: with max(date) in the SELECT, the
  // bare `nav` column comes from the row holding that max date.
  const carryIn = marketDb
    .select({
      ticker: navHistory.ticker,
      date: sql<string>`max(${navHistory.date})`.as("d"),
      nav: navHistory.nav,
    })
    .from(navHistory)
    .where(and(inArray(navHistory.ticker, cacheKeys), lt(navHistory.date, since)))
    .groupBy(navHistory.ticker)
    .all();

  // Only carry in keys that lack an exact `since` row, re-dating the carry to
  // `since` so it seeds the fill without adding a pre-window date.
  const hasSinceRow = new Set(inWindow.filter((r) => r.date === since).map((r) => r.ticker));
  const rows = [...inWindow];
  for (const c of carryIn) {
    if (!hasSinceRow.has(c.ticker)) rows.push({ ticker: c.ticker, date: since, nav: c.nav });
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * True if any of the given holding tickers is a catalog fund with a "dividend"
 * distribution policy. The user-visible ticker is the fund's `abbr_name` in
 * `fund_catalog` (same bare-ticker mapping the fund-detail route uses), so we
 * match held tickers against `abbr_name` and ask whether any matched row pays
 * dividends out. One indexed query over the held tickers; works in demo mode
 * too since the catalog lives in the shared market.db. Empty input → false.
 */
function holdsDistributingFund(marketDb: MarketDb, tickers: string[]): boolean {
  if (tickers.length === 0) return false;
  const row = marketDb
    .select({ n: sql<number>`count(*)` })
    .from(fundCatalog)
    .where(
      and(inArray(fundCatalog.abbrName, tickers), eq(fundCatalog.distributionPolicy, "dividend")),
    )
    .get();
  return (row?.n ?? 0) > 0;
}

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
    return {
      aggregate: [],
      perBucket: {},
      asOf: null,
      missingFx: [],
      hasDistributingHolding: false,
    };
  }

  // Does the book hold any dividend-paying fund? Joined app-side: held tickers
  // are catalog `abbr_name`s. Independent of the NAV/date math below, so it's
  // returned even when the series itself comes back empty.
  const heldTickers = Array.from(new Set(allHoldings.map((h) => h.ticker)));
  const hasDistributingHolding = holdsDistributingFund(marketDb, heldTickers);

  const cacheKeys = Array.from(new Set(allHoldings.map((h) => `${h.quoteSource}:${h.ticker}`)));

  // DEMO MODE: source NAV history from the committed fixture instead of
  // market.db. The fixture holds ~5y of TOTAL value per holding (units × NAV,
  // already scaled to the seeded current value, in THB); we divide by the
  // holding's units to recover a per-unit "nav" so the rest of this function —
  // forward-fill, FX (THB→THB = 1), aggregation — runs unchanged. Owner mode is
  // untouched and still reads market.db. Both sources seed a carry-in on `since`
  // so the window's first date is never partial. See lib/mock/demo-history.ts.
  const navRows = isDemoRequest()
    ? demoNavRows(allHoldings, since)
    : marketNavRows(marketDb, cacheKeys, since);

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
    return { aggregate: [], perBucket: {}, asOf: null, missingFx: [], hasDistributingHolding };
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
    hasDistributingHolding,
  };
}
