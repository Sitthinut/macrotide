import { afterEach, describe, expect, it, vi } from "vitest";
import { yahooProvider } from "./yahoo";

describe("yahooProvider timeouts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives up on a timed-out request instead of retrying it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new DOMException("The operation timed out", "TimeoutError"));

    await expect(yahooProvider.fetchSeries("^GSPC", "1mo", "1d")).rejects.toThrow(/timed out/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
