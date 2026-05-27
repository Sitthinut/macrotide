// Seed mock data into a fresh demo SQLite. Mirrors lib/mock/seed.ts but runs
// against an in-memory app.db passed in (no path resolution, no migrations).
//
// This seeds ONLY the precious, user-authored side: model portfolios, buckets,
// holdings, the plan, and journal entries — the tables that live in the demo's
// isolated in-memory app.db.
//
// Market data is NOT seeded here. After the database split, a demo session
// reads the SHARED real market.db (fund catalog/fees + the NAV/quote cache)
// read-only — see lib/api/with-db.ts and lib/market/cache.ts. The persona's
// holdings point at REAL Thai-fund tickers (lib/mock/data.ts), so the live NAV
// path prices them against real SEC NAVs without writing the shared file.

import type { drizzle } from "drizzle-orm/better-sqlite3";
import { buckets, holdings, journalEntries, modelPortfolios, plans } from "../db/schema";
import type * as appSchema from "../db/schema/app";
import { MODEL_PORTFOLIOS, PORTFOLIOS, USER_GOALS, USER_JOURNAL, USER_PLAN } from "./data";

type Db = ReturnType<typeof drizzle<typeof appSchema>>;
const REFERENCE_TODAY = new Date("2026-05-21T00:00:00Z");

// All demo seed holdings are Thai mutual funds, per the existing seed.
const DEMO_QUOTE_SOURCE = "thai_mutual_fund" as const;

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

  for (const p of PORTFOLIOS) {
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

    for (const h of p.holdings) {
      const avgCost = h.units > 0 ? h.cost / h.units : null;
      db.insert(holdings)
        .values({
          bucketId: p.id,
          ticker: h.ticker,
          thaiName: h.thai ?? null,
          englishName: h.name,
          category: h.category,
          assetClass: h.class,
          region: h.region,
          units: h.units,
          avgCost,
          ter: h.ter,
          color: h.color,
          source: h.source,
          // All demo seed holdings are real Thai mutual funds — route NAV
          // lookups through the SEC Open API against the shared market.db.
          quoteSource: DEMO_QUOTE_SOURCE,
          acquiredOn: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
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
