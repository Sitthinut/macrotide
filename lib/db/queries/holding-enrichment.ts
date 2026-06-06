import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { getMarketDb } from "../context";
import { fundCatalog, fundShareClasses } from "../schema";
import type { Holding } from "./holdings";

export interface CatalogHoldingMetadata {
  thaiName: string | null;
  englishName: string | null;
  category: string | null;
  assetClass: string | null;
  region: string | null;
  ter: number | null;
}

const CATALOG_FIELDS = [
  "thaiName",
  "englishName",
  "category",
  "assetClass",
  "region",
  "ter",
] as const;
export type CatalogOwnedField = (typeof CATALOG_FIELDS)[number];

export function stripCatalogOwnedFields<T extends Partial<Record<CatalogOwnedField, unknown>>>(
  patch: T,
): Omit<T, CatalogOwnedField> {
  const out = { ...patch };
  for (const key of CATALOG_FIELDS) delete out[key];
  return out;
}

function displayRegion(region: string | null): string | null {
  switch (region) {
    case "domestic":
      return "Thailand";
    case "foreign":
      return "Foreign";
    case "mixed":
      return "Mixed";
    default:
      return region;
  }
}

export function catalogMetadataForHoldings(tickers: string[]): Map<string, CatalogHoldingMetadata> {
  const cleaned = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, CatalogHoldingMetadata>();
  if (cleaned.length === 0) return out;

  const db = getMarketDb();
  for (const r of db
    .select({
      ticker: fundShareClasses.ticker,
      thaiName: fundCatalog.thaiName,
      englishName: fundCatalog.englishName,
      fundType: fundCatalog.fundType,
      policyDesc: fundCatalog.policyDesc,
      policyDescTh: fundCatalog.policyDescTh,
      assetClass: fundCatalog.assetClass,
      investRegion: fundCatalog.investRegion,
      shareTer: fundShareClasses.currentTer,
      fundTer: fundCatalog.currentTer,
    })
    .from(fundShareClasses)
    .innerJoin(fundCatalog, eq(fundShareClasses.projId, fundCatalog.projId))
    .where(inArray(sql`upper(${fundShareClasses.ticker})`, cleaned))
    .all()) {
    out.set(r.ticker.toUpperCase(), {
      thaiName: r.thaiName,
      englishName: r.englishName,
      category: r.policyDescTh ?? r.policyDesc ?? r.fundType,
      assetClass: r.assetClass,
      region: displayRegion(r.investRegion),
      ter: r.shareTer ?? r.fundTer,
    });
  }

  for (const r of db
    .select({
      ticker: fundCatalog.abbrName,
      thaiName: fundCatalog.thaiName,
      englishName: fundCatalog.englishName,
      fundType: fundCatalog.fundType,
      policyDesc: fundCatalog.policyDesc,
      policyDescTh: fundCatalog.policyDescTh,
      assetClass: fundCatalog.assetClass,
      investRegion: fundCatalog.investRegion,
      ter: fundCatalog.currentTer,
    })
    .from(fundCatalog)
    .where(inArray(sql`upper(${fundCatalog.abbrName})`, cleaned))
    .all()) {
    const ticker = r.ticker?.toUpperCase();
    if (!ticker || out.has(ticker)) continue;
    out.set(ticker, {
      thaiName: r.thaiName,
      englishName: r.englishName,
      category: r.policyDescTh ?? r.policyDesc ?? r.fundType,
      assetClass: r.assetClass,
      region: displayRegion(r.investRegion),
      ter: r.ter,
    });
  }

  return out;
}

export function isCatalogHolding(ticker: string): boolean {
  return catalogMetadataForHoldings([ticker]).has(ticker.trim().toUpperCase());
}

export function enrichHoldingsWithCatalog<T extends Holding>(holdings: T[]): T[] {
  const metadata = catalogMetadataForHoldings(holdings.map((h) => h.ticker));
  return holdings.map((h) => {
    const meta = metadata.get(h.ticker.trim().toUpperCase());
    return meta ? ({ ...h, ...meta } as T) : h;
  });
}
