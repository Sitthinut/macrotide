// Seed mock data into a fresh demo SQLite. Mirrors lib/mock/seed.ts but runs
// against an in-memory app.db passed in (no path resolution, no migrations).
//
// This seeds ONLY the precious, user-authored side: model portfolios, buckets,
// holdings, the plan, and journal entries — the tables that live in the demo's
// isolated in-memory app.db.
//
// Market data is NOT seeded here. After the database split, a demo session
// uses the SHARED real market.db (fund catalog/fees + the NAV/quote cache)
// read-write, like a real user — it reads from and warms the same cache (see
// lib/api/with-db.ts and lib/market/cache.ts). The persona's holdings point at
// REAL Thai-fund tickers (lib/mock/data.ts), so the live NAV path prices them
// against real SEC NAVs and write-throughs any cache misses into the shared file.

import type { drizzle } from "drizzle-orm/better-sqlite3";
import {
  buckets,
  holdings,
  journalEntries,
  modelPortfolios,
  plans,
  transactions,
} from "../db/schema";
import type * as appSchema from "../db/schema/app";
import { MODEL_PORTFOLIOS, PORTFOLIOS, USER_GOALS, USER_JOURNAL, USER_PLAN } from "./data";
import { demoHoldingSeries } from "./demo-history-read";

type Db = ReturnType<typeof drizzle<typeof appSchema>>;
const REFERENCE_TODAY = new Date("2026-05-21T00:00:00Z");

// All demo seed holdings are Thai mutual funds, per the existing seed.
const DEMO_QUOTE_SOURCE = "thai_mutual_fund" as const;

