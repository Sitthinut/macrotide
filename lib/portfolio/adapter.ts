// Shapes DB rows into the legacy `lib/mock/types` view that the existing
// screens render against. Lets us swap the data source without rewriting UI.

import type { Bucket } from "@/lib/db/queries/buckets";
import type { Holding as DbHolding } from "@/lib/db/queries/holdings";
import type { ModelPortfolio as DbModelPortfolio } from "@/lib/db/queries/models";
import type { FundQuote } from "@/lib/db/queries/quotes";
import type {
  AggregatePortfolio,
  AssetClass,
  Holding,
  ModelPortfolio,
  Portfolio,
  PortfolioType,
  RiskBand,
} from "@/lib/mock/types";

const DEFAULT_ASSET_CLASS: AssetClass = "equity";
const DEFAULT_RISK: RiskBand = "balanced";

function quotesByTicker(quotes: FundQuote[]): Map<string, FundQuote> {
  return new Map(quotes.map((q) => [q.ticker, q]));
}

function holdingFromDb(
  h: DbHolding,
  quotes: Map<string, FundQuote>,
  fallbackSource: string,
): Holding {
  const q = quotes.get(h.ticker);
  const nav = q?.nav ?? h.avgCost ?? 0;
  const value = h.units * nav;
  const cost = (h.avgCost ?? 0) * h.units;
  return {
    ticker: h.ticker,
    thai: h.thaiName ?? undefined,
    name: h.englishName,
    category: h.category ?? "",
    class: (h.assetClass as AssetClass | null) ?? DEFAULT_ASSET_CLASS,
    region: h.region ?? "",
    value,
    cost,
    units: h.units,
    nav,
    d1: q?.d1Pct ?? 0,
    ytd: q?.ytdPct ?? 0,
    y1: q?.y1Pct ?? 0,
    ter: h.ter ?? 0,
    color: h.color ?? "var(--accent)",
    source: h.source ?? fallbackSource,
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
  if (t.includes("ssf") || t.includes("tax")) return "tax-locked";
  if (t.includes("experiment")) return "experiment";
  return "free";
}

export function adaptBucket(
  bucket: Bucket,
  bucketHoldings: DbHolding[],
  quotes: Map<string, FundQuote>,
): Portfolio {
  const holdings = bucketHoldings.map((h) => holdingFromDb(h, quotes, bucket.brokerage));
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
      d7: 0,
      d30: 0,
      ytd: weightedPct(holdings, totalValue, "ytd"),
      y1: weightedPct(holdings, totalValue, "y1"),
    },
    series: [],
    holdings,
  };
}

export function adaptPortfolios(
  buckets: Bucket[],
  holdings: DbHolding[],
  quotes: FundQuote[],
): Portfolio[] {
  const byTicker = quotesByTicker(quotes);
  return buckets.map((b) =>
    adaptBucket(
      b,
      holdings.filter((h) => h.bucketId === b.id),
      byTicker,
    ),
  );
}

export function adaptAggregate(portfolios: Portfolio[]): AggregatePortfolio {
  const allHoldings = portfolios.flatMap((p) => p.holdings);
  const totalValue = portfolios.reduce((s, p) => s + p.totalValue, 0);
  const initialInvestment = portfolios.reduce((s, p) => s + p.initialInvestment, 0);
  return {
    totalValue,
    baseCurrency: "THB",
    initialInvestment,
    perfPct: {
      d7: 0,
      d30: 0,
      ytd: weightedPct(allHoldings, totalValue, "ytd"),
      y1: weightedPct(allHoldings, totalValue, "y1"),
    },
    asOf: portfolios[0]?.asOf ?? "",
    brokerage: portfolios[0]?.brokerage ?? "",
    holdings: allHoldings,
    series: [],
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
