// Owner-only admin queries: list every user with their tier + today's usage,
// and set a user's tier. These bypass per-user row scoping on purpose — the
// caller MUST have already verified owner status (see app/api/admin/users).
import { eq, sql } from "drizzle-orm";
import { getDb } from "../context";
import { accountTier, usage, user } from "../schema";
import { type Tier, utcDate } from "./usage";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  tier: Tier;
  createdAt: string; // ISO-8601
  usageToday: number; // input+output tokens used today (UTC)
}

/**
 * Every user with their tier (defaulting to 'free' when no account_tier row
 * exists) and today's total token usage. One query with LEFT JOINs so a user
 * missing a tier or usage row still appears.
 */
export function listUsers(date: string = utcDate()): AdminUserRow[] {
  const rows = getDb()
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
      tier: accountTier.tier,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
    .from(user)
    .leftJoin(accountTier, eq(accountTier.userId, user.id))
    .leftJoin(usage, sql`${usage.userId} = ${user.id} AND ${usage.date} = ${date}`)
    .orderBy(user.createdAt)
    .all();

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    tier: (r.tier as Tier | null) ?? "free",
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(r.createdAt).toISOString(),
    usageToday: (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
  }));
}

/**
 * Set a user's tier (upsert). Returns false if the user does not exist (so the
 * caller can 404 rather than silently inserting an orphan account_tier row that
 * would violate the FK anyway).
 */
export function setUserTier(userId: string, tier: Tier): boolean {
  const exists = getDb().select({ id: user.id }).from(user).where(eq(user.id, userId)).get();
  if (!exists) return false;

  getDb()
    .insert(accountTier)
    .values({ userId, tier, grantedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: accountTier.userId, set: { tier } })
    .run();
  return true;
}
