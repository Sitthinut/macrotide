// Per-user token accounting + tier gating.
//
// Two tables back this module (migration 0007):
//   - `account_tier`  one row per user; `tier` ∈ {'free','trusted'}. A user
//                     with NO row defaults to 'free' (the safe, zero-cost
//                     posture). Owner promotes via SQL.
//   - `usage`         one row per (user, UTC date) holding the running
//                     input/output token totals for that day. Resets naturally
//                     at UTC midnight because the date key rolls over.
//
// All functions take an explicit `userId` (like the memory queries) so they're
// trivially testable with the :memory: freshDb pattern. Callers in
// single-owner / demo mode (`getUserId()` === null) must NOT call these — the
// owner is never metered and demo is already isolated. See app/api/chat.
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../context";
import { accountTier, usage } from "../schema";

export type Tier = "free" | "trusted";

/** Default daily token budgets (input+output) — overridable via env. */
const DEFAULT_BUDGET_FREE = 20_000;
const DEFAULT_BUDGET_TRUSTED = 200_000;

/** Today's date as 'YYYY-MM-DD' in UTC — the partition key for `usage`. */
export function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Daily token budget (input+output) for a tier. Reads
 * `DAILY_TOKEN_BUDGET_FREE` / `DAILY_TOKEN_BUDGET_TRUSTED` with documented
 * defaults (20k / 200k). A malformed/negative env value falls back to the
 * default rather than disabling the cap.
 */
export function dailyTokenBudget(tier: Tier): number {
  const raw =
    tier === "trusted"
      ? process.env.DAILY_TOKEN_BUDGET_TRUSTED
      : process.env.DAILY_TOKEN_BUDGET_FREE;
  const fallback = tier === "trusted" ? DEFAULT_BUDGET_TRUSTED : DEFAULT_BUDGET_FREE;
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve a user's tier. No row → 'free' (zero-cost default; new accounts
 * start here until the owner promotes them via SQL).
 */
export function getTier(userId: string): Tier {
  const row = getDb()
    .select({ tier: accountTier.tier })
    .from(accountTier)
    .where(eq(accountTier.userId, userId))
    .get();
  return (row?.tier as Tier | undefined) ?? "free";
}

export interface TodayUsage {
  inputTokens: number;
  outputTokens: number;
  total: number;
}

/** Today's (UTC) token totals for a user. Zeroes when there's no row yet. */
export function getTodayUsage(userId: string, date: string = utcDate()): TodayUsage {
  const row = getDb()
    .select({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
    .from(usage)
    .where(and(eq(usage.userId, userId), eq(usage.date, date)))
    .get();
  const inputTokens = row?.inputTokens ?? 0;
  const outputTokens = row?.outputTokens ?? 0;
  return { inputTokens, outputTokens, total: inputTokens + outputTokens };
}

/**
 * Whether the user has already met-or-exceeded today's cap for their tier.
 * Checked BEFORE forwarding to OpenRouter so we never start a paid request
 * for someone over budget. `>=` is intentional: at exactly the cap, stop.
 */
export function isOverDailyCap(userId: string, tier: Tier, date: string = utcDate()): boolean {
  return getTodayUsage(userId, date).total >= dailyTokenBudget(tier);
}

/**
 * Add tokens to today's usage row (upsert + atomic increment). Called after a
 * stream finishes (the AI SDK `onFinish` usage callback). Negative/NaN inputs
 * are clamped to 0 so a missing provider usage field can never corrupt the row.
 */
export function recordUsage(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  date: string = utcDate(),
): void {
  const inc = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const input = inc(inputTokens);
  const output = inc(outputTokens);
  if (input === 0 && output === 0) return;
  getDb()
    .insert(usage)
    .values({ userId, date, inputTokens: input, outputTokens: output })
    .onConflictDoUpdate({
      target: [usage.userId, usage.date],
      set: {
        inputTokens: sql`${usage.inputTokens} + ${input}`,
        outputTokens: sql`${usage.outputTokens} + ${output}`,
      },
    })
    .run();
}
