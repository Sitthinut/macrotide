import "server-only";
import { getCachedSeries } from "./cache";
import { BASE_CURRENCY } from "./currency";
import type { SeriesRange } from "./providers/types";

// Per-date FX conversion into the portfolio base currency (THB), reusing the
// existing keyless Frankfurter chain (ECB reference rates) — no new provider.
//
// Frankfurter quotes USD→XXX (the Yahoo "XXX=X" convention). To convert an
// amount in currency C to THB on a given date we use the cross rate
//   C→THB = (USD→THB) / (USD→C)
// from that date's two USD-based rates. ECB publishes working-day rates only,
// so we forward-fill the most recent rate on/before each portfolio date (weekend
// and holiday gaps reuse the prior business day, as is standard for daily FX).

/** A per-date lookup of "1 unit of currency C, in THB". */
export interface FxConverter {
  /** Multiply a value in currency C by this to get THB. 1 for THB itself. */
  rateOn(currency: string, date: string): number | null;
  /** True if every requested non-THB currency resolved to at least one rate. */
  readonly missing: ReadonlySet<string>;
}

/** Build a forward-fill lookup (date → rate) from an ascending date series. */
function forwardFillRates(
  series: { date: string; close: number }[],
  dates: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  let i = 0;
  let last: number | null = null;
  for (const d of dates) {
    while (i < series.length && series[i].date <= d) {
      last = series[i].close;
      i++;
    }
    if (last !== null) out.set(d, last);
  }
  // ECB has no rate before its first published date in range; back-fill the
  // earliest known rate so leading portfolio dates still convert rather than
  // dropping the holding. FX moves are small relative to the alternative
  // (summing raw foreign NAV as if it were THB).
  if (last === null && series.length > 0) return out;
  const firstKnown = series[0]?.close ?? null;
  if (firstKnown !== null) {
    for (const d of dates) {
      if (!out.has(d)) out.set(d, firstKnown);
    }
  }
  return out;
}

/**
 * Build an FX converter covering `currencies` over the dates spanned by
 * `range`, fetching each USD→currency series (incl. USD→THB) once from the
 * cache. Missing or cold rates degrade gracefully: `rateOn` returns null for an
 * unresolved currency and the caller decides how to handle it (we skip that
 * holding's contribution rather than crash, and flag it via `missing`).
 *
 * THB needs no rate (factor 1). USD→THB is the THB=X series. A third currency C
 * converts to THB via the cross rate (USD→THB)/(USD→C) on the same date.
 */
export async function buildFxConverter(
  currencies: Iterable<string>,
  range: SeriesRange,
  dates: string[],
): Promise<FxConverter> {
  const needed = new Set<string>();
  for (const c of currencies) {
    if (c && c !== BASE_CURRENCY) needed.add(c);
  }

  const missing = new Set<string>();

  // USD→THB drives every conversion. If THB itself is the only thing we need and
  // there are no foreign currencies, we can short-circuit.
  const usdThb = await fetchUsdRate(BASE_CURRENCY, range, dates);
  if (usdThb === null && needed.size > 0) {
    // No USD→THB at all — can't convert anything foreign. Mark all foreign
    // currencies missing; rateOn will return null for them.
    for (const c of needed) missing.add(c);
    return { rateOn: (c) => (c === BASE_CURRENCY ? 1 : null), missing };
  }

  // For each needed foreign currency C, fetch USD→C (USD needs none — USD→THB
  // already IS the USD factor).
  const usdRates = new Map<string, Map<string, number>>();
  await Promise.all(
    Array.from(needed).map(async (c) => {
      if (c === "USD") return; // handled directly via usdThb
      const r = await fetchUsdRate(c, range, dates);
      if (r === null || r.size === 0) {
        missing.add(c);
        return;
      }
      usdRates.set(c, r);
    }),
  );

  const rateOn = (currency: string, date: string): number | null => {
    if (!currency || currency === BASE_CURRENCY) return 1;
    if (!usdThb) return null;
    const thbPerUsd = usdThb.get(date);
    if (thbPerUsd === undefined) return null;
    if (currency === "USD") return thbPerUsd;
    const usdPerC = usdRates.get(currency)?.get(date);
    if (usdPerC === undefined || usdPerC === 0) return null;
    // C→THB = (USD→THB) / (USD→C)
    return thbPerUsd / usdPerC;
  };

  return { rateOn, missing };
}

/** Fetch the USD→`currency` daily series via Frankfurter and forward-fill it. */
async function fetchUsdRate(
  currency: string,
  range: SeriesRange,
  dates: string[],
): Promise<Map<string, number> | null> {
  try {
    const cached = await getCachedSeries("yahoo", `${currency}=X`, range);
    if (cached.series.length === 0) return null;
    return forwardFillRates(cached.series, dates);
  } catch {
    return null;
  }
}