/** One ledger row of the persona's trade history. */
interface StoryLeg {
  kind: "buy" | "sell";
  tradeDate: string;
  units: number;
  /** Signed THB (buy negative, sell positive). */
  amount: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The persona's DATED trade history for one holding — the value-over-time
 * chart REPLAYS the ledger (a position contributes nothing before its first
 * event), so a believable demo needs believable trades, not an opening anchor
 * stamped "today" (that would collapse the 5-year chart to a single point).
 *
 * Default story: one buy on the holding's first fixture date at the seeded
 * cost (terminal units and avg cost stay exactly data.ts's). The first
 * portfolio gets flavour that exercises the replay machinery end-to-end:
 *   • holding[0]: bought in two tranches (a DCA step on the contribution line),
 *   • holding[1]: bought 10% heavy, trimmed mid-history at the then-current
 *     fixture NAV (a realized gain),
 *   • holding[2]: the trim's proceeds re-deployed a week later (a fund switch —
 *     in-transit settlement cash, no external flow).
 * Every story still folds to data.ts's terminal unit count.
 */
function storyLegs(
  portfolioIndex: number,
  holdingIndex: number,
  h: { ticker: string; units: number; cost: number },
  siblings: { ticker: string; units: number; cost: number }[],
): StoryLeg[] {
  const nav = (ticker: string) => demoHoldingSeries(`${DEMO_QUOTE_SOURCE}:${ticker}`);
  const series = nav(h.ticker);
  // No fixture series → a plain dated buy; the chart prices it from the trade.
  const FALLBACK_START = "2022-06-01";
  const start = series?.[0]?.date ?? FALLBACK_START;
  const single: StoryLeg[] = [{ kind: "buy", tradeDate: start, units: h.units, amount: -h.cost }];
  if (portfolioIndex !== 0 || !series || series.length < 12) return single;

  if (holdingIndex === 0) {
    // DCA: 60% at inception, 40% a third of the way through the history.
    const mid = series[Math.floor(series.length / 3)];
    return [
      { kind: "buy", tradeDate: start, units: round4(h.units * 0.6), amount: -h.cost * 0.6 },
      { kind: "buy", tradeDate: mid.date, units: round4(h.units * 0.4), amount: -h.cost * 0.4 },
    ];
  }

  if (holdingIndex === 1 || holdingIndex === 2) {
    // The switch pair: trim holding[1] mid-history, redeploy into holding[2].
    const seller = siblings[1];
    const buyer = siblings[2];
    const sellerSeries = seller ? nav(seller.ticker) : null;
    const buyerSeries = buyer ? nav(buyer.ticker) : null;
    if (seller && buyer && sellerSeries && buyerSeries) {
      const m = Math.floor(sellerSeries.length / 2);
      const sellPoint = sellerSeries[m];
      const rebuyPoint = buyerSeries.find((p) => p.date > sellPoint.date) ?? null;
      const trimUnits = round4(seller.units * 0.1);
      const proceeds = round4(trimUnits * sellPoint.value);
      const rebuyUnits = rebuyPoint ? round4(proceeds / rebuyPoint.value) : 0;
      const safe =
        rebuyPoint !== null &&
        proceeds > 0 &&
        proceeds < buyer.cost * 0.4 &&
        rebuyUnits < buyer.units * 0.4;
      if (safe && holdingIndex === 1) {
        return [
          {
            kind: "buy",
            tradeDate: start,
            units: round4(h.units + trimUnits),
            amount: -(h.cost * (1 + trimUnits / h.units)),
          },
          { kind: "sell", tradeDate: sellPoint.date, units: trimUnits, amount: proceeds },
        ];
      }
      if (safe && holdingIndex === 2) {
        return [
          {
            kind: "buy",
            tradeDate: start,
            units: round4(h.units - rebuyUnits),
            amount: -(h.cost - proceeds),
          },
          {
            kind: "buy",
            tradeDate: (rebuyPoint as { date: string }).date,
            units: rebuyUnits,
            amount: -proceeds,
          },
        ];
      }
    }
  }
  return single;
}

function parseRelativeDate(text: string, today = REFERENCE_TODAY): string {
  const rel = text.match(/^(\d+)\s+(day|days|week|weeks|month|months)\s+ago$/i);
  if (rel) {
    const n = Number.parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const days = unit.startsWith("day") ? n : unit.startsWith("week") ? n * 7 : n * 30;
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString();
  }
  const abs = text.match(/^(\d{1,2})\s+(\w{3,})\s+(\d{4})$/);
  if (abs) {
    const parsed = new Date(`${abs[1]} ${abs[2]} ${abs[3]} UTC`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return today.toISOString();
}

export function seedDemoData(db: Db): void {
  const now = new Date().toISOString();

  for (const m of MODEL_PORTFOLIOS) {
    db.insert(modelPortfolios)
      .values({
        id: m.id,
        name: m.name,
        tagline: m.tagline,
        blurb: m.blurb,
        builtIn: !m.isCustom,
        allocation: m.mix,
        expectedReturn: m.expectedReturn,
        expectedVolatility: m.expectedVol,
        ter: m.ter,
        horizon: m.horizon,
        risk: m.risk,
        pros: m.pros,
        cons: m.cons,
        createdAt: now,
      })
      .run();
  }

  for (const [portfolioIndex, p] of PORTFOLIOS.entries()) {
    db.insert(buckets)
      .values({
        id: p.id,
        name: p.name,
        typeLabel: p.typeLabel,
        icon: p.icon,
        color: p.color,
        brokerage: p.brokerage,
        notes: p.notes,
        goalText: null,
        targetModelId: p.targetModelId,
        targetAllocation: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    for (const [holdingIndex, h] of p.holdings.entries()) {
      db.insert(holdings)
        .values({
          bucketId: p.id,
          ticker: h.ticker,
          thaiName: h.thai ?? null,
          englishName: h.name,
          category: h.category,
          assetClass: h.class,
          region: h.region,
          // Position (units/avgCost) is folded from the opening anchor below, not stored.
          ter: h.ter,
          source: h.source,
          // All demo seed holdings are real Thai mutual funds — route NAV
          // lookups through the SEC Open API against the shared market.db.
          quoteSource: DEMO_QUOTE_SOURCE,
          acquiredOn: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      // Dated trade history — the ledger is the source of truth and the holding
      // above is its projection (ADR 0004). Real dates matter: the value chart
      // replays the ledger, so these legs ARE the persona's 5-year story.
      for (const leg of storyLegs(portfolioIndex, holdingIndex, h, p.holdings)) {
        db.insert(transactions)
          .values({
            bucketId: p.id,
            ticker: h.ticker,
            englishName: h.name,
            quoteSource: DEMO_QUOTE_SOURCE,
            kind: leg.kind,
            tradeDate: leg.tradeDate,
            units: leg.units,
            pricePerUnit: leg.units > 0 ? round4(Math.abs(leg.amount) / leg.units) : null,
            amount: leg.amount,
            fee: null,
            tradeCurrency: "THB",
            fxToThb: 1,
            source: h.source,
            importBatchId: "seed-history",
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
  }

  db.insert(plans)
    .values({
      id: 1,
      markdown: USER_PLAN.markdown,
      selectedModelId: USER_GOALS.selectedModelId ?? null,
      updatedAt: parseRelativeDate(USER_PLAN.lastUpdated),
    })
    .run();

  for (const n of USER_JOURNAL.notes) {
    db.insert(journalEntries)
      .values({
        kind: "note",
        title: n.title,
        body: n.body,
        url: null,
        source: n.source ?? null,
        tags: n.tags ?? null,
        pinned: false,
        createdAt: parseRelativeDate(n.date),
        archivedAt: null,
      })
      .run();
  }
  for (const r of USER_JOURNAL.reading) {
    db.insert(journalEntries)
      .values({
        kind: "reading",
        title: r.title,
        body: r.summary,
        url: r.url,
        source: r.source ?? null,
        tags: null,
        pinned: false,
        createdAt: parseRelativeDate(r.savedDate),
        archivedAt: null,
      })
      .run();
  }
}
