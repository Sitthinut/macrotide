// Long-term memory queries. Bitemporal: updates add a new row and
// supersede; nothing is mutated in place. `valid_until IS NULL` is the
// active set. See docs/explanation/memory.md for the full design.
//
// Row scoping is fail-closed via {@link ownedBy} (reads the request user from
// context — see lib/db/queries/scope.ts), identical to journal/buckets/chat.
import "server-only";
import { and, desc, eq, gt, isNull, like, or, sql } from "drizzle-orm";
import { getDb } from "../context";
import { userPreferences } from "../schema";
import { ownedBy, ownerId } from "./scope";

export type Preference = typeof userPreferences.$inferSelect;
export type PreferenceCategory = "profile" | "finance_context" | "response_style" | "fact";
export type PreferenceSource = "user_tool" | "advisor_tool" | "extracted";

const CATEGORIES: readonly PreferenceCategory[] = [
  "profile",
  "finance_context",
  "response_style",
  "fact",
] as const;

export function isCategory(value: string): value is PreferenceCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

// The active set for the current request's user: their own rows (or the
// single-owner NULL set when no user is in context), not yet superseded.
function activeScope() {
  return and(ownedBy(userPreferences.userId), isNull(userPreferences.validUntil));
}

export function listActive(category?: PreferenceCategory): Preference[] {
  const conds = [activeScope()];
  if (category) conds.push(eq(userPreferences.category, category));
  return getDb()
    .select()
    .from(userPreferences)
    .where(and(...conds))
    .orderBy(userPreferences.category, userPreferences.id)
    .all();
}

/**
 * Cold-recall complement to the always-on injection: find ACTIVE preferences
 * relevant to a free-text query. Tokenizes the query on Unicode letters/numbers
 * and returns active rows whose content matches ANY token (case-insensitive
 * substring — same matching style as resolveActive's substring path, but OR'd
 * across tokens so recall is generous). Ordered by (category, id) like
 * listActive; empty/blank queries return []. Optionally capped by `limit`.
 */
export function recall(query: string, limit = 20): Preference[] {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return [];
  const tokenMatches = tokens.map((t) => like(userPreferences.content, `%${t}%`));
  const rows = getDb()
    .select()
    .from(userPreferences)
    .where(and(activeScope(), or(...tokenMatches)))
    .orderBy(userPreferences.category, userPreferences.id)
    .all();
  return rows.slice(0, limit);
}

export function listRecentlyForgotten(days = 30): Preference[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return getDb()
    .select()
    .from(userPreferences)
    .where(and(ownedBy(userPreferences.userId), gt(userPreferences.validUntil, cutoff)))
    .orderBy(desc(userPreferences.validUntil))
    .all();
}

export function getById(id: number): Preference | undefined {
  return getDb()
    .select()
    .from(userPreferences)
    .where(and(eq(userPreferences.id, id), ownedBy(userPreferences.userId)))
    .get();
}

export interface SaveInput {
  category: PreferenceCategory;
  content: string;
  source: PreferenceSource;
  sourceSessionId?: string | null;
  sourceTurnIds?: number[] | null;
  confidence?: number | null;
}

export function save(input: SaveInput): Preference {
  const now = new Date().toISOString();
  return getDb()
    .insert(userPreferences)
    .values({
      userId: ownerId(),
      category: input.category,
      content: input.content,
      source: input.source,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceTurnIds: input.sourceTurnIds ?? null,
      confidence: input.confidence ?? null,
      validFrom: now,
      validUntil: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export interface ResolveResult {
  kind: "match" | "none" | "ambiguous";
  row?: Preference;
  candidates?: Preference[];
}

// Resolve an `id_or_substring` reference against the active set. Tries
// numeric id first, then case-insensitive substring on content. Exactly
// one active row must match for `kind: 'match'`.
export function resolveActive(idOrSubstring: string): ResolveResult {
  const asInt = Number.parseInt(idOrSubstring, 10);
  if (Number.isFinite(asInt) && String(asInt) === idOrSubstring.trim()) {
    const row = getDb()
      .select()
      .from(userPreferences)
      .where(and(activeScope(), eq(userPreferences.id, asInt)))
      .get();
    return row ? { kind: "match", row } : { kind: "none" };
  }
  const pattern = `%${idOrSubstring}%`;
  const matches = getDb()
    .select()
    .from(userPreferences)
    .where(and(activeScope(), like(userPreferences.content, pattern)))
    .all();
  if (matches.length === 0) return { kind: "none" };
  if (matches.length === 1) return { kind: "match", row: matches[0] };
  return { kind: "ambiguous", candidates: matches };
}

// Forget: soft-delete via valid_until = now. Row stays for audit.
export function forget(idOrSubstring: string): ResolveResult {
  const resolved = resolveActive(idOrSubstring);
  if (resolved.kind !== "match" || !resolved.row) return resolved;
  const now = new Date().toISOString();
  const updated = getDb()
    .update(userPreferences)
    .set({ validUntil: now, updatedAt: now })
    .where(eq(userPreferences.id, resolved.row.id))
    .returning()
    .get();
  return { kind: "match", row: updated };
}

// Update: atomic supersession. Old row gets valid_until = now; a new row
// is inserted with the new content, same category, same source attribution.
export interface UpdateResult {
  kind: "match" | "none" | "ambiguous";
  oldRow?: Preference;
  newRow?: Preference;
  candidates?: Preference[];
}

export function update(idOrSubstring: string, newContent: string): UpdateResult {
  const resolved = resolveActive(idOrSubstring);
  if (resolved.kind !== "match" || !resolved.row) {
    return { kind: resolved.kind, candidates: resolved.candidates };
  }
  const now = new Date().toISOString();
  const old = resolved.row;
  return getDb().transaction((tx) => {
    const oldRow = tx
      .update(userPreferences)
      .set({ validUntil: now, updatedAt: now })
      .where(eq(userPreferences.id, old.id))
      .returning()
      .get();
    const newRow = tx
      .insert(userPreferences)
      .values({
        userId: old.userId,
        category: old.category,
        content: newContent,
        source: old.source,
        sourceSessionId: old.sourceSessionId,
        sourceTurnIds: old.sourceTurnIds,
        confidence: old.confidence,
        validFrom: now,
        validUntil: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return { kind: "match", oldRow, newRow };
  });
}

// Restore a recently-forgotten row by clearing valid_until. Scoped to the
// current user so one account can't restore another's forgotten row.
export function restore(id: number): Preference | undefined {
  const now = new Date().toISOString();
  return getDb()
    .update(userPreferences)
    .set({ validUntil: null, updatedAt: now })
    .where(
      and(
        eq(userPreferences.id, id),
        ownedBy(userPreferences.userId),
        sql`${userPreferences.validUntil} IS NOT NULL`,
      ),
    )
    .returning()
    .get();
}

export const PREFERENCE_CATEGORIES = CATEGORIES;
