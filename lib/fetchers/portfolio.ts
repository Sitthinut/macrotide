"use client";

import type { Bucket } from "@/lib/db/queries/buckets";
import type { Holding as DbHolding } from "@/lib/db/queries/holdings";
import type { JournalEntry } from "@/lib/db/queries/journal";
import type { ModelPortfolio as DbModelPortfolio } from "@/lib/db/queries/models";
import type { Plan } from "@/lib/db/queries/plan";
import type { FundQuote } from "@/lib/db/queries/quotes";
import { useResource } from "./swr";

export type { Bucket, DbHolding, DbModelPortfolio, FundQuote, JournalEntry, Plan };

export function useBuckets() {
  return useResource<Bucket[]>("/api/buckets");
}

export function useHoldings(bucketId?: string) {
  const key = bucketId ? `/api/holdings?bucket=${encodeURIComponent(bucketId)}` : "/api/holdings";
  return useResource<DbHolding[]>(key);
}

export function useQuotes() {
  return useResource<FundQuote[]>("/api/quotes");
}

export interface QuoteRef {
  source: string;
  ticker: string;
}

export interface RefreshedQuote extends QuoteRef {
  ok: boolean;
  price?: number;
  previousClose?: number;
  asOf?: string;
  error?: string;
}

/**
 * Live-refresh quotes through the provider registry (Yahoo / Thai SEC / …).
 * Cache hits return from the DB; misses trigger a network call. Pass `null`
 * to skip. Each ref must carry both `source` (the quote_source value, e.g.
 * "yahoo" or "thai_mutual_fund") and `ticker` (the bare user-visible code).
 */
export function useRefreshedQuotes(refs: QuoteRef[] | null) {
  const key =
    refs && refs.length
      ? `/api/quotes?refresh=1&refs=${encodeURIComponent(refs.map((r) => `${r.source}:${r.ticker}`).join(","))}`
      : null;
  return useResource<RefreshedQuote[]>(key);
}

export function useModelPortfolios() {
  return useResource<DbModelPortfolio[]>("/api/models");
}

export function usePlan() {
  return useResource<Plan>("/api/plan");
}

export function useJournalEntries() {
  return useResource<JournalEntry[]>("/api/journal");
}

export type SeriesRange = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";

export interface PortfolioSeriesPoint {
  date: string;
  value: number;
}

export interface PortfolioSeriesResponse {
  aggregate: PortfolioSeriesPoint[];
  perBucket: Record<string, PortfolioSeriesPoint[]>;
  asOf: string | null;
}

export function usePortfolioSeries(range: SeriesRange = "6mo") {
  return useResource<PortfolioSeriesResponse>(
    `/api/portfolios/series?range=${encodeURIComponent(range)}`,
  );
}

export interface MarketIndexResponse {
  ok: boolean;
  symbol: string;
  label: string;
  name: string;
  price?: number | null;
  d1Pct?: number;
  series?: { d: string; v: number }[];
  asOf?: string | null;
  error?: string;
}

export function useMarketIndices() {
  return useResource<MarketIndexResponse[]>("/api/market/indices");
}

export interface MarketNewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

export interface MarketNewsResponse {
  items: MarketNewsItem[];
  failures: number;
  fetchedAt: string;
}

export function useMarketNews() {
  return useResource<MarketNewsResponse>("/api/market/news");
}

export interface BenchmarkSeriesResponse {
  key: string;
  label: string;
  series: { date: string; value: number }[];
}

/**
 * Real index series for the Portfolio "VS" overlay. Pass `null` (e.g. when the
 * selection is "none") to skip the request. `range` should match the chart's
 * current range so the benchmark spans the same window as the portfolio.
 */
export function useBenchmarkSeries(key: string | null, range: SeriesRange = "6mo") {
  const url = key
    ? `/api/market/benchmark?key=${encodeURIComponent(key)}&range=${encodeURIComponent(range)}`
    : null;
  return useResource<BenchmarkSeriesResponse>(url);
}
