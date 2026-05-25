// Seed mock data into a fresh demo SQLite. Mirrors lib/mock/seed.ts but runs
// against an in-memory DB passed in (no path resolution, no migrations).
//
// To make the PortfolioScreen PerfChart render immediately (instead of
// serial-fetching ~180 days of NAVs from the Thai SEC API on first paint),
// this seed also writes ~180 days of synthetic-but-realistic daily NAVs to
// `nav_history`, plus a current-day row to `fund_quotes`. Both tables use
// the combined `${quoteSource}:${ticker}` cache key — same format produced
// by lib/market/cache.ts so the live refresh path treats this as a warm
// cache.

import type { drizzle } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema";
import {
  buckets,
  fundCatalog,
  fundFees,
  fundQuotes,
  holdings,
  journalEntries,
  modelPortfolios,
  navHistory,
  plans,
} from "../db/schema";
import { TER_FEE_TYPE } from "../market/fund-fees";
import { INDICES } from "../market/indices";
import { MODEL_PORTFOLIOS, PORTFOLIOS, USER_GOALS, USER_JOURNAL, USER_PLAN } from "./data";

type Db = ReturnType<typeof drizzle<typeof schema>>;
const REFERENCE_TODAY = new Date("2026-05-21T00:00:00Z");

// Plausible base levels for the demo index cache (the mock MARKETS list doesn't
// map 1:1 to these Yahoo symbols). The synthetic series ends at these values.
const DEMO_INDEX_VALUES: Record<string, number> = {
  "^SET.BK": 1428.42,
  "^GSPC": 5821.1,
  "^IXIC": 18942.8,
  "^N225": 38500,
  "THB=X": 36.5,
};

// All demo seed holdings are Thai mutual funds, per the existing seed.
// Kept as a constant so the combined cache key matches what the live
// refresh path will produce when it later calls cache.ts.
const DEMO_QUOTE_SOURCE = "thai_mutual_fund" as const;

// ~180 calendar days ≈ 128 business days. The walk is a log-space Brownian
// bridge between a start anchored near avg_cost and an end pinned at the
// holding's "current" NAV — so fund_quotes (current) and nav_history (last
// row) always agree, and the curve has a sensible direction. Daily σ ≈ 1%
// keeps the wiggle realistic without producing big jumps.
const HISTORY_DAYS = 180;
const DAILY_SIGMA = 0.01;

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

// Stable 32-bit FNV-1a hash so re-seeds with the same ticker produce the
// same synthetic series across processes. Mulberry32 PRNG keeps each
// step cheap and deterministic.
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller — turn two uniforms into one standard normal.
function gauss(rand: () => number): number {
  const u1 = Math.max(rand(), Number.EPSILON);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Generate ~HISTORY_DAYS calendar days of synthetic daily NAVs ending on
 * `endDate`, skipping weekends.
 *
 * Implemented as a log-space Brownian bridge between a chosen `baseStart`
 * (anchored to avg_cost when available, so the chart starts near the
 * holding's purchase price) and `targetNav` (the "current" value the
 * holdings table reports). Noise wanders freely in the middle but both
 * endpoints are pinned — so `fund_quotes.nav` and the last `nav_history`
 * row always agree, and the trajectory has the right direction regardless
 * of which random shocks the PRNG produces.
 */
function generateSeries(
  ticker: string,
  targetNav: number,
  startingNavHint: number | null,
  endDate: Date,
): Array<{ date: string; nav: number }> {
  const dates: Date[] = [];
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    if (!isWeekend(d)) dates.push(d);
  }
  if (dates.length === 0) return [];

  const rand = mulberry32(fnv1a(ticker));

  // Anchor the *start* of the walk near the holding's avg_cost when we
  // have one — that way a holding that gained value looks like a generally
  // rising line. Pull the start 5% below avg_cost so there's room to drift
  // back up. Holdings without avg_cost (cost==0) fall back to a scale that
  // matches `targetNav` so the walk has the right order of magnitude.
  const hintedStart =
    startingNavHint && startingNavHint > 0 ? startingNavHint * 0.95 : targetNav * 0.95;

  // Drift toward the end so the unconstrained walk roughly heads in the
  // right direction — but the bridge correction below is what actually
  // pins the endpoints.
  const logStart = Math.log(hintedStart);
  const logEnd = Math.log(targetNav);

  const n = dates.length;
  // Build an unconstrained random walk first (drift roughly aimed at the
  // end so the bridge correction stays small / noise stays subtle).
  const drift = (logEnd - logStart) / Math.max(n - 1, 1);
  const walk: number[] = [logStart];
  for (let i = 1; i < n; i++) {
    const shock = gauss(rand) * DAILY_SIGMA;
    walk.push(walk[i - 1] + drift + shock);
  }

  // Brownian-bridge correction: linearly subtract the endpoint error from
  // every interior point so walk[n-1] = logEnd exactly while preserving
  // the noise shape.
  const endError = walk[n - 1] - logEnd;
  for (let i = 0; i < n; i++) {
    walk[i] -= (i / Math.max(n - 1, 1)) * endError;
  }

  return dates.map((d, i) => ({
    date: yyyyMmDd(d),
    nav: Number(Math.exp(walk[i]).toFixed(6)),
  }));
}

