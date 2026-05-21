"use client";

import type { Bucket } from "@/lib/db/queries/buckets";
import type { Holding as DbHolding } from "@/lib/db/queries/holdings";
import type { ModelPortfolio as DbModelPortfolio } from "@/lib/db/queries/models";
import type { Plan } from "@/lib/db/queries/plan";
import type { FundQuote } from "@/lib/db/queries/quotes";
import { useResource } from "./swr";

export type { Bucket, DbHolding, DbModelPortfolio, FundQuote, Plan };

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
