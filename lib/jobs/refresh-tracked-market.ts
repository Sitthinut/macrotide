import "server-only";
import { appDb } from "@/lib/db/client";
import { holdings } from "@/lib/db/schema";
import { refreshSymbols } from "@/lib/market/cache";
import { INDICATOR_CATALOG } from "@/lib/market/indicators";
import type { SeriesRange } from "@/lib/market/providers/types";

export interface RefreshTrackedMarketResult {
  /** Distinct (source, ticker) refs refreshed after de-dup. */
  requested: number;
  ok: number;
  failed: number;
  errors: Array<{ source: string; ticker: string; error?: string }>;
}

/**
 * Refresh the cached NAV/quote for everything the app *actively tracks*: every
 * indicator in `INDICATOR_CATALOG` (the `yahoo` provider chain) plus every
 * distinct held position (routed by its own `quote_source`). De-dups by
 * `${source}:${ticker}` so a held index isn't fetched twice.
 *
 * This is the **freshness** job (issue #23): bounded to what's tracked, it runs
 * on a daily timer so charts are current without a user trigger. It is distinct
 * from `prewarmNav` (issue #104), the heavy **coverage** crawl that warms NAV
 * for the *whole* fund catalog. Keep the boundary: this one never enumerates the
 * catalog.
 *
 * Shared by the admin `refresh-market` route and the scheduled job script so the
 * symbol-set logic lives in exactly one place. Reads the owner app.db directly
 * (no request context) — correct for both the owner-only admin route and the CLI
 * job; demo sessions are never refreshed by a schedule.
 */
export async function refreshTrackedMarket(
  opts: { range?: SeriesRange } = {},
): Promise<RefreshTrackedMarketResult> {
  const range = opts.range ?? "6mo";

  // Warm every catalog indicator (so any user's selection is cached) — all route
  // through the "yahoo" provider chain.
  const indexRefs = INDICATOR_CATALOG.map((i) => ({ source: "yahoo", ticker: i.symbol }));
  // Every held position is refreshed via its own provider — holdings carry
  // quote_source explicitly so we don't guess by ticker shape.
  const heldRows = appDb
    .selectDistinct({ source: holdings.quoteSource, ticker: holdings.ticker })
    .from(holdings)
    .all();
  const heldRefs = heldRows.map((r) => ({ source: r.source, ticker: r.ticker }));

  const seen = new Set<string>();
  const allRefs = [...indexRefs, ...heldRefs].filter((r) => {
    const k = `${r.source}:${r.ticker}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const results = await refreshSymbols(allRefs, range);
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return {
    requested: allRefs.length,
    ok,
    failed: failed.length,
    errors: failed.map((f) => ({ source: f.source, ticker: f.ticker, error: f.error })),
  };
}
