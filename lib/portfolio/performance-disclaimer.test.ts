import { describe, expect, it } from "vitest";
import { performanceDisclaimer } from "./performance-disclaimer";

describe("performanceDisclaimer", () => {
  it("TR benchmark selected, no dividend fund → no caveat (both total return)", () => {
    expect(performanceDisclaimer(true, false)).toBeNull();
  });

  it("no benchmark, holds a dividend fund → balance-only sentence", () => {
    expect(performanceDisclaimer(false, true)).toBe(
      "Some of your funds pay dividends as cash. Your total return is a little higher than this line shows.",
    );
  });

  it("TR benchmark + dividend fund → portfolio understates vs benchmark", () => {
    expect(performanceDisclaimer(true, true)).toBe(
      "Your funds pay dividends as cash, so your line may run slightly below this total-return benchmark.",
    );
  });

  it("neither → null (render nothing)", () => {
    expect(performanceDisclaimer(false, false)).toBeNull();
  });
});
