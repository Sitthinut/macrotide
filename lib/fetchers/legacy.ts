"use client";

// Adapter-shaped fetchers — return the legacy `lib/static/types` view so
// existing screens can drop their mock imports without rewriting layout.

import { useEffect, useMemo, useRef } from "react";
import type { FundQuote } from "@/lib/db/queries/quotes";
import {
  adaptAggregate,
  adaptJournal,
  adaptModelPortfolios,
  adaptPortfolios,
} from "@/lib/portfolio/adapter";
import {
  type SeriesRange,
  useBuckets,
  useHoldings,
  useJournalEntries,
  useModelPortfolios,
  usePlan,
  usePortfolioSeries,
  useQuotes,
  useRefreshedQuotes,
} from "./portfolio";
import { invalidate } from "./swr";

export function usePortfolioView(range: SeriesRange = "6mo") {
  const { data: buckets, error: e1 } = useBuckets();
  const { data: holdings, error: e2 } = useHoldings();
  const { data: quotes, error: e3 } = useQuotes();
  const { data: series, error: e4 } = usePortfolioSeries(range);

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

  // The series endpoint reads nav_history, which `useRefreshedQuotes` writes
  // to as a side-effect. On a cold cache (e.g. a fresh demo session) the
  // series query lands before history exists, so SWR caches an empty result.
  // Re-invalidate once a refresh response arrives that wrote at least one
  // new row, so the chart fills in without a manual page reload.
  const invalidatedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!refreshed || refreshed.length === 0) return;
    const okKey = refreshed
      .filter((r) => r.ok)
      .map((r) => `${r.source}:${r.ticker}@${r.asOf ?? ""}`)
      .sort()
      .join(",");
    if (!okKey || invalidatedKey.current === okKey) return;
    invalidatedKey.current = okKey;
    invalidate(/^\/api\/portfolios\/series/);
  }, [refreshed]);

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
    () =>
      buckets && holdings
        ? adaptPortfolios(buckets, holdings, effectiveQuotes, series ?? undefined)
        : null,
    [buckets, holdings, effectiveQuotes, series],
  );

  const aggregate = useMemo(
    () => (portfolios ? adaptAggregate(portfolios, series?.aggregate) : null),
    [portfolios, series],
  );

  return {
    portfolios,
    aggregate,
    isLoading: !buckets || !holdings || !quotes,
    error: e1 ?? e2 ?? e3 ?? e4,
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
