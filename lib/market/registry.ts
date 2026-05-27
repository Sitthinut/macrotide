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

import { frankfurterProvider } from "./providers/frankfurter";
import { secThailandProvider } from "./providers/sec-thailand";
import { twelveDataProvider } from "./providers/twelvedata";
import type { Provider } from "./providers/types";
import { yahooProvider } from "./providers/yahoo";

// Order matters: preferred sources first, then fallbacks. For the `yahoo`
// logical source the chain is:
//   twelveData (keyed)  → frankfurter (keyless, FX only) → yahoo (keyless)
// so series try the reliable keyed source first; FX pairs (USD/THB) then fall
// back to ECB-backed Frankfurter — which, unlike Yahoo, doesn't block
// datacenter IPs — and finally to Yahoo. twelveData drops out when no
// TWELVE_DATA_API_KEY is set, so a key-less install still serves FX via
// Frankfurter (equity indices have no reliable keyless source and need a key).
const providers: Provider[] = [
  secThailandProvider,
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
