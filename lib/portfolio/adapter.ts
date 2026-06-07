// Shapes DB rows into the legacy `lib/static/types` view that the existing
// screens render against. Lets us swap the data source without rewriting UI.

import type { Bucket } from "@/lib/db/queries/buckets";
import type { Holding as DbHolding } from "@/lib/db/queries/holdings";
import type { JournalEntry } from "@/lib/db/queries/journal";
import type { ModelPortfolio as DbModelPortfolio } from "@/lib/db/queries/models";
import type { FundQuote } from "@/lib/db/queries/quotes";
import { fmtRelativeDate } from "@/lib/format";
import { quoteCacheKey } from "@/lib/market/sources";
import type {
  AggregatePortfolio,
  AssetClass,
  FeedbackItem,
  Holding,
  ModelPortfolio,
  Note,
  Portfolio,
  PortfolioType,
  ReadingItem,
  RiskBand,
  SeriesPoint,
  UserJournal,
} from "@/lib/static/types";

const DEFAULT_RISK: RiskBand = "balanced";
const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "alternative", "cash"];

function quotesByTicker(quotes: FundQuote[]): Map<string, FundQuote> {
  // fund_quotes.ticker is the combined cache key "source:ticker" — see
  // lib/market/cache.ts. We also index by the bare ticker so older callers
  // that pass plain symbols still get a hit on the unique entry.
  const m = new Map<string, FundQuote>();
  for (const q of quotes) {
    m.set(q.ticker, q);
    const idx = q.ticker.indexOf(":");
    if (idx > 0) {
      const bare = q.ticker.slice(idx + 1);
      if (!m.has(bare)) m.set(bare, q);
    }
  }
  return m;
}

function holdingFromDb(h: DbHolding, quotes: Map<string, FundQuote>): Holding {
  // Prefer the source-namespaced lookup. Falls back to the bare ticker for
  // backward compatibility with cache entries written before quoteSource
  // existed.
  const q = quotes.get(quoteCacheKey(h.quoteSource, h.ticker)) ?? quotes.get(h.ticker);
  const nav = q?.nav ?? h.avgCost ?? 0;
  const value = h.units * nav;
  // Cost basis is unknown for an uncosted opening/snapshot (ADR 0004). Keep
  // `cost` at 0 then, but flag it so gain figures degrade rather than mislead.
  const costKnown = h.avgCost != null;
  const cost = (h.avgCost ?? 0) * h.units;
  const assetClass = ASSET_CLASSES.includes(h.assetClass as AssetClass)
    ? (h.assetClass as AssetClass)
    : "unknown";
  return {
    id: h.id,
    bucketId: h.bucketId,
    ticker: h.ticker,
    thai: h.thaiName ?? undefined,
    name: h.englishName,
    category: h.category ?? "",
    class: assetClass,
    region: h.region ?? "",
    value,
    cost,
    costKnown,
    units: h.units,
    nav,
    d1: q?.d1Pct ?? 0,
    ytd: q?.ytdPct ?? 0,
    y1: q?.y1Pct ?? 0,
    ter: h.ter ?? null,
    source: h.source ?? "",
    quoteSource: h.quoteSource,
    riskSpectrum: h.riskSpectrum ?? null,
  };
}

function weightedPct(holdings: Holding[], total: number, key: "d1" | "ytd" | "y1"): number {
  if (total <= 0) return 0;
  return holdings.reduce((s, h) => s + (h.value / total) * h[key], 0);
}

// Legacy Portfolio "type" enum isn't stored — infer it from the SSF type label
// so the UI's badge logic keeps working. Everything else falls back to "free".
function inferPortfolioType(typeLabel: string | null): PortfolioType {
  if (!typeLabel) return "free";
  const t = typeLabel.toLowerCase();
  if (t.includes("ssf") || t.includes("rmf") || t.includes("tax")) return "tax-locked";
  if (t.includes("experiment")) return "experiment";
  return "free";
}

