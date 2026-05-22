"use client";

// Adapter-shaped fetchers — return the legacy `lib/mock/types` view so
// existing screens can drop their mock imports without rewriting layout.

import { useMemo } from "react";
import type { FundQuote } from "@/lib/db/queries/quotes";
import {
  adaptAggregate,
  adaptJournal,
  adaptModelPortfolios,
  adaptPortfolios,
} from "@/lib/portfolio/adapter";
import {
  useBuckets,
  useHoldings,
  useJournalEntries,
  useModelPortfolios,
  usePlan,
  useQuotes,
  useRefreshedQuotes,
} from "./portfolio";

export function usePortfolioView() {
  const { data: buckets, error: e1 } = useBuckets();
  const { data: holdings, error: e2 } = useHoldings();
  const { data: quotes, error: e3 } = useQuotes();

  // Live-refresh quotes for every held position. Cache hits return from the
  // DB synchronously; misses trigger a network call through the provider
  // registry. Failures are tolerated — the cached quote (or avgCost fallback
  // inside the adapter) keeps the UI rendering.
  const refs = useMemo(
    () =>
      holdings && holdings.length > 0
        ? holdings.map((h) => ({ source: h.quoteSource, ticker: h.ticker }))
        : null,
    [holdings],
  );
  const { data: refreshed } = useRefreshedQuotes(refs);

  // Overlay refreshed values onto the cached quote list so the adapter
  // sees the freshest NAVs without needing a separate revalidation pass.
  const effectiveQuotes = useMemo<FundQuote[]>(() => {
    if (!quotes) return [];
    if (!refreshed || refreshed.length === 0) return quotes;
    const map = new Map(quotes.map((q) => [q.ticker, q]));
    for (const r of refreshed) {
      if (!r.ok || r.price == null) continue;
      const key = `${r.source}:${r.ticker}`;
      const prev = map.get(key);
      map.set(key, {
        ticker: key,
        nav: r.price,
        d1Pct: prev?.d1Pct ?? null,
        ytdPct: prev?.ytdPct ?? null,
        y1Pct: prev?.y1Pct ?? null,
        updatedAt: r.asOf ?? new Date().toISOString(),
      });
    }
    return [...map.values()];
  }, [quotes, refreshed]);

  const portfolios = useMemo(
    () => (buckets && holdings ? adaptPortfolios(buckets, holdings, effectiveQuotes) : null),
    [buckets, holdings, effectiveQuotes],
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

export function useJournalView() {
  const { data, error } = useJournalEntries();
  const journal = useMemo(() => (data ? adaptJournal(data) : null), [data]);
  return { journal, isLoading: !data, error };
}
