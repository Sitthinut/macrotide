import { describe, expect, it } from "vitest";
import { performanceDisclaimer } from "./performance-disclaimer";

describe("performanceDisclaimer", () => {
  it("benchmark selected, no dividend fund → benchmark-only sentence", () => {
    expect(performanceDisclaimer(true, false)).toBe(
      "The benchmark excludes dividends, so the index's real return is slightly higher than the line shown.",
    );
  });

  it("no benchmark, holds a dividend fund → balance-only sentence", () => {
    expect(performanceDisclaimer(false, true)).toBe(
      "Your balance does not include dividends paid out by dividend-paying funds, so your actual total return is slightly higher.",
    );
  });

  it("both → combined sentence", () => {
    expect(performanceDisclaimer(true, true)).toBe(
      "Dividends are excluded from both the benchmark and your dividend-paying funds, so actual returns are slightly higher than the lines shown.",
    );
  });

  it("neither → null (render nothing)", () => {
    expect(performanceDisclaimer(false, false)).toBeNull();
  });
});
