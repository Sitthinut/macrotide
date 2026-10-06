import { describe, expect, it, vi } from "vitest";
import type { Provider } from "./providers/types";

// Two stand-in providers: the first hangs past its timeout, the second answers.
const hung: Provider = {
  id: "hung",
  matches: () => true,
  fetchSeries: async () => {
    throw new DOMException("The operation timed out", "TimeoutError");
  },
};
const healthy: Provider = {
  id: "healthy",
  matches: () => true,
  fetchSeries: async (ticker) => ({
    quote: {
      ticker,
      name: ticker,
      currency: "THB",
      price: 33.5,
      previousClose: 33.4,
      asOfUnix: Date.UTC(2026, 9, 6) / 1000,
    },
    series: [
      { t: Date.UTC(2026, 9, 5) / 1000, close: 33.4 },
      { t: Date.UTC(2026, 9, 6) / 1000, close: 33.5 },
    ],
  }),
};

vi.mock("./registry", () => ({ resolveProviderChain: () => [hung, healthy] }));

describe("getCachedSeries provider chain", () => {
  it("moves on to the next provider when one times out", async () => {
    const { getCachedSeries } = await import("./cache");
    const out = await getCachedSeries("market", "FAILOVER-TEST=X", "1mo", "1d", true);
    expect(out.quote?.price).toBe(33.5);
    expect(out.series.at(-1)?.close).toBe(33.5);
  });
});
