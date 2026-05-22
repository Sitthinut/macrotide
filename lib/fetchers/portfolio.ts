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
