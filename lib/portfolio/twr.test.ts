import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "@/lib/static/types";
import { seriesReturnPct } from "./adapter";
import { periodTwr } from "./twr";

// Daily points keyed by an index → date, so the series reads like a calendar.
const series = (vals: number[]): SeriesPoint[] =>
  vals.map((v, i) => ({ d: `2026-01-${String(i + 1).padStart(2, "0")}`, v }));
const flows = (vals: number[]): SeriesPoint[] =>
  vals.map((v, i) => ({ d: `2026-01-${String(i + 1).padStart(2, "0")}`, v }));

describe("periodTwr", () => {
  it("does not blow up when a large deposit lands mid-window (the #236 bug)", () => {
    // Start ฿11k; ฿800k deposit lands on day 2 (no market move that day); ฿8k of
    // fund growth then accrues over the following days. The old gain÷base read
    // 8k÷11k ≈ 73%; TWR rebases at the deposit and reports the true ~1%.
    const v = series([11_000, 811_000, 815_000, 819_000]);
    const f = flows([0, 800_000, 800_000, 800_000]);
    const twr = periodTwr(v, f);
    expect(twr).toBeCloseTo(0.99, 1);
    expect(twr).toBeLessThan(5); // emphatically NOT 73%
  });

  it("returns the window gain on a grown book, not gain÷contributed-capital", () => {
    // Book grew to ฿500k from ฿100k contributed long ago; +฿25k this window, no
    // new flows. Contributed-capital base would read 25k÷100k = 25%; TWR = 5%.
    const v = series([500_000, 525_000]);
    const f = flows([100_000, 100_000]); // flat — contributions predate the window
    expect(periodTwr(v, f)).toBeCloseTo(5, 5);
  });

  it("equals the simple price return when there are no flows", () => {
    const v = series([1000, 1050, 1030, 1100]);
    const f = flows([200, 200, 200, 200]); // flat contributions → zero flow
    expect(periodTwr(v, f)).toBeCloseTo(seriesReturnPct(v) as number, 9);
  });

  it("neutralizes a withdrawal — a pure cash-out is 0% return", () => {
    const v = series([1000, 1000, 500]);
    const f = flows([0, 0, -500]); // ฿500 withdrawn, no market move
    expect(periodTwr(v, f)).toBeCloseTo(0, 9);
  });

  it("survives divest-to-zero then redeposit without NaN/Infinity", () => {
    // +10%, full ฿1100 withdrawal to zero, idle, ฿500 redeposit, +4%.
    const v = series([1000, 1100, 0, 0, 500, 520]);
    const f = flows([1000, 1000, -100, -100, 400, 400]);
    const twr = periodTwr(v, f);
    expect(Number.isFinite(twr)).toBe(true);
    expect(twr).toBeCloseTo(14.4, 1); // 1.10 × 1.04 − 1
  });

  it("treats a custom self-priced revalue as return, but a buy into it as a flow", () => {
    // Carry-flat custom asset (no daily NAV): flat days, then a manual revalue.
    const revalue = periodTwr(series([1000, 1000, 1000, 1100]), flows([500, 500, 500, 500]));
    expect(revalue).toBeCloseTo(10, 5); // the step is return, flat days add nothing

    // Same value step, but contributions rise with it → it was a purchase, not gain.
    const purchase = periodTwr(series([1000, 1000, 2000]), flows([500, 500, 1500]));
    expect(purchase).toBeCloseTo(0, 9);
  });

  it("returns null when there is nothing to chain", () => {
    expect(periodTwr([], [])).toBeNull();
    expect(periodTwr(series([1000]), flows([0]))).toBeNull();
    expect(periodTwr([{ d: "2026-01-01", v: Number.NaN }], [])).toBeNull();
  });

  it("ignores a stale flow date that does not align to the value series", () => {
    // A flow point on a date absent from the value series carries forward as a
    // no-op (cumulative unchanged) rather than spiking a phantom flow.
    const v = series([1000, 1100]);
    const f: SeriesPoint[] = [
      { d: "2026-01-01", v: 0 },
      { d: "2025-12-31", v: 999 }, // not in the value timeline
      { d: "2026-01-02", v: 0 },
    ];
    expect(periodTwr(v, f)).toBeCloseTo(10, 5);
  });
});
