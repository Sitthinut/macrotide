import "server-only";
import { and, eq, gt, or, type SQL } from "drizzle-orm";
import { getDb } from "../context";
import { actionItemStates } from "../schema";
import { ownedBy, ownerId } from "./scope";

export type ActionItemStateRow = typeof actionItemStates.$inferSelect;
export type ActionItemState = "dismissed" | "snoozed" | "disagreed";

/** A suppressed item, as the generator filter consumes it. */
export interface SuppressedRow {
  itemKey: string;
  state: ActionItemState;
  snoozeUntil: string | null;
}

/**
 * The active-suppression set the generator consults. A `snoozed` row whose
 * `snoozeUntil` has passed is treated as expired and NOT returned — it
 * self-heals without a sweeper. `dismissed` and `disagreed` are always
 * returned. Scoped to the current owner / demo session via `ownedBy`.
 */
export function listSuppressed(now: string = new Date().toISOString()): SuppressedRow[] {
  // Suppressed = dismissed / disagreed (always), OR a snooze that hasn't expired
  // yet. The two non-snooze states are spelled out (rather than `!= 'snoozed'`)
  // so the predicate stays explicit. or() with 3 args always returns SQL.
  // biome-ignore lint/style/noNonNullAssertion: or() with 2+ args returns SQL
  const live: SQL = or(
    eq(actionItemStates.state, "dismissed"),
    eq(actionItemStates.state, "disagreed"),
    and(eq(actionItemStates.state, "snoozed"), gt(actionItemStates.snoozeUntil, now)),
  )!;

  return getDb()
    .select({
      itemKey: actionItemStates.itemKey,
      state: actionItemStates.state,
      snoozeUntil: actionItemStates.snoozeUntil,
    })
    .from(actionItemStates)
    .where(and(ownedBy(actionItemStates.userId), live))
    .all();
}

/**
 * Idempotent upsert on (user_id, item_key) — one state per item. `state` drives
 * `snoozeUntil`: a `snoozed` state requires a `snoozeUntil`; `dismissed` /
 * `disagreed` force it to NULL. Re-acting on the same item overwrites the row
 * (you can't be both snoozed and disagreed).
 *
 * We scope-then-update/insert rather than `ON CONFLICT (user_id, item_key)`
 * because SQLite treats NULL user_ids as distinct in a UNIQUE index — so in
 * single-owner / demo mode (user_id NULL) the conflict would never fire and we'd
 * accumulate duplicates. Matching on `ownedBy(...)` collapses to the one logical
 * owner correctly (same pattern as setUserIndicatorSymbols).
 */
export function setActionItemState(input: {
  itemType: string;
  itemKey: string;
  state: ActionItemState;
  snoozeUntil?: string | null;
}): ActionItemStateRow {
  const snoozeUntil = input.state === "snoozed" ? (input.snoozeUntil ?? null) : null;
  const now = new Date().toISOString();
  const db = getDb();
  const scope = and(eq(actionItemStates.itemKey, input.itemKey), ownedBy(actionItemStates.userId));

  const existing = db.select().from(actionItemStates).where(scope).get();
  if (existing) {
    return db
      .update(actionItemStates)
      .set({ state: input.state, snoozeUntil, itemType: input.itemType, updatedAt: now })
      .where(scope)
      .returning()
      .get();
  }
  return db
    .insert(actionItemStates)
    .values({
      userId: ownerId(),
      itemType: input.itemType,
      itemKey: input.itemKey,
      state: input.state,
      snoozeUntil,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** All states for the current owner (for the future "parked" view). */
export function listActionItemStates(): ActionItemStateRow[] {
  return getDb().select().from(actionItemStates).where(ownedBy(actionItemStates.userId)).all();
}

/** Delete a state row → the item becomes active again (un-dismiss / restore). */
export function clearActionItemState(itemKey: string): void {
  getDb()
    .delete(actionItemStates)
    .where(and(eq(actionItemStates.itemKey, itemKey), ownedBy(actionItemStates.userId)))
    .run();
}