function computeYtdPct(series: Array<{ date: string; nav: number }>, asOf: Date): number | null {
  if (series.length < 2) return null;
  const year = asOf.getUTCFullYear();
  const first = series.find((p) => p.date.startsWith(`${year}-`));
  if (!first) return null;
  const last = series[series.length - 1];
  return ((last.nav - first.nav) / first.nav) * 100;
}

function computeReturnPct(
  series: Array<{ date: string; nav: number }>,
  asOf: Date,
  days: number,
): number | null {
  if (series.length < 2) return null;
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = yyyyMmDd(cutoff);
  const start = series.find((p) => p.date >= cutoffStr);
  if (!start) return null;
  const last = series[series.length - 1];
  return ((last.nav - start.nav) / start.nav) * 100;
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

  const seenTickers = new Set<string>();
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
          // All demo seed holdings are Thai mutual funds.
          quoteSource: DEMO_QUOTE_SOURCE,
          acquiredOn: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      if (!seenTickers.has(h.ticker)) {
        seenTickers.add(h.ticker);

        // Combined cache key used by both fund_quotes.ticker and
        // nav_history.ticker — must match lib/market/cache.ts:cacheKey()
        // exactly so the live refresh path treats this as a warm cache.
        const cacheKey = `${DEMO_QUOTE_SOURCE}:${h.ticker}`;

        const series = generateSeries(h.ticker, h.nav, avgCost, REFERENCE_TODAY);

        // Insert each NAV row. Conflicts shouldn't happen on a fresh demo
        // DB, but guard anyway in case seedDemoData ever runs twice on
        // the same sqlite instance.
        for (const row of series) {
          db.insert(navHistory)
            .values({ ticker: cacheKey, date: row.date, nav: row.nav })
            .onConflictDoUpdate({
              target: [navHistory.ticker, navHistory.date],
              set: { nav: row.nav },
            })
            .run();
        }

        // Recompute perf percentages off the synthetic series so the UI's
        // "today's change" row matches what the chart shows. Fall back to
        // the curated values in data.ts when the synthetic window is too
        // short (e.g. y1 — we only generate ~180 days).
        const last = series[series.length - 1];
        const prev = series.length > 1 ? series[series.length - 2] : null;
        const d1Pct = last && prev ? ((last.nav - prev.nav) / prev.nav) * 100 : (h.d1 ?? null);
        const ytdPct = computeYtdPct(series, REFERENCE_TODAY) ?? h.ytd ?? null;
        const y1Pct = computeReturnPct(series, REFERENCE_TODAY, 365) ?? h.y1 ?? null;

        db.insert(fundQuotes)
          .values({
            ticker: cacheKey,
            nav: last?.nav ?? h.nav,
            d1Pct,
            ytdPct,
            y1Pct,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: fundQuotes.ticker,
            set: {
              nav: last?.nav ?? h.nav,
              d1Pct,
              ytdPct,
              y1Pct,
              updatedAt: now,
            },
          })
          .run();
      }
    }
  }

  // Warm the Yahoo index cache (yahoo:<symbol>) so the demo Markets screen
  // shows real-looking indices with an "as of" date, instead of cold-falling-
  // back to the mock list and surfacing a "sources unavailable" banner (the
  // demo DB never hits Yahoo). updatedAt:now keeps these "fresh" so the live
  // path serves them without a network call.
  for (const def of INDICES) {
    const base = DEMO_INDEX_VALUES[def.symbol];
    if (base == null) continue;
    const cacheKey = `yahoo:${def.symbol}`;
    const series = generateSeries(def.symbol, base, null, REFERENCE_TODAY);
    for (const row of series) {
      db.insert(navHistory)
        .values({ ticker: cacheKey, date: row.date, nav: row.nav })
        .onConflictDoUpdate({ target: [navHistory.ticker, navHistory.date], set: { nav: row.nav } })
        .run();
    }
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const d1Pct = last && prev ? ((last.nav - prev.nav) / prev.nav) * 100 : null;
    db.insert(fundQuotes)
      .values({
        ticker: cacheKey,
        nav: last?.nav ?? base,
        d1Pct,
        ytdPct: computeYtdPct(series, REFERENCE_TODAY),
        y1Pct: computeReturnPct(series, REFERENCE_TODAY, 365),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: fundQuotes.ticker,
        set: { nav: last?.nav ?? base, d1Pct, updatedAt: now },
      })
      .run();
  }

  // ─── fund catalog demo seed ──────────────────────────────────────────────
  // A representative sample of Thai-registered funds so the Select UI (FundSelect)
  // shows real-looking data before the daily SEC refresh has populated the catalog.
  // Covers the four asset classes and a range of TER levels to demonstrate the
  // cheapest-first ranking. Enriched with managementStyle, taxIncentiveType,
  // investRegion, isFeederFund, distributionPolicy so the new filters work.
  const DEMO_FUNDS: Array<{
    projId: string;
    abbrName: string;
    englishName: string;
    thaiName: string;
    amcName: string;
    policyDesc: string;
    assetClass: "equity" | "bond" | "alternative" | "cash";
    ter: number; // actual TER %
    managementStyle?: string;
    taxIncentiveType?: string;
    investRegion?: string;
    isFeederFund?: boolean;
    feederMasterFund?: string;
    distributionPolicy?: string;
  }> = [
    // ── Equity — S&P 500 index feeders (passive / PN) ────────────────────────
    {
      projId: "DEMO_001",
      abbrName: "SCBSP500",
      englishName: "SCB S&P 500 Index Fund",
      thaiName: "กองทุนเปิดไทยพาณิชย์ เอส แอนด์ พี 500",
      amcName: "SCB Asset Management",
      policyDesc: "Feeder fund investing in S&P 500 index tracking fund. Tracks the S&P 500 Index.",
      assetClass: "equity",
      ter: 0.5,
      managementStyle: "PN",
      investRegion: "foreign",
      isFeederFund: true,
      feederMasterFund: "iShares Core S&P 500 ETF",
      distributionPolicy: "accumulating",
    },
    {
      projId: "DEMO_002",
      abbrName: "K-SP500-A(D)",
      englishName: "K S&P 500 Index Fund Class A (Dividend)",
      thaiName: "กองทุนเปิดกสิกรไทย เอส แอนด์ พี 500",
      amcName: "Kasikorn Asset Management",
      policyDesc: "Feeder fund investing in a fund tracking the S&P 500 Index.",
      assetClass: "equity",
      ter: 0.9,
      managementStyle: "PN",
      investRegion: "foreign",
      isFeederFund: true,
      feederMasterFund: "Vanguard S&P 500 ETF",
      distributionPolicy: "dividend",
    },
    {
      projId: "DEMO_003",
      abbrName: "ONE-SP500-UH",
      englishName: "One S&P 500 Equity Index Fund (Unhedged)",
      thaiName: "กองทุนเปิด วัน เอส แอนด์ พี 500",
      amcName: "One Asset Management",
      policyDesc: "Invests in a master fund tracking the S&P 500 Index. Currency unhedged.",
      assetClass: "equity",
      ter: 0.45,
      managementStyle: "PN",
      investRegion: "foreign",
      isFeederFund: true,
      feederMasterFund: "SPDR S&P 500 ETF Trust",
      distributionPolicy: "accumulating",
    },
    // ── Equity — global / MSCI World ─────────────────────────────────────────
    {
      projId: "DEMO_004",
      abbrName: "TMBGQG",
      englishName: "TMB Global Quality Growth Fund",
      thaiName: "กองทุนเปิดทีเอ็มบี โกลบอล ควอลิตี้ โกรท",
      amcName: "TMB Asset Management",
      policyDesc: "Actively managed fund investing in global equities. MSCI World exposure.",
      assetClass: "equity",
      ter: 1.5,
      managementStyle: "AM",
      investRegion: "foreign",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    {
      projId: "DEMO_005",
      abbrName: "SCBWINA(A)",
      englishName: "SCB World Index Fund",
      thaiName: "กองทุนเปิดไทยพาณิชย์ เวิลด์ อินดิคัส",
      amcName: "SCB Asset Management",
      policyDesc:
        "Feeder fund investing in a fund tracking the MSCI ACWI Index. Global equity exposure.",
      assetClass: "equity",
      ter: 0.75,
      managementStyle: "PN",
      investRegion: "foreign",
      isFeederFund: true,
      feederMasterFund: "iShares MSCI ACWI ETF",
      distributionPolicy: "accumulating",
    },
    // ── Equity — Thai domestic ────────────────────────────────────────────────
    {
      projId: "DEMO_006",
      abbrName: "KFSDIV",
      englishName: "Krungsri SET Dividend Fund",
      thaiName: "กองทุนเปิดกรุงศรี เซ็ท ดิวิเดนด์",
      amcName: "Krungsri Asset Management",
      policyDesc: "Invests in Thai equities with focus on high-dividend stocks from the SET Index.",
      assetClass: "equity",
      ter: 1.2,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "dividend",
    },
    // ── Equity — SSF (Super Savings Fund) — tax-deductible S&P 500 index ─────
    {
      projId: "DEMO_015",
      abbrName: "SCBSP500SSF",
      englishName: "SCB S&P 500 Index Fund SSF",
      thaiName: "กองทุนเปิดไทยพาณิชย์ เอส แอนด์ พี 500 เพื่อการออม",
      amcName: "SCB Asset Management",
      policyDesc:
        "Super Savings Fund. Feeder fund tracking the S&P 500 Index. Tax deductible up to 30% of income (max 200,000 THB).",
      assetClass: "equity",
      ter: 0.55,
      managementStyle: "PN",
      taxIncentiveType: "SSF",
      investRegion: "foreign",
      isFeederFund: true,
      feederMasterFund: "iShares Core S&P 500 ETF",
      distributionPolicy: "accumulating",
    },
    // ── Equity — ThaiESG — tax-deductible domestic index fund ────────────────
    {
      projId: "DEMO_016",
      abbrName: "KFSETTHESGTF",
      englishName: "Krungsri SET Thai ESG Fund",
      thaiName: "กองทุนเปิดกรุงศรี เซ็ท ไทยเพื่อความยั่งยืน",
      amcName: "Krungsri Asset Management",
      policyDesc:
        "Thai ESG Fund investing in SET-listed equities with ESG criteria. Tax deductible up to 30% of income (max 300,000 THB).",
      assetClass: "equity",
      ter: 0.5,
      managementStyle: "PN",
      taxIncentiveType: "ThaiESG",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    // ── Bond — Thai fixed income ──────────────────────────────────────────────
    {
      projId: "DEMO_007",
      abbrName: "K-FIXED-A",
      englishName: "Kasikorn Fixed Income Fund Class A",
      thaiName: "กองทุนเปิดกสิกรไทย ตราสารหนี้ เอ",
      amcName: "Kasikorn Asset Management",
      policyDesc:
        "Invests primarily in Thai government bonds, corporate bonds, and money-market instruments.",
      assetClass: "bond",
      ter: 0.38,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    {
      projId: "DEMO_008",
      abbrName: "SCBFIXED",
      englishName: "SCB Fixed Income Fund",
      thaiName: "กองทุนเปิดไทยพาณิชย์ ตราสารหนี้",
      amcName: "SCB Asset Management",
      policyDesc:
        "Invests in Thai government and state enterprise bonds. Low-risk, capital preservation.",
      assetClass: "bond",
      ter: 0.42,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    {
      projId: "DEMO_009",
      abbrName: "KTBGSB",
      englishName: "KTB Government Savings Bond Fund",
      thaiName: "กองทุนเปิดเคทีบี พันธบัตรออมทรัพย์",
      amcName: "Krung Thai Asset Management",
      policyDesc: "Invests in Thai government savings bonds. Capital preservation objective.",
      assetClass: "bond",
      ter: 0.3,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "dividend",
    },
    // ── Alternative — gold ────────────────────────────────────────────────────
    {
      projId: "DEMO_010",
      abbrName: "TMBGOLDS",
      englishName: "TMB Gold Savings Fund",
      thaiName: "กองทุนเปิดทีเอ็มบี ทองคำ",
      amcName: "TMB Asset Management",
      policyDesc:
        "Invests in gold bullion and gold-related instruments. Tracks the gold spot price.",
      assetClass: "alternative",
      ter: 0.55,
      managementStyle: "PN",
      investRegion: "mixed",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    // ── Alternative — property / REIT ─────────────────────────────────────────
    {
      projId: "DEMO_011",
      abbrName: "KTBREALTY",
      englishName: "KTB Real Estate and Infrastructure Fund",
      thaiName: "กองทุนเปิดเคทีบี อสังหาริมทรัพย์",
      amcName: "Krung Thai Asset Management",
      policyDesc: "Invests in Thai real estate investment trusts (REITs) and infrastructure funds.",
      assetClass: "alternative",
      ter: 0.8,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "dividend",
    },
    // ── Equity — held funds that demonstrate fee-creep ───────────────────────
    // These abbrNames match demo holdings tickers so computeFeeCreep() can pair
    // them with catalog entries and surface cheaper same-class alternatives.
    {
      projId: "DEMO_013",
      abbrName: "K-USA-A(A)",
      englishName: "K USA Equity Fund (Class A Accumulation)",
      thaiName: "กองทุนเปิดกสิกรไทย ยูเอสเอ ทุนซื้อคืน",
      amcName: "Kasikorn Asset Management",
      policyDesc:
        "Actively managed fund investing in US equities. Higher management fee than passive alternatives.",
      assetClass: "equity",
      ter: 1.4, // demo holding has ter 1.4; ONE-SP500-UH (0.45) is cheaper
      managementStyle: "AM",
      investRegion: "foreign",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    {
      projId: "DEMO_014",
      abbrName: "KFGBRAND-A",
      englishName: "Krungsri Global Brands Equity Fund (Class A)",
      thaiName: "กองทุนเปิดกรุงศรี โกลบอลแบรนด์ ชนิดเอ",
      amcName: "Krungsri Asset Management",
      policyDesc:
        "Actively managed global equity fund focusing on consumer brand companies. High active fee.",
      assetClass: "equity",
      ter: 1.85, // demo holding has ter 1.85; SCBWINA(A) (0.75) is cheaper
      managementStyle: "AM",
      investRegion: "foreign",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
    // ── Cash / money-market ───────────────────────────────────────────────────
    {
      projId: "DEMO_012",
      abbrName: "SCBMM",
      englishName: "SCB Money Market Fund",
      thaiName: "กองทุนเปิดไทยพาณิชย์ ตลาดเงิน",
      amcName: "SCB Asset Management",
      policyDesc:
        "Invests in short-term money-market instruments, commercial paper, and bank deposits.",
      assetClass: "cash",
      ter: 0.15,
      managementStyle: "AM",
      investRegion: "domestic",
      isFeederFund: false,
      distributionPolicy: "accumulating",
    },
  ];

  const periodStart = "2025-01-01";

  for (const f of DEMO_FUNDS) {
    db.insert(fundCatalog)
      .values({
        projId: f.projId,
        abbrName: f.abbrName,
        thaiName: f.thaiName,
        englishName: f.englishName,
        amcName: f.amcName,
        policyDesc: f.policyDesc,
        assetClass: f.assetClass,
        managementStyle: f.managementStyle ?? null,
        taxIncentiveType: f.taxIncentiveType ?? null,
        investRegion: f.investRegion ?? null,
        isFeederFund: f.isFeederFund ?? false,
        feederMasterFund: f.feederMasterFund ?? null,
        distributionPolicy: f.distributionPolicy ?? null,
        isFixedTerm: false,
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();

    // Seed a current (open-ended) TER row so findFunds() has fee data to rank on.
    db.insert(fundFees)
      .values({
        projId: f.projId,
        fundClassName: "A",
        feeType: TER_FEE_TYPE,
        feeTypeRaw: "Total Fee and Expense (ค่าธรรมเนียมและค่าใช้จ่ายรวมทั้งหมด)",
        rateCeilingPct: f.ter * 1.2, // typical SEC ceiling ≈ 20% above actual
        actualRatePct: f.ter,
        periodStart,
        periodEnd: null, // null = currently active
        prospectusType: "Monthly",
        lastUpdDate: yyyyMmDd(REFERENCE_TODAY),
      })
      .onConflictDoNothing()
      .run();
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
