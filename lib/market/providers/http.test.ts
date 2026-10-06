import { afterEach, describe, expect, it, vi } from "vitest";
import { isTimeout, PROVIDER_TIMEOUT_MS, providerFetch } from "./http";

describe("providerFetch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bounds every request with a timeout signal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}"));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await providerFetch("https://example.test/x", { headers: { Accept: "application/json" } });

    expect(timeoutSpy).toHaveBeenCalledWith(PROVIDER_TIMEOUT_MS);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("keeps a caller's own signal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}"));
    const own = new AbortController().signal;

    await providerFetch("https://example.test/x", { signal: own });

    expect((fetchSpy.mock.calls[0][1] as RequestInit).signal).toBe(own);
  });
});

describe("isTimeout", () => {
  it("recognizes an elapsed timeout and nothing else", () => {
    expect(isTimeout(new DOMException("timed out", "TimeoutError"))).toBe(true);
    expect(isTimeout(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isTimeout(new Error("TimeoutError"))).toBe(false);
  });
});
