// Unit tests for the tracked-market refresh job (issue #23) + the held-market
// deep-warm (issue #141).
//
// Strategy: inject the held-ref lister and the refreshSymbols batcher so these
// run without a DB or network. Assertions are on the depth split: held `market`
// positions warm to "max" (processed first so they win the de-dup), while
// indicators and held funds/manual stay at the shallow range.

import { describe, expect, it, vi } from "vitest";
import { INDICATOR_CATALOG } from "../market/indicators";
import { refreshTrackedMarket } from "./refresh-tracked-market";

type Ref = { source: string; ticker: string };
const okResults = (refs: Ref[]) => refs.map((r) => ({ ...r, ok: true }));

describe("refreshTrackedMarket — depth split", () => {
  it("warms held market positions at max and the indicators at the shallow range", async () => {
    const refresh = vi.fn(async (refs: Ref[], _range?: string) => okResults(refs));
    const held: Ref[] = [{ source: "market", ticker: "VWO" }];

    await refreshTrackedMarket({
      range: "6mo",
      _listHeld: () => held,
      _refreshSymbols: refresh,
    });

    // Two batches: deep (held market → max) first, then shallow (indicators).
    expect(refresh).toHaveBeenCalledTimes(2);
    const [deepRefs, deepRange] = refresh.mock.calls[0];
    const [, shallowRange] = refresh.mock.calls[1];
    expect(deepRange).toBe("max");
    expect(deepRefs).toEqual([{ source: "market", ticker: "VWO" }]);
    expect(shallowRange).toBe("6mo");
  });

  it("a held-market symbol that is also a catalog indicator wins the max slot", async () => {
    const refresh = vi.fn(async (refs: Ref[], _range?: string) => okResults(refs));
    const indicator = INDICATOR_CATALOG[0].symbol; // also held as a market position
    const held: Ref[] = [{ source: "market", ticker: indicator }];

    await refreshTrackedMarket({ _listHeld: () => held, _refreshSymbols: refresh });

    const [deepRefs] = refresh.mock.calls[0];
    const [shallowRefs] = refresh.mock.calls[1];
    // It appears once, in the deep batch — and is de-duped out of the shallow one.
    expect(deepRefs).toEqual([{ source: "market", ticker: indicator }]);
    expect(shallowRefs.some((r: Ref) => r.ticker === indicator)).toBe(false);
  });

  it("keeps held funds / manual positions at the shallow range (only market deepens)", async () => {
    const refresh = vi.fn(async (refs: Ref[], _range?: string) => okResults(refs));
    const held: Ref[] = [
      { source: "thai_mutual_fund", ticker: "FUND-A" },
      { source: "manual", ticker: "GOLD-BAR" },
    ];

    await refreshTrackedMarket({ range: "1y", _listHeld: () => held, _refreshSymbols: refresh });

    // No held market refs → no deep batch; everything in one shallow call.
    expect(refresh).toHaveBeenCalledTimes(1);
    const [shallowRefs, shallowRange] = refresh.mock.calls[0];
    expect(shallowRange).toBe("1y");
    expect(shallowRefs).toContainEqual({ source: "thai_mutual_fund", ticker: "FUND-A" });
    expect(shallowRefs).toContainEqual({ source: "manual", ticker: "GOLD-BAR" });
  });

  it("aggregates ok/failed counts across both batches", async () => {
    const refresh = vi.fn(async (refs: Ref[], _range?: string) =>
      refs.map((r) => ({
        ...r,
        ok: r.ticker !== "BAD",
        error: r.ticker === "BAD" ? "no data" : undefined,
      })),
    );
    const held: Ref[] = [
      { source: "market", ticker: "VWO" },
      { source: "market", ticker: "BAD" },
    ];

    const res = await refreshTrackedMarket({ _listHeld: () => held, _refreshSymbols: refresh });

    expect(res.requested).toBe(res.ok + res.failed);
    expect(res.failed).toBe(1);
    expect(res.errors).toContainEqual({ source: "market", ticker: "BAD", error: "no data" });
  });
});
