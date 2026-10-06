// Every upstream market-data fetch is bounded: a hung provider throws, and the
// chain in lib/market/cache.ts moves on to the next provider instead of
// stalling the request (or Advisor tool) that is waiting on it.
export const PROVIDER_TIMEOUT_MS = 10_000;

export function providerFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}

/** True when a fetch failed because its timeout elapsed (a retry would wait just as long). */
export function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}
