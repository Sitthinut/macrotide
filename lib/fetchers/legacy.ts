"use client";

// Adapter-shaped fetchers — return the legacy `lib/mock/types` view so
// existing screens can drop their mock imports without rewriting layout.

import { useMemo } from "react";
import { adaptAggregate, adaptModelPortfolios, adaptPortfolios } from "@/lib/portfolio/adapter";
import { useBuckets, useHoldings, useModelPortfolios, usePlan, useQuotes } from "./portfolio";

export function usePortfolioView() {
  const { data: buckets, error: e1 } = useBuckets();
  const { data: holdings, error: e2 } = useHoldings();
  const { data: quotes, error: e3 } = useQuotes();

  const portfolios = useMemo(
    () => (buckets && holdings && quotes ? adaptPortfolios(buckets, holdings, quotes) : null),
    [buckets, holdings, quotes],
  );

  const aggregate = useMemo(() => (portfolios ? adaptAggregate(portfolios) : null), [portfolios]);

  return {
    portfolios,
    aggregate,
    isLoading: !buckets || !holdings || !quotes,
    error: e1 ?? e2 ?? e3,
  };
}

export function useModelPortfoliosView() {
  const { data, error } = useModelPortfolios();
  const models = useMemo(() => (data ? adaptModelPortfolios(data) : null), [data]);
  return { models, isLoading: !data, error };
}

export function useSelectedModelId(): string | null {
  const { data: plan } = usePlan();
  return plan?.selectedModelId ?? null;
}
