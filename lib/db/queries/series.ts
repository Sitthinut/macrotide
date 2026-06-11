import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { BASE_CURRENCY, inferHoldingCurrency } from "@/lib/market/currency";
import { buildFxConverter } from "@/lib/market/fx";
import { quoteCacheKey } from "@/lib/market/sources";
import { demoHoldingSeries } from "@/lib/mock/demo-history-read";
import { type LedgerTxn, type PositionCheckpoint, reduceLots } from "@/lib/portfolio/lots";
import { type CashPoint, foldSettlementCash } from "@/lib/portfolio/settlement-cash";
import { toLedgerTxn } from "@/lib/portfolio/transaction-analytics";
import { isAnchorKind } from "@/lib/portfolio/txn-import";
import { getMarketDb, isDemoRequest, type MarketDb } from "../context";
import { fundCatalog, navHistory } from "../schema";
import { listBuckets } from "./buckets";
import { listHoldings } from "./holdings";
import { foldableEvents } from "./resolve-derived-units";
import { listTransactionsForBuckets, type Transaction } from "./transactions";

export type SeriesRange = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";

export interface SeriesPoint {
  /** ISO YYYY-MM-DD */
  date: string;
  value: number;
}

export interface PortfolioSeriesResult {
  aggregate: SeriesPoint[];
  perBucket: Record<string, SeriesPoint[]>;
  /**
   * Cumulative EXTERNAL money in the book (inflows minus expired/withdrawn
   * proceeds) on the same dates as `aggregate` — the chart's contribution
   * line. Derived from the settlement-cash fold, NOT from
   * `reduceLots().netInvested`: that subtracts sale PROCEEDS (the right sign
   * convention for XIRR) and so would phantom-swing on every fund switch.
   */
  netInvested: SeriesPoint[];
  netInvestedByBucket: Record<string, SeriesPoint[]>;
  /**
   * In-transit settlement cash included in `aggregate` per date (sell proceeds
   * not yet reinvested, within the settlement window). Lets the UI disclose
   * "incl. ฿X cash in transit" instead of baking it in silently.
   */
  cash: SeriesPoint[];
  /** ISO timestamp of the most recent plotted date. */
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
  /**
   * Latest plotted date on which some position was valued from the ledger's own
   * trade-implied prices (or carried at cost) rather than a cached NAV — i.e.
   * history up to here is partly estimated. Null = every point is cache-priced.
   * Drives the chart's disclosure caption.
   */
  estimatedThrough: string | null;
  /**
   * Tickers that had held-but-unpriceable dates with no cost basis to carry —
   * those positions contributed nothing on those dates. Rare (a derived-units
   * row with no NAV anywhere); surfaced rather than silently dropped.
   */
  unpriced: string[];
}

const EMPTY_RESULT: Omit<PortfolioSeriesResult, "hasDistributingHolding"> = {
  aggregate: [],
  perBucket: {},
  netInvested: [],
  netInvestedByBucket: {},
  cash: [],
  asOf: null,
  missingFx: [],
  estimatedThrough: null,
  unpriced: [],
};

const UNIT_EPSILON = 1e-9;

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
 * Demo-mode replacement for the market.db `nav_history` read. Builds the same
 * `{ ticker (cache key), date, nav }` rows the DB would, but from the committed
 * fixture: fixture points are the holding's per-unit NAV in THB, same shape as
 * a market.db row. Holdings with no fixture series (unmapped) are simply
 * omitted — graceful degradation, identical to a market.db cache miss.
 */
