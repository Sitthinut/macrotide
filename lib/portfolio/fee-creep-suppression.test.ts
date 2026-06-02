// Integration contract for the fee-creep suppression filter — the composition
// GET /api/portfolio/fee-creep performs: computeFeeCreep() minus the suppressed
// set (keyed by fee_creep:{heldTicker}). Covers:
//   - dismissed findings are hidden
//   - snoozed findings are hidden until snoozeUntil, then reappear
//   - disagreed findings stay hidden
//   - the DEMO write path (isDemo: true) records + filters within the session
//
// We replay the migration baseline into a fresh in-memory app.db so the new
// action_item_states migration is exercised end-to-end. Synthetic data only.

import { describe, expect, it } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";
import { type DbContext, runWithDbContext } from "../db/context";
import { listSuppressed, setActionItemState } from "../db/queries/action-items";
import {
  type FundFeeInsert,
  type FundInsert,
  upsertFund,
  upsertFundFees,
} from "../db/queries/funds";
import { createHolding } from "../db/queries/holdings";
import * as schema from "../db/schema";
import { feeCreepKey } from "./action-item-key";
import { computeFeeCreep } from "./fee-creep";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fund(projId: string, over: Partial<FundInsert> = {}): FundInsert {
  return {
    projId,
    abbrName: projId,
    englishName: `${projId} Fund`,
    assetClass: "equity",
    fundType: "Foreign Investment Fund",
    status: "active",
    ...over,
  };
}

function ter(projId: string, actual: number): FundFeeInsert {
  return {
    projId,
    fundClassName: "A",
    feeType: "total_expense",
    feeTypeRaw: "ค่าธรรมเนียมและค่าใช้จ่ายรวมทั้งหมด (Total Fee and Expense)",
    actualRatePct: actual,
    rateCeilingPct: actual + 0.5,
    periodStart: "2026-01-01",
    periodEnd: null,
  };
}

/** Build a context whose app.db holds two flaggable funds (PRICEY, PRICEY2). */
function seededCtx(overrides: Partial<Pick<DbContext, "isDemo" | "sessionId" | "userId">> = {}) {
  const ctx = makeTestDbContext(overrides);
  runWithDbContext(ctx, () => {
    ctx.appDb
      .insert(schema.buckets)
      .values({ id: "b1", name: "Test", brokerage: "—", createdAt: "x", updatedAt: "x" })
      .run();
    upsertFund(fund("PRICEY"));
    upsertFund(fund("PRICEY2"));
    upsertFund(fund("CHEAP"));
    upsertFundFees([ter("PRICEY", 1.2), ter("PRICEY2", 1.0), ter("CHEAP", 0.3)]);
    createHolding({ bucketId: "b1", ticker: "PRICEY", englishName: "p", units: 1 });
    createHolding({ bucketId: "b1", ticker: "PRICEY2", englishName: "p2", units: 1 });
  });
  return ctx;
}

/** Mirror the route's composition: computeFeeCreep minus the suppressed set. */
function visibleFindings(now?: string) {
  const findings = computeFeeCreep();
  const suppressed = new Set(listSuppressed(now).map((s) => s.itemKey));
  return findings.filter((f) => !suppressed.has(feeCreepKey(f.heldTicker)));
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

// ─── tests ───────────────────────────────────────────────────────────────────

describe("fee-creep suppression filter", () => {
  it("shows all findings when nothing is suppressed", () => {
    const ctx = seededCtx();
    runWithDbContext(ctx, () => {
      expect(
        visibleFindings()
          .map((f) => f.heldTicker)
          .sort(),
      ).toEqual(["PRICEY", "PRICEY2"]);
    });
  });

  it("hides a dismissed finding, leaves the others", () => {
    const ctx = seededCtx();
    runWithDbContext(ctx, () => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey("PRICEY"),
        state: "dismissed",
      });
      expect(visibleFindings().map((f) => f.heldTicker)).toEqual(["PRICEY2"]);
    });
  });

  it("hides a disagreed finding permanently", () => {
    const ctx = seededCtx();
    runWithDbContext(ctx, () => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey("PRICEY"),
        state: "disagreed",
      });
      expect(visibleFindings().map((f) => f.heldTicker)).toEqual(["PRICEY2"]);
    });
  });

  it("hides a snoozed finding until snoozeUntil, then it reappears", () => {
    const ctx = seededCtx();
    runWithDbContext(ctx, () => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey("PRICEY"),
        state: "snoozed",
        snoozeUntil: FUTURE,
      });
      // Hidden while snoozed.
      expect(visibleFindings().map((f) => f.heldTicker)).toEqual(["PRICEY2"]);
      // After the snooze window (evaluate "now" past snoozeUntil) it returns.
      const afterExpiry = new Date(Date.now() + 2 * 86_400_000).toISOString();
      expect(
        visibleFindings(afterExpiry)
          .map((f) => f.heldTicker)
          .sort(),
      ).toEqual(["PRICEY", "PRICEY2"]);
    });
  });

  it("treats an already-expired snooze as not suppressing", () => {
    const ctx = seededCtx();
    runWithDbContext(ctx, () => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey("PRICEY"),
        state: "snoozed",
        snoozeUntil: PAST,
      });
      expect(
        visibleFindings()
          .map((f) => f.heldTicker)
          .sort(),
      ).toEqual(["PRICEY", "PRICEY2"]);
    });
  });

  it("records and filters within a DEMO session (isDemo path)", () => {
    // The demo write path: userId stays null, ownedBy collapses to user_id IS
    // NULL, isolated by the session's own in-memory app.db. No special-casing.
    const ctx = seededCtx({ isDemo: true, sessionId: "demo-1", userId: null });
    runWithDbContext(ctx, () => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey("PRICEY"),
        state: "dismissed",
      });
      expect(listSuppressed().map((s) => s.itemKey)).toEqual([feeCreepKey("PRICEY")]);
      expect(visibleFindings().map((f) => f.heldTicker)).toEqual(["PRICEY2"]);
    });
  });
});
