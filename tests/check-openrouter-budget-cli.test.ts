// Tests for the OpenRouter budget probe CLI (issue #183).
//
// Coverage: the pure CLI-layer helpers — parseArgs, pctUsed, classify, and the
// exit-code policy. The live fetch in main() is intentionally not exercised here
// (no network in `npm test`); the contract that matters — how a reading maps to a
// status and an exit code — is all pure and pinned below.

import { describe, expect, it } from "vitest";
import {
  ACCOUNT_FLOOR_USD,
  alertMessage,
  CRITICAL_EXIT_CODE,
  classify,
  classifyCredits,
  DEFAULT_CRIT_PCT,
  DEFAULT_WARN_PCT,
  exitCodeFor,
  parseArgs,
  pctUsed,
  worstStatus,
} from "../scripts/check-openrouter-budget";

describe("parseArgs", () => {
  it("defaults to 80 / 95", () => {
    expect(parseArgs([])).toEqual({ warnPct: DEFAULT_WARN_PCT, critPct: DEFAULT_CRIT_PCT });
  });

  it("parses both flags", () => {
    expect(parseArgs(["--warn-pct=70", "--crit-pct=90"])).toEqual({ warnPct: 70, critPct: 90 });
  });

  it("accepts fractional percentages", () => {
    expect(parseArgs(["--warn-pct=82.5"]).warnPct).toBe(82.5);
  });

  it("ignores out-of-range and malformed values (keeps defaults)", () => {
    expect(parseArgs(["--warn-pct=0", "--crit-pct=150", "--warn-pct=abc"])).toEqual({
      warnPct: DEFAULT_WARN_PCT,
      critPct: DEFAULT_CRIT_PCT,
    });
  });
});

describe("pctUsed", () => {
  it("computes (limit - remaining) / limit", () => {
    expect(pctUsed({ limit: 20, limitRemaining: 5 })).toBeCloseTo(75);
  });

  it("is null when no limit is set", () => {
    expect(pctUsed({ limit: null, limitRemaining: null })).toBeNull();
  });

  it("is null on a non-positive or non-finite limit", () => {
    expect(pctUsed({ limit: 0, limitRemaining: 0 })).toBeNull();
    expect(pctUsed({ limit: Number.NaN, limitRemaining: 1 })).toBeNull();
  });

  it("is null when remaining is missing", () => {
    expect(pctUsed({ limit: 20, limitRemaining: null })).toBeNull();
  });

  it("exceeds 100 when over the limit (negative remaining)", () => {
    expect(pctUsed({ limit: 20, limitRemaining: -2 })).toBeCloseTo(110);
  });
});

describe("classify", () => {
  const warn = 80;
  const crit = 95;

  it("healthy below the warn threshold", () => {
    expect(classify({ limit: 20, limitRemaining: 8 }, warn, crit)).toBe("healthy"); // 60%
  });

  it("warn at exactly the warn boundary (inclusive)", () => {
    expect(classify({ limit: 100, limitRemaining: 20 }, warn, crit)).toBe("warn"); // 80%
  });

  it("critical at exactly the crit boundary (inclusive)", () => {
    expect(classify({ limit: 100, limitRemaining: 5 }, warn, crit)).toBe("critical"); // 95%
  });

  it("critical when already over the limit", () => {
    expect(classify({ limit: 20, limitRemaining: -1 }, warn, crit)).toBe("critical");
  });

  it("indeterminate when no limit is set (fail open)", () => {
    expect(classify({ limit: null, limitRemaining: null }, warn, crit)).toBe("indeterminate");
  });
});

describe("exitCodeFor", () => {
  it("is non-zero ONLY for critical, and only without an alert URL (the fallback path)", () => {
    // No heartbeat URL → critical exits non-zero to drive the server-side OnFailure alert.
    expect(exitCodeFor("critical", false)).toBe(CRITICAL_EXIT_CODE);
    expect(exitCodeFor("healthy", false)).toBe(0);
    expect(exitCodeFor("warn", false)).toBe(0);
    expect(exitCodeFor("indeterminate", false)).toBe(0);
  });

  it("is always 0 when an alert URL is set (the probe self-notifies via /fail)", () => {
    expect(exitCodeFor("critical", true)).toBe(0);
    expect(exitCodeFor("healthy", true)).toBe(0);
    expect(exitCodeFor("warn", true)).toBe(0);
    expect(exitCodeFor("indeterminate", true)).toBe(0);
  });
});

describe("alertMessage", () => {
  it("warn body carries the status word, percent, and used/limit dollars", () => {
    expect(alertMessage("warn", { limit: 20, limitRemaining: 4 })).toBe(
      "warn: OpenRouter spend 80.0% — $16.00/$20.00",
    );
  });

  it("critical body uses the critical word", () => {
    expect(alertMessage("critical", { limit: 20, limitRemaining: 1 })).toBe(
      "critical: OpenRouter spend 95.0% — $19.00/$20.00",
    );
  });

  it("renders n/a when the limit can't be read", () => {
    expect(alertMessage("warn", { limit: null, limitRemaining: null })).toBe(
      "warn: OpenRouter spend n/a — n/a/n/a",
    );
  });
});

describe("worstStatus", () => {
  it("prefers the more severe verdict in either argument order", () => {
    expect(worstStatus("healthy", "critical")).toBe("critical");
    expect(worstStatus("critical", "healthy")).toBe("critical");
    expect(worstStatus("healthy", "warn")).toBe("warn");
    expect(worstStatus("warn", "critical")).toBe("critical");
  });

  it("never lets an unreadable dimension mask a real verdict", () => {
    // The whole point: a credits read that fails must not downgrade a real key
    // warn/critical to indeterminate (which the caller treats as exit 0).
    expect(worstStatus("indeterminate", "critical")).toBe("critical");
    expect(worstStatus("indeterminate", "warn")).toBe("warn");
    expect(worstStatus("indeterminate", "healthy")).toBe("healthy");
  });

  it("is indeterminate only when BOTH dimensions are", () => {
    expect(worstStatus("indeterminate", "indeterminate")).toBe("indeterminate");
  });
});

describe("classifyCredits (auto-topup account: absolute floor, not a percentage)", () => {
  // With auto-topup enabled a LOW balance is normal — the account gets refilled,
  // not drained — so a percentage test would fire forever. Only a balance below the
  // floor means the refill did not happen. Figures are synthetic.
  it("is healthy at a low balance that a percentage test would have called warn", () => {
    expect(classifyCredits({ limit: 50, limitRemaining: 7.5 })).toBe("healthy");
  });

  it("stays healthy just above the floor, however low the percentage looks", () => {
    expect(classifyCredits({ limit: 50, limitRemaining: ACCOUNT_FLOOR_USD })).toBe("healthy");
    expect(classifyCredits({ limit: 500, limitRemaining: 2.0 })).toBe("healthy");
  });

  it("is critical below the floor — auto-topup did not refill", () => {
    expect(classifyCredits({ limit: 50, limitRemaining: 0.4 })).toBe("critical");
    expect(classifyCredits({ limit: 50, limitRemaining: 0 })).toBe("critical");
  });

  it("is indeterminate when the balance cannot be read (never a false page)", () => {
    expect(classifyCredits({ limit: null, limitRemaining: null })).toBe("indeterminate");
  });

  it("a healthy balance never downgrades a real key-cap verdict", () => {
    const keyCritical = classify({ limit: 50, limitRemaining: 0.5 }, 80, 95);
    expect(worstStatus(keyCritical, classifyCredits({ limit: 50, limitRemaining: 7.5 }))).toBe(
      "critical",
    );
  });
});
