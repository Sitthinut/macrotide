// Provider-agnostic shape for market data sources.
//
// A provider knows how to:
//   - decide whether it owns a symbol (`matches`)
//   - return a normalized quote + daily series in one call (`fetchSeries`)
//
// The registry (see `lib/market/registry.ts`) iterates providers in
// registration order and picks the first match. Add a new provider by
// implementing this interface and registering it.

export type SeriesRange = "1mo" | "3mo" | "6mo" | "1y" | "5y" | "max";
export type SeriesInterval = "1d" | "1wk" | "1mo";

export interface Quote {
  /** Symbol returned by the provider (may be canonicalized). */
  symbol: string;
  /** Human-friendly name when the provider has one. */
  name: string;
  currency: string;
  price: number;
  /** Previous-period close. Used to compute day-change. */
  previousClose: number;
  /** UNIX seconds. */
  asOfUnix: number;
}

export interface SeriesPoint {
  /** UNIX seconds. */
  t: number;
  close: number;
}

export interface Provider {
  /** Stable id, used in logs and error messages. */
  readonly id: string;
  /** True when this provider handles the given symbol. */
  matches(symbol: string): boolean;
  /** Fetch quote + daily series. Throws on failure. */
  fetchSeries(
    symbol: string,
    range: SeriesRange,
    interval: SeriesInterval,
  ): Promise<{ quote: Quote; series: SeriesPoint[] }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
