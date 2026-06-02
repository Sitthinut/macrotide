// Contract for action_item_states queries:
//   1. setActionItemState is an idempotent upsert on (user_id, item_key).
//   2. listSuppressed returns dismissed / disagreed always, and snoozed only
//      while snoozeUntil is in the future (expired snoozes self-heal — not
//      returned).
//   3. reads/writes are per-owner scoped via ownedBy/ownerId.
//   4. clearActionItemState removes the row (item becomes active again).

import { describe, expect, it } from "vitest";
import { makeTestDbContext } from "@/tests/db-helpers";
import { type DbContext, runWithDbContext } from "../context";
import { user } from "../schema";
import {
  clearActionItemState,
  listActionItemStates,
  listSuppressed,
  setActionItemState,
} from "./action-items";

/** Seed a user row so the action_item_states.user_id FK is satisfiable. */
function seedUser(ctx: DbContext, id: string) {
  ctx.appDb
    .insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();
}

function inCtx(fn: () => void, overrides: Partial<DbContext> = {}) {
  const ctx = makeTestDbContext(overrides);
  runWithDbContext(ctx, fn);
}

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

describe("setActionItemState", () => {
  it("inserts a dismissed row and reads it back", () => {
    inCtx(() => {
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:A", state: "dismissed" });
      const rows = listActionItemStates();
      expect(rows).toHaveLength(1);
      expect(rows[0].itemKey).toBe("fee_creep:A");
      expect(rows[0].state).toBe("dismissed");
      expect(rows[0].snoozeUntil).toBeNull();
    });
  });

  it("upserts the same (user, key) instead of duplicating", () => {
    inCtx(() => {
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:A", state: "dismissed" });
      setActionItemState({
        itemType: "fee_creep",
        itemKey: "fee_creep:A",
        state: "snoozed",
        snoozeUntil: FUTURE,
      });
      const rows = listActionItemStates();
      expect(rows).toHaveLength(1);
      expect(rows[0].state).toBe("snoozed");
      expect(rows[0].snoozeUntil).toBe(FUTURE);
    });
  });

  it("forces snoozeUntil to null for dismissed/disagreed even if supplied", () => {
    inCtx(() => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: "fee_creep:A",
        state: "disagreed",
        snoozeUntil: FUTURE,
      });
      expect(listActionItemStates()[0].snoozeUntil).toBeNull();
    });
  });
});

describe("listSuppressed", () => {
  it("returns dismissed and disagreed rows", () => {
    inCtx(() => {
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:A", state: "dismissed" });
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:B", state: "disagreed" });
      const keys = listSuppressed()
        .map((s) => s.itemKey)
        .sort();
      expect(keys).toEqual(["fee_creep:A", "fee_creep:B"]);
    });
  });

  it("returns a snoozed row while snoozeUntil is in the future", () => {
    inCtx(() => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: "fee_creep:A",
        state: "snoozed",
        snoozeUntil: FUTURE,
      });
      expect(listSuppressed().map((s) => s.itemKey)).toEqual(["fee_creep:A"]);
    });
  });

  it("does NOT return a snoozed row once snoozeUntil has passed (self-heals)", () => {
    inCtx(() => {
      setActionItemState({
        itemType: "fee_creep",
        itemKey: "fee_creep:A",
        state: "snoozed",
        snoozeUntil: PAST,
      });
      expect(listSuppressed()).toHaveLength(0);
    });
  });
});

describe("ownership scoping", () => {
  it("isolates one user's states from another's", () => {
    const userA = makeTestDbContext({ userId: "user-a" });
    seedUser(userA, "user-a");
    seedUser(userA, "user-b");
    runWithDbContext(userA, () => {
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:A", state: "dismissed" });
    });
    // A different user with the SAME underlying app.db handle sees nothing.
    const userB: DbContext = { ...userA, userId: "user-b" };
    runWithDbContext(userB, () => {
      expect(listSuppressed()).toHaveLength(0);
      expect(listActionItemStates()).toHaveLength(0);
    });
    // The owner still sees their own.
    runWithDbContext(userA, () => {
      expect(listSuppressed()).toHaveLength(1);
    });
  });
});

describe("clearActionItemState", () => {
  it("removes the row so the item is active again", () => {
    inCtx(() => {
      setActionItemState({ itemType: "fee_creep", itemKey: "fee_creep:A", state: "dismissed" });
      clearActionItemState("fee_creep:A");
      expect(listSuppressed()).toHaveLength(0);
      expect(listActionItemStates()).toHaveLength(0);
    });
  });
});
