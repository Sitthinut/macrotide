import { describe, expect, it } from "vitest";
import {
  checkSyncLimits,
  MAX_EXTERNAL_ID_LENGTH,
  MAX_SYNC_ROWS,
  type SyncShape,
} from "./broker-sync-limits";

function shape(over: Partial<SyncShape> = {}): SyncShape {
  return {
    listedAccounts: ["a"],
    names: new Map([["a", "Plan"]]),
    rowAccounts: ["a"],
    accountLabel: "Login",
    rows: [{ ticker: "EXAMPLE-FUND-A", externalId: "example:a:r1" }],
    ...over,
  };
}

const rows = (n: number) => Array.from({ length: n }, () => ({ ticker: "EXAMPLE-FUND-A" }));

describe("checkSyncLimits", () => {
  it("passes a typical sync", () => {
    expect(checkSyncLimits(shape())).toBeNull();
  });

  it("allows rows under and at the limit, refuses over", () => {
    expect(checkSyncLimits(shape({ rows: rows(MAX_SYNC_ROWS - 1) }))).toBeNull();
    expect(checkSyncLimits(shape({ rows: rows(MAX_SYNC_ROWS) }))).toBeNull();
    expect(checkSyncLimits(shape({ rows: rows(MAX_SYNC_ROWS + 1) }))?.error).toBe("too_many_rows");
  });

  it("allows a dedup key under and at the limit, refuses over", () => {
    const withId = (n: number) => shape({ rows: [{ ticker: "T", externalId: "x".repeat(n) }] });
    expect(checkSyncLimits(withId(MAX_EXTERNAL_ID_LENGTH - 1))).toBeNull();
    expect(checkSyncLimits(withId(MAX_EXTERNAL_ID_LENGTH))).toBeNull();
    expect(checkSyncLimits(withId(MAX_EXTERNAL_ID_LENGTH + 1))?.error).toBe("field_too_long");
  });

  it("counts an account that only orders route to, not just listed ones", () => {
    const listed = Array.from({ length: 50 }, (_, i) => `a${i}`);
    expect(checkSyncLimits(shape({ listedAccounts: listed, rowAccounts: listed }))).toBeNull();
    expect(
      checkSyncLimits(shape({ listedAccounts: listed, rowAccounts: [...listed, "extra"] }))?.error,
    ).toBe("too_many_accounts");
  });
});
