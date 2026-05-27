// (source, ticker) → Provider routing.
//
// Providers are checked in registration order; the first one whose `matches`
// returns true wins. Providers shipped with the app:
//   - "thai_mutual_fund"  → sec-thailand (Thai SEC Open API)
//   - "yahoo"             → yahoo (broad catch-all for stocks/indices/FX)
//
// Add a new asset class by introducing a new quote_source value (see
// lib/market/sources.ts), implementing a Provider that matches it, and
// calling registerProvider() at module load. The provider order ensures
// more-specific sources are tried before broader ones.

import { eodhdProvider } from "./providers/eodhd";
import { fmpProvider } from "./providers/fmp";
import { frankfurterProvider } from "./providers/frankfurter";
import { secThailandProvider } from "./providers/sec-thailand";
import { twelveDataProvider } from "./providers/twelvedata";
import type { Provider } from "./providers/types";
import { yahooProvider } from "./providers/yahoo";

// Order matters: preferred sources first, then fallbacks. For the `yahoo`
// logical source the chain is:
//   fmp (keyed, REAL US indices)  → eodhd (keyed, REAL global indices + SET)
//     → twelveData (keyed, ETF proxies)  → frankfurter (keyless, FX only)
//       → yahoo (keyless)
//
// Real index levels are preferred where a source serves them: FMP first (its
// 250/day free quota is the most generous and it covers ^GSPC/^NDX/^DJI), then
// EODHD (20/day, broader — adds Nikkei + the Thai SET index). Both only `match`
// the specific index symbols they map AND only when their key is set, so for any
// other ticker — or with no keys configured — they drop out and the chain is
// exactly the prior behaviour: Twelve Data ETF proxy → Frankfurter FX → Yahoo.
// FX pairs (USD/THB) fall back to ECB-backed Frankfurter (which, unlike Yahoo,
// doesn't block datacenter IPs); MSCI ACWI has no free real index and stays a
// Twelve Data ETF proxy (ACWI); Gold stays the XAU/USD commodity (GC=F).
const providers: Provider[] = [
  secThailandProvider,
  fmpProvider,
  eodhdProvider,
  twelveDataProvider,
  frankfurterProvider,
  yahooProvider,
];

/**
 * Register a provider at app boot. Idempotent on `id`. Providers added later
 * are inserted at the front of the list.
 */
export function registerProvider(p: Provider): void {
  const idx = providers.findIndex((existing) => existing.id === p.id);
  if (idx >= 0) {
    providers[idx] = p;
    return;
  }
  providers.unshift(p);
}

export function resolveProvider(source: string, ticker: string): Provider {
  for (const p of providers) {
    if (p.matches(source, ticker)) return p;
  }
  throw new Error(`No provider matches source="${source}", ticker="${ticker}"`);
}

/**
 * All providers that match a (source, ticker), in preference order. The cache
 * tries them in turn — keyed source first, keyless fallback next — so a single
 * symbol still resolves when the primary upstream fails or is rate-limited.
 */
export function resolveProviderChain(source: string, ticker: string): Provider[] {
  return providers.filter((p) => p.matches(source, ticker));
}

export function listProviders(): readonly Provider[] {
  return providers;
}