// Convert "YYYY-MM-DD" → "MMM DD" (e.g. "2026-05-22" → "May 22"). The chart's
// x-axis uses the short label. Exported so the benchmark overlay can map onto
// the same label space and align with the portfolio line.
export function formatSeriesDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function toSeriesPoints(raw: { date: string; value: number }[] | undefined): SeriesPoint[] {
  if (!raw || raw.length === 0) return [];
  return raw.map((p) => ({ d: formatSeriesDate(p.date), v: p.value }));
}

// Look back `days` calendar days from the latest point and return the % delta
// vs the closest point on or before that target date. Falls back to the first
// point if the series doesn't reach that far back.
function lookbackPct(raw: { date: string; value: number }[] | undefined, days: number): number {
  if (!raw || raw.length < 2) return 0;
  const latest = raw[raw.length - 1];
  if (!latest.value) return 0;
  const target = new Date(`${latest.date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - days);
  const targetIso = target.toISOString().slice(0, 10);
  let start = raw[0];
  for (const p of raw) {
    if (p.date <= targetIso) start = p;
    else break;
  }
  if (!start.value) return 0;
  return ((latest.value - start.value) / start.value) * 100;
}

export function adaptBucket(
  bucket: Bucket,
  bucketHoldings: DbHolding[],
  quotes: Map<string, FundQuote>,
  rawSeries?: { date: string; value: number }[],
): Portfolio {
  const holdings = bucketHoldings.map((h) => holdingFromDb(h, quotes));
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const initialInvestment = holdings.reduce((s, h) => s + h.cost, 0);

  return {
    id: bucket.id,
    name: bucket.name,
    icon: bucket.icon ?? "",
    type: inferPortfolioType(bucket.typeLabel),
    typeLabel: bucket.typeLabel ?? "",
    color: bucket.color ?? "var(--accent)",
    notes: bucket.notes ?? "",
    targetModelId: bucket.targetModelId ?? null,
    initialInvestment,
    totalValue,
    asOf: new Date(bucket.updatedAt).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
      timeZoneName: "short",
    }),
    brokerage: bucket.brokerage,
    perfPct: {
      d7: lookbackPct(rawSeries, 7),
      d30: lookbackPct(rawSeries, 30),
      ytd: weightedPct(holdings, totalValue, "ytd"),
      y1: weightedPct(holdings, totalValue, "y1"),
    },
    series: toSeriesPoints(rawSeries),
    holdings,
  };
}

export interface SeriesBundle {
  aggregate: { date: string; value: number }[];
  perBucket: Record<string, { date: string; value: number }[]>;
}

export function adaptPortfolios(
  buckets: Bucket[],
  holdings: DbHolding[],
  quotes: FundQuote[],
  series?: SeriesBundle,
): Portfolio[] {
  const byTicker = quotesByTicker(quotes);
  return buckets.map((b) =>
    adaptBucket(
      b,
      holdings.filter((h) => h.bucketId === b.id),
      byTicker,
      series?.perBucket[b.id],
    ),
  );
}

export function adaptAggregate(
  portfolios: Portfolio[],
  rawSeries?: { date: string; value: number }[],
): AggregatePortfolio {
  const allHoldings = portfolios.flatMap((p) => p.holdings);
  const totalValue = portfolios.reduce((s, p) => s + p.totalValue, 0);
  const initialInvestment = portfolios.reduce((s, p) => s + p.initialInvestment, 0);
  return {
    totalValue,
    baseCurrency: "THB",
    initialInvestment,
    perfPct: {
      d7: lookbackPct(rawSeries, 7),
      d30: lookbackPct(rawSeries, 30),
      ytd: weightedPct(allHoldings, totalValue, "ytd"),
      y1: weightedPct(allHoldings, totalValue, "y1"),
    },
    asOf: portfolios[0]?.asOf ?? "",
    brokerage: portfolios[0]?.brokerage ?? "",
    holdings: allHoldings,
    series: toSeriesPoints(rawSeries),
    target: { equity: 70, bond: 20, alternative: 7, cash: 3 },
  };
}

export function adaptModelPortfolio(m: DbModelPortfolio): ModelPortfolio {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline ?? "",
    blurb: m.blurb ?? "",
    mix: m.allocation ?? [],
    expectedReturn: m.expectedReturn ?? 0,
    expectedVol: m.expectedVolatility ?? 0,
    ter: m.ter ?? 0,
    horizon: m.horizon ?? "",
    risk: (m.risk as RiskBand | null) ?? DEFAULT_RISK,
    pros: m.pros ?? [],
    cons: m.cons ?? [],
    isCustom: !m.builtIn,
  };
}

export function adaptModelPortfolios(models: DbModelPortfolio[]): ModelPortfolio[] {
  return models.map(adaptModelPortfolio);
}

// Reverse: legacy ModelPortfolio → DB insert payload (id + createdAt set server-side
// or by the caller; everything else mirrors the legacy fields).
export function modelPortfolioToInsert(m: ModelPortfolio): {
  id: string;
  name: string;
  tagline: string | null;
  blurb: string | null;
  builtIn: boolean;
  allocation: ModelPortfolio["mix"];
  expectedReturn: number | null;
  expectedVolatility: number | null;
  ter: number | null;
  horizon: string | null;
  risk: string | null;
  pros: string[];
  cons: string[];
} {
  return {
    id: m.id,
    name: m.name,
    tagline: m.tagline || null,
    blurb: m.blurb || null,
    builtIn: false,
    allocation: m.mix,
    expectedReturn: m.expectedReturn,
    expectedVolatility: m.expectedVol,
    ter: m.ter,
    horizon: m.horizon || null,
    risk: m.risk,
    pros: m.pros,
    cons: m.cons,
  };
}

function noteFromEntry(e: JournalEntry): Note {
  return {
    id: `j${e.id}`,
    title: e.title ?? "",
    body: e.body ?? "",
    source: e.source ?? "manual",
    date: fmtRelativeDate(e.createdAt),
    tags: e.tags ?? [],
  };
}

// Kept in sync with FEEDBACK_RATING_TAG_PREFIX in lib/db/queries/journal.ts.
// Duplicated as a literal (not imported) so this client-bundled adapter never
// pulls the server-only DB module into the browser graph.
const FEEDBACK_RATING_TAG_PREFIX = "rating:";

// A `kind: "feedback"` journal entry carries its rating in a `rating:up|down`
// tag (journal_entries has no rating column). Default down — feedback we surface
// in the subtab is overwhelmingly a "Not for me" rejection.
function feedbackFromEntry(e: JournalEntry): FeedbackItem {
  const ratingTag = (e.tags ?? []).find((t) => t.startsWith(FEEDBACK_RATING_TAG_PREFIX));
  const rating = ratingTag?.slice(FEEDBACK_RATING_TAG_PREFIX.length) === "up" ? "up" : "down";
  return {
    id: `j${e.id}`,
    topic: e.title ?? "",
    rating,
    note: e.body ?? "",
    date: fmtRelativeDate(e.createdAt),
  };
}

function readingFromEntry(e: JournalEntry): ReadingItem {
  return {
    id: `j${e.id}`,
    title: e.title ?? "",
    source: e.source ?? "",
    url: e.url ?? "#",
    summary: e.body ?? "",
    readTime: 0,
    status: "unread",
    savedDate: fmtRelativeDate(e.createdAt),
  };
}

// Synthesizes the legacy UserJournal shape from journal_entries.
// `feedback` is populated from `kind: "feedback"` entries (e.g. a Portfolio
// "Not for me" rejection); `plan` and `savedModels` stay empty for now — the
// screens render the empty states fine.
export function adaptJournal(entries: JournalEntry[]): UserJournal {
  const notes: Note[] = [];
  const reading: ReadingItem[] = [];
  const feedback: FeedbackItem[] = [];
  for (const e of entries) {
    if (e.kind === "reading") reading.push(readingFromEntry(e));
    else if (e.kind === "feedback") feedback.push(feedbackFromEntry(e));
    else notes.push(noteFromEntry(e));
  }
  return {
    notes,
    reading,
    plan: { target: "", monthlyContribution: 0, nextRebalanceDate: "", commitments: [] },
    feedback,
    savedModels: [],
  };
}
