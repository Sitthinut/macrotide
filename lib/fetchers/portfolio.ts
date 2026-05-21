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