function demoNavRows(
  allHoldings: { quoteSource: string; ticker: string }[],
  since: string,
): { ticker: string; date: string; nav: number }[] {
  const seen = new Set<string>();
  const rows: { ticker: string; date: string; nav: number }[] = [];
  for (const h of allHoldings) {
    const key = quoteCacheKey(h.quoteSource, h.ticker);
    if (seen.has(key)) continue;
    seen.add(key);
    // demoHoldingSeries supplies the in-window points plus a carry-in dated to
    // `since`, so every holding has a value on the window's first date.
    const series = demoHoldingSeries(key, since);
    if (!series) continue;
    for (const p of series) rows.push({ ticker: key, date: p.date, nav: p.value });
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

/**
 * Real prices the user transacted at, recovered from the ledger itself: a
 * trade's execution price (else |amount| ÷ units), and a Balance's
 * value ÷ units. These honestly price the era BEFORE a fund's cached NAV
 * coverage begins — and funds that never get coverage (e.g. liquidated ones).
 * An anchor's `pricePerUnit` is an avg COST, not a market price — never used.
 * THB-priced keys only: the ledger's money fields are THB, so an implied point
 * for a foreign-currency key would corrupt the per-date FX conversion.
 */
function tradeImpliedRows(
  events: readonly Transaction[],
  currencyByKey: ReadonlyMap<string, string>,
): { ticker: string; date: string; nav: number }[] {
  const rows: { ticker: string; date: string; nav: number }[] = [];
  for (const r of events) {
    if (r.units == null || r.units <= 0) continue;
    const key = quoteCacheKey(r.quoteSource, r.ticker);
    if (currencyByKey.get(key) !== BASE_CURRENCY) continue;
    let price: number | null = null;
    if (r.kind === "buy" || r.kind === "sell" || r.kind === "reinvest") {
      price =
        r.pricePerUnit && r.pricePerUnit > 0
          ? r.pricePerUnit
          : Math.abs(r.amount) > 0
            ? Math.abs(r.amount) / r.units
            : null;
    } else if (isAnchorKind(r.kind) && r.value != null && r.value > 0) {
      price = r.value / r.units;
    }
    if (price !== null && Number.isFinite(price)) {
      rows.push({ ticker: key, date: r.tradeDate, nav: price });
    }
  }
  return rows;
}

/**
 * Pointer walker over a date-ascending point list: `at(d)` returns the last
 * point with date ≤ d. Queries MUST come in ascending date order (they do —
 * the axis is sorted); that makes the whole replay O(events + dates).
 */
function stepWalker<T extends { date: string }>(points: readonly T[]): (d: string) => T | null {
  let i = 0;
  let last: T | null = null;
  return (d: string) => {
    while (i < points.length && points[i].date <= d) {
      last = points[i];
      i++;
    }
    return last;
  };
}

/**
 * Compose per-bucket and aggregate value series by REPLAYING THE LEDGER, plus a
 * contribution (net-invested) line, with every value FX-converted into the base
 * currency (THB) before it is summed.
 *
 * Per bucket, the lot fold (`reduceLots`) yields every position's units and
 * remaining cost basis after each event; the settlement-cash fold yields the
 * bucket's in-transit cash and external flows. On each chart date:
 *
 *   value = Σ units(position, date) × NAV(date) × fx(date) + cash(date)
 *
 * A position contributes 0 before its first ledger event — a Balance entered
 * today is a point today, never a back-projected multi-year curve (an anchor
 * asserts nothing about the past, ADR 0004). Exited positions keep
 * contributing over the dates they were held. NAV gaps are forward-filled per
 * holding so Thai funds (skip weekends) and US ETFs (skip TH holidays) share a
 * timeline; dates a fund was held before its cached NAV coverage are priced
 * from the ledger's own trade-implied prices (`tradeImpliedRows`), falling
 * back to carrying the position at cost — both reported via
 * `estimatedThrough`. Each holding's native currency is inferred from its
 * routing key (lib/market/currency.ts) and converted at that date's USD/THB
 * (or cross) rate before summing — without this, a USD ETF and a THB fund were
 * added as if both were baht. FX rates come from the existing keyless
 * Frankfurter chain. Aggregate series is the per-bucket sum on each date.
 * Async because FX rates are fetched (cached) from the market layer.
 */
export async function getPortfolioSeries(
  range: SeriesRange = "6mo",
): Promise<PortfolioSeriesResult> {
  // Cross-domain read: the ledger lives in app.db, NAV series in market.db.
  // There is no SQL join — we read each side and join app-side on the soft
  // `${quoteSource}:${ticker}` cache key.
  const marketDb = getMarketDb();
  const since = rangeStartDate(range);
  const today = new Date().toISOString().slice(0, 10);

  const buckets = listBuckets();
  const ledger = listTransactionsForBuckets(buckets.map((b) => b.id));
  // Holdings are NOT the basket (exited positions must chart) — they supply the
  // distributing-fund flag and the demo fixture mapping only.
  const allHoldings = listHoldings();

  const heldTickers = Array.from(new Set(allHoldings.map((h) => h.ticker)));
  const hasDistributingHolding = holdsDistributingFund(marketDb, heldTickers);
  if (ledger.length === 0) return { ...EMPTY_RESULT, hasDistributingHolding };

  // Facts-only rows → fold-ready events (derive value-only Balance units at
  // tradeDate NAV; drop anchors that stay unresolved) — the same pre-pass the
  // holdings projection and analytics run, so the chart can't disagree with them.
  const events = foldableEvents(ledger);
  const byBucket = new Map<string, Transaction[]>();
  for (const r of events) {
    let arr = byBucket.get(r.bucketId);
    if (!arr) {
      arr = [];
      byBucket.set(r.bucketId, arr);
    }
    arr.push(r);
  }

  // One cache key + currency per (bucket, ledger ticker) — the last row's
  // quote_source wins, matching how the holdings projection routes a ticker.
  const keyByBucketTicker = new Map<string, string>();
  const keyMeta = new Map<string, { quoteSource: string; ticker: string }>();
  for (const r of events) {
    const key = quoteCacheKey(r.quoteSource, r.ticker);
    keyByBucketTicker.set(`${r.bucketId} ${r.ticker}`, key);
    keyMeta.set(key, { quoteSource: r.quoteSource, ticker: r.ticker });
  }
  const cacheKeys = Array.from(keyMeta.keys());
  const currencyByKey = new Map<string, string>();
  const currencies = new Set<string>();
  for (const [key, m] of keyMeta) {
    const ccy = inferHoldingCurrency(m.quoteSource, m.ticker);
    currencyByKey.set(key, ccy);
    currencies.add(ccy);
  }

  // DEMO MODE: source NAV history from the committed fixture instead of
  // market.db. Both sources seed a carry-in on `since` so the window's first
  // date is never partial. See lib/mock/demo-history.ts.
  const navRows = isDemoRequest()
    ? demoNavRows(allHoldings, since)
    : marketNavRows(marketDb, cacheKeys, since);

  // Merge cached NAVs with trade-implied prices per key. Cached rows win on a
  // date collision (the provider's close beats a fee-skewed implied point).
  // Implied rows keep their PRE-WINDOW dates: they never join the axis, but
  // they seed the forward-fill so a window opening mid-gap is still priced.
  const rowsByKey = new Map<string, Map<string, number>>();
  const firstCachedByKey = new Map<string, string>();
  for (const r of tradeImpliedRows(events, currencyByKey)) {
    let m = rowsByKey.get(r.ticker);
    if (!m) {
      m = new Map();
      rowsByKey.set(r.ticker, m);
    }
    m.set(r.date, r.nav);
  }
  for (const r of navRows) {
    let m = rowsByKey.get(r.ticker);
    if (!m) {
      m = new Map();
      rowsByKey.set(r.ticker, m);
    }
    m.set(r.date, r.nav);
    const first = firstCachedByKey.get(r.ticker);
    if (first === undefined || r.date < first) firstCachedByKey.set(r.ticker, r.date);
  }

  // The shared timeline: every in-window date any key has data for, plus every
  // in-window ledger event date (cash and contribution step on event dates,
  // which need not be NAV dates).
  const dateSet = new Set<string>();
  for (const r of navRows) dateSet.add(r.date);
  for (const r of events) {
    if (r.tradeDate >= since && r.tradeDate <= today) dateSet.add(r.tradeDate);
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return { ...EMPTY_RESULT, hasDistributingHolding };

  // Native-currency → THB converter for the shared dates. THB-only books need
  // no rates; the converter degrades gracefully if a rate is cold (rateOn →
  // null) and reports which currencies failed via `missing`.
  const fx = await buildFxConverter(currencies, range, dates);

  // Forward-fill each key over the shared dates (pre-window implied rows fold
  // into the seed value before the first axis date).
  const filled = new Map<string, Map<string, number>>();
  for (const [key, byDate] of rowsByKey) {
    const rows = Array.from(byDate.entries())
      .map(([date, nav]) => ({ date, nav }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const out = new Map<string, number>();
    let i = 0;
    let last: number | null = null;
    for (const d of dates) {
      while (i < rows.length && rows[i].date <= d) {
        last = rows[i].nav;
        i++;
      }
      if (last !== null) out.set(d, last);
    }
    filled.set(key, out);
  }
  // A date is estimate-priced for a key until its first CACHED nav lands.
  const isEstimated = (key: string, d: string): boolean => {
    const first = firstCachedByKey.get(key);
    return first === undefined || d < first;
  };

  const perBucket: Record<string, SeriesPoint[]> = {};
  const netInvestedByBucket: Record<string, SeriesPoint[]> = {};
  const aggregateByDate = new Map<string, number>();
  const investedByDate = new Map<string, number>();
  const cashByDate = new Map<string, number>();
  // THB value priced from trade-implied prices / cost-carry (not cached NAV) per
  // date — drives a MATERIALITY-gated `estimatedThrough` so one dust position
  // with shallow NAV coverage can't imply the whole history is estimated.
  const estimatedByDate = new Map<string, number>();
  const emittedDates = new Set<string>();
  const unpriced = new Set<string>();

  for (const [bucketId, bucketEvents] of byBucket) {
    const ledgerTxns: LedgerTxn[] = bucketEvents.map(toLedgerTxn);
    const { positionTimeline, realized } = reduceLots(ledgerTxns);
    // Per-sell cost basis so a withdrawal removes capital, not realized gain —
    // otherwise cashing out at a profit drives the contribution line negative.
    const costBySellId = new Map<number, number>();
    for (const ev of realized) if (ev.id != null) costBySellId.set(ev.id, ev.costRemoved);
    const { cashTimeline, externalFlows } = foldSettlementCash(
      ledgerTxns,
      today,
      undefined,
      costBySellId,
    );

    const tickerWalkers: [string, (d: string) => PositionCheckpoint | null][] = [];
    for (const [ticker, checkpoints] of positionTimeline) {
      tickerWalkers.push([ticker, stepWalker(checkpoints)]);
    }
    const cashAt = stepWalker<CashPoint>(cashTimeline);
    let running = 0;
    const contributions = externalFlows.map((f) => {
      running += f.amount;
      return { date: f.date, value: running };
    });
    const contribAt = stepWalker(contributions);

    // The bucket exists on the chart from its first ledger event — never before.
    const firstEvent = bucketEvents.reduce(
      (min, r) => (r.tradeDate < min ? r.tradeDate : min),
      bucketEvents[0].tradeDate,
    );

    const series: SeriesPoint[] = [];
    const invested: SeriesPoint[] = [];
    for (const d of dates) {
      if (d < firstEvent) continue;
      const cash = cashAt(d)?.cash ?? 0;
      let value = cash;
      for (const [ticker, at] of tickerWalkers) {
        const cp = at(d);
        if (!cp || cp.units <= UNIT_EPSILON) continue;
        const key = keyByBucketTicker.get(`${bucketId} ${ticker}`);
        const nav = key === undefined ? undefined : filled.get(key)?.get(d);
        if (nav !== undefined && key !== undefined) {
          // Convert native value → THB at this date's rate. A null rate (cold
          // FX cache) drops the holding from the total rather than summing raw
          // foreign NAV as if it were baht — reported via missingFx below.
          const rate = fx.rateOn(currencyByKey.get(key) ?? "USD", d);
          if (rate === null) continue;
          const thb = cp.units * nav * rate;
          value += thb;
          if (isEstimated(key, d)) estimatedByDate.set(d, (estimatedByDate.get(d) ?? 0) + thb);
        } else if (cp.costBasis !== null && cp.costBasis > 0) {
          // Held but unpriceable on this date: carry at remaining cost (THB) —
          // contribution-without-growth beats vanishing from the chart.
          value += cp.costBasis;
          estimatedByDate.set(d, (estimatedByDate.get(d) ?? 0) + cp.costBasis);
        } else {
          unpriced.add(ticker);
        }
      }
      series.push({ date: d, value });
      const contributed = contribAt(d)?.value ?? 0;
      invested.push({ date: d, value: contributed });
      aggregateByDate.set(d, (aggregateByDate.get(d) ?? 0) + value);
      investedByDate.set(d, (investedByDate.get(d) ?? 0) + contributed);
      cashByDate.set(d, (cashByDate.get(d) ?? 0) + cash);
      emittedDates.add(d);
    }
    perBucket[bucketId] = series;
    netInvestedByBucket[bucketId] = invested;
  }

  const plotted = dates.filter((d) => emittedDates.has(d));

  // Latest date where estimate-priced positions are a MATERIAL share (>2%) of
  // the day's value. Gating by share (not "any position") stops a tiny
  // late-covered holding from captioning the whole chart as estimated, while
  // still flagging the genuine pre-NAV-coverage era when major holdings were
  // trade-priced. `plotted` is date-ascending, so the last match wins.
  const ESTIMATE_MATERIALITY = 0.02;
  let estimatedThrough: string | null = null;
  for (const d of plotted) {
    const total = aggregateByDate.get(d) ?? 0;
    if (total > 0 && (estimatedByDate.get(d) ?? 0) / total > ESTIMATE_MATERIALITY) {
      estimatedThrough = d;
    }
  }

  const aggregate: SeriesPoint[] = plotted.map((d) => ({
    date: d,
    value: aggregateByDate.get(d) ?? 0,
  }));
  const netInvested: SeriesPoint[] = plotted.map((d) => ({
    date: d,
    value: investedByDate.get(d) ?? 0,
  }));
  const cash: SeriesPoint[] = plotted.map((d) => ({ date: d, value: cashByDate.get(d) ?? 0 }));

  return {
    aggregate,
    perBucket,
    netInvested,
    netInvestedByBucket,
    cash,
    asOf: plotted[plotted.length - 1] ?? null,
    missingFx: Array.from(fx.missing).sort(),
    hasDistributingHolding,
    estimatedThrough,
    unpriced: Array.from(unpriced).sort(),
  };
}

export interface HoldingValueSeriesResult {
  /** Market value of the position per date (units × NAV × fx), THB. */
  value: SeriesPoint[];
  /** Remaining cost basis per date (what you've put in, net of sells), THB. */
  costBasis: SeriesPoint[];
  /** Most recent plotted date, or null when the holding never charts. */
  asOf: string | null;
  /**
   * Latest plotted date valued from trade-implied prices / cost-carry rather
   * than a cached NAV — history up to here is partly estimated. Null = every
   * point is cache-priced. Drives the chart's disclosure caption.
   */
  estimatedThrough: string | null;
  /** Currency that couldn't be FX-converted (value degraded on those dates). */
  missingFx: string[];
}

const EMPTY_HOLDING_SERIES: HoldingValueSeriesResult = {
  value: [],
  costBasis: [],
  asOf: null,
  estimatedThrough: null,
  missingFx: [],
};

/**
 * Value-over-time for a SINGLE holding — the per-position slice of the same
 * ledger replay `getPortfolioSeries` runs (ADR 0005), before it's summed into a
 * bucket. The instrument is folded across every bucket it appears in (matching
 * the ticker-scoped analytics endpoint), so the position screen shows the whole
 * holding, not a per-bucket slice.
 *
 * On each chart date: `value = units(date) × NAV(date) × fx(date)` — 0 before
 * the first event, exited positions still charted over the dates held, history
 * before the fund's cached NAV coverage priced from the ledger's own
 * trade-implied prices (carried at cost as a last resort), and the native
 * currency converted to THB. The cost-basis line is the lot fold's remaining
 * basis over the same axis, so the gap to the value line reads as unrealized
 * gain. Reuses the same NAV/FX/forward-fill helpers as `getPortfolioSeries`.
 */
export async function getHoldingValueSeries(
  ticker: string,
  range: SeriesRange = "6mo",
): Promise<HoldingValueSeriesResult> {
  const marketDb = getMarketDb();
  const since = rangeStartDate(range);
  const today = new Date().toISOString().slice(0, 10);

  const buckets = listBuckets();
  const ledger = listTransactionsForBuckets(buckets.map((b) => b.id));
  if (ledger.length === 0) return EMPTY_HOLDING_SERIES;

  // One instrument across every bucket it appears in. `foldableEvents` is the
  // same pre-pass holdings/analytics run, so the chart can't disagree with them.
  const events = foldableEvents(ledger).filter((r) => r.ticker === ticker);
  if (events.length === 0) return EMPTY_HOLDING_SERIES;

  const ledgerTxns: LedgerTxn[] = events.map(toLedgerTxn);
  const { positionTimeline, basisTimeline } = reduceLots(ledgerTxns);
  const checkpoints = positionTimeline.get(ticker) ?? [];

  // Routing key + currency (last event's quote_source wins, mirroring the
  // holdings projection and getPortfolioSeries).
  let quoteSource = events[0].quoteSource;
  for (const r of events) quoteSource = r.quoteSource;
  const key = quoteCacheKey(quoteSource, ticker);
  const currency = inferHoldingCurrency(quoteSource, ticker);
  const currencyByKey = new Map([[key, currency]]);

  // NAV rows for this key only (demo fixture or market.db), merged with the
  // ledger's trade-implied prices. Cached rows win on a date collision.
  const navRows = (
    isDemoRequest()
      ? demoNavRows([{ quoteSource, ticker }], since)
      : marketNavRows(marketDb, [key], since)
  ).filter((r) => r.ticker === key);

  const byDate = new Map<string, number>();
  let firstCached: string | undefined;
  for (const r of tradeImpliedRows(events, currencyByKey)) {
    if (r.ticker === key) byDate.set(r.date, r.nav);
  }
  for (const r of navRows) {
    byDate.set(r.date, r.nav);
    if (firstCached === undefined || r.date < firstCached) firstCached = r.date;
  }

  // Shared axis: every in-window NAV date + every in-window ledger event date
  // (cost-basis steps land on event dates, which need not be NAV dates).
  const dateSet = new Set<string>();
  for (const r of navRows) dateSet.add(r.date);
  for (const r of events) {
    if (r.tradeDate >= since && r.tradeDate <= today) dateSet.add(r.tradeDate);
  }
  const dates = Array.from(dateSet).sort();
  if (dates.length === 0) return EMPTY_HOLDING_SERIES;

  const fx = await buildFxConverter(new Set([currency]), range, dates);

  // Forward-fill NAV over the shared dates (pre-window implied rows fold into
  // the seed before the first axis date).
  const sortedNav = Array.from(byDate.entries())
    .map(([date, nav]) => ({ date, nav }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const filled = new Map<string, number>();
  {
    let i = 0;
    let last: number | null = null;
    for (const d of dates) {
      while (i < sortedNav.length && sortedNav[i].date <= d) {
        last = sortedNav[i].nav;
        i++;
      }
      if (last !== null) filled.set(d, last);
    }
  }
  const isEstimated = (d: string): boolean => firstCached === undefined || d < firstCached;

  const firstEvent = events.reduce(
    (min, r) => (r.tradeDate < min ? r.tradeDate : min),
    events[0].tradeDate,
  );

  const unitsAt = stepWalker(checkpoints);
  const basisAt = stepWalker(basisTimeline);
  const value: SeriesPoint[] = [];
  const costBasis: SeriesPoint[] = [];
  let estimatedThrough: string | null = null;

  for (const d of dates) {
    if (d < firstEvent) continue;
    const cp = unitsAt(d);
    let v = 0;
    let estimated = false;
    if (cp && cp.units > UNIT_EPSILON) {
      const nav = filled.get(d);
      if (nav !== undefined) {
        const rate = fx.rateOn(currency, d);
        if (rate !== null) {
          v = cp.units * nav * rate;
          estimated = isEstimated(d);
        }
      } else if (cp.costBasis !== null && cp.costBasis > 0) {
        // Held but unpriceable on this date: carry at remaining cost.
        v = cp.costBasis;
        estimated = true;
      }
    }
    if (estimated && v > 0) estimatedThrough = d;
    value.push({ date: d, value: v });
    costBasis.push({ date: d, value: basisAt(d)?.costBasis ?? 0 });
  }

  return {
    value,
    costBasis,
    asOf: value[value.length - 1]?.date ?? null,
    estimatedThrough,
    missingFx: Array.from(fx.missing).sort(),
  };
}
