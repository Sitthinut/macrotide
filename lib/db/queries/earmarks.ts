import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "../context";
import { earmarks } from "../schema";
import { ownedBy, ownerId } from "./scope";

// Cash earmarks — a designation that part (or all) of a cash account is RESERVED for a
// purpose (#149). v1 stores one earmark per cash account (the `account` scope); the
// `portfolio`/`goal` scopes are schema-ready (no UI). The pure split math lives in
// lib/portfolio/earmarks.ts (resolveEarmarks); this is just the owner-scoped store.

export type Earmark = typeof earmarks.$inferSelect;

/** Every earmark the owner has set — fed to `resolveEarmarks` against the cash holdings. */
export function listEarmarks(): Earmark[] {
  return getDb().select().from(earmarks).where(ownedBy(earmarks.userId)).all();
}

export type EarmarkRole = "investable" | "reserved";

export interface SetEarmarkInput {
  bucketId: string;
  /** The cash account ticker (account scope). */
  ticker: string;
  /** 'reserved' (excluded from return) | 'investable' (counts; the row just carries a label). */
  role?: EarmarkRole;
  /** Reserved amount in `currency`; NULL = "All" (the whole balance, auto-tracks). */
  amount: number | null;
  currency?: string | null;
  purpose?: string | null;
}

/**
 * Create or replace the `account`-scope earmark for one cash account. Keyed on
 * (bucketId, ticker, scope) — NOT a holding id (the holdings projection drops/recreates
 * rows, so an id FK would dangle). The ticker is upper-cased to match the always-upper
 * ledger ticker and the resolver's case-insensitive compare.
 */
export function setAccountEarmark(input: SetEarmarkInput): Earmark {
  const now = new Date().toISOString();
  const ticker = input.ticker.trim().toUpperCase();
  return getDb()
    .insert(earmarks)
    .values({
      userId: ownerId(),
      scope: "account",
      role: input.role ?? "reserved",
      bucketId: input.bucketId,
      ticker,
      amount: input.amount,
      currency: input.currency ?? null,
      purpose: input.purpose ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [earmarks.bucketId, earmarks.ticker, earmarks.scope],
      set: {
        role: input.role ?? "reserved",
        amount: input.amount,
        currency: input.currency ?? null,
        purpose: input.purpose ?? null,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}

/** Remove the `account`-scope earmark for a cash account (the whole balance is investable again). */
export function deleteAccountEarmark(bucketId: string, ticker: string): void {
  getDb()
    .delete(earmarks)
    .where(
      and(
        ownedBy(earmarks.userId),
        eq(earmarks.bucketId, bucketId),
        eq(earmarks.scope, "account"),
        eq(earmarks.ticker, ticker.trim().toUpperCase()),
      ),
    )
    .run();
}
