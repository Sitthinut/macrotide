// Long-term memory queries. Bitemporal: updates add a new row and
// supersede; nothing is mutated in place. `valid_until IS NULL` is the
// active set. See docs/explanation/memory.md for the full design.
//
// Row scoping is fail-closed via {@link ownedBy} (reads the request user from
// context — see lib/db/queries/scope.ts), identical to journal/buckets/chat.
import "server-only";
import { and, desc, eq, gt, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import { getDb } from "../context";
import { memoryLinks, userPreferences } from "../schema";
import { ownedBy, ownerId } from "./scope";

export type Preference = typeof userPreferences.$inferSelect;
export type MemoryLink = typeof memoryLinks.$inferSelect;
export type PreferenceCategory = "profile" | "finance_context" | "response_style" | "fact";
export type PreferenceSource = "user_tool" | "advisor_tool" | "extracted";
export type PreferenceStatus = "active" | "pending";

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
// Includes both 'active' and 'pending' rows — `pending` is recall-only, gated
// out of injection by inject.ts, not hidden from listing/recall.
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
  // Short index injected into the hot block; the longer `body` is recall-only.
  summary?: string | null;
  body?: string | null;
  // 'pending' = captured but recall-only until the user confirms (used for
  // money-sensitive / weak-signal writes). Defaults to 'active'.
  status?: PreferenceStatus;
  sourceSessionId?: string | null;
  sourceTurnIds?: number[] | null;
  confidence?: number | null;
}

export function save(input: SaveInput): Preference {
  const now = new Date().toISOString();
  // Idempotency guard: if an identical note already exists in this category
  // (trimmed, case-insensitive), return it instead of inserting a duplicate.
  // TRULY-identical only — fuzzy/semantic dedup stays the model's job
  // (update_preference) and the extraction reconcile. This closes the
  // frozen-session blind spot: the injected memory block is frozen per session,
  // so within one chat the Advisor can't see a fact it already saved this
  // session and may re-save the exact same line. Without this, repeated
  // "remember X" in one session piles up identical rows.
  const norm = (s: string) => s.trim().toLowerCase();
  const dup = listActive(input.category).find((r) => norm(r.content) === norm(input.content));
  if (dup) return dup;
  return getDb()
    .insert(userPreferences)
    .values({
      userId: ownerId(),
      category: input.category,
      content: input.content,
      summary: input.summary ?? null,
      body: input.body ?? null,
      status: input.status ?? "active",
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

// Confirm a fact the user affirmed: bump last_confirmed_at (the anti-stale
// reinforcement signal — only ever set on affirmation, never on recall/inject)
// and promote a 'pending' capture to 'active' so it begins injecting next chat.
export function confirm(idOrSubstring: string): ResolveResult {
  const resolved = resolveActive(idOrSubstring);
  if (resolved.kind !== "match" || !resolved.row) return resolved;
  const now = new Date().toISOString();
  const updated = getDb()
    .update(userPreferences)
    .set({ lastConfirmedAt: now, status: "active", updatedAt: now })
    .where(eq(userPreferences.id, resolved.row.id))
    .returning()
    .get();
  return { kind: "match", row: updated };
}

// Update: atomic supersession. Old row gets valid_until = now; a new row
// is inserted with the new content, same category, same source attribution.
// Links pointing at the old row are re-pointed to the new row in the same txn
// so a bitemporal supersede never orphans them.
export interface UpdateOptions {
  summary?: string | null;
  body?: string | null;
}

export interface UpdateResult {
  kind: "match" | "none" | "ambiguous";
  oldRow?: Preference;
  newRow?: Preference;
  candidates?: Preference[];
}

export function update(
  idOrSubstring: string,
  newContent: string,
  opts: UpdateOptions = {},
): UpdateResult {
  const resolved = resolveActive(idOrSubstring);
  if (resolved.kind !== "match" || !resolved.row) {
    return { kind: resolved.kind, candidates: resolved.candidates };
  }
  return supersede(resolved.row, newContent, opts);
}

function supersede(old: Preference, newContent: string, opts: UpdateOptions = {}): UpdateResult {
  const now = new Date().toISOString();
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
        summary: opts.summary !== undefined ? opts.summary : old.summary,
        body: opts.body !== undefined ? opts.body : old.body,
        status: old.status,
        source: old.source,
        sourceSessionId: old.sourceSessionId,
        sourceTurnIds: old.sourceTurnIds,
        confidence: old.confidence,
        lastConfirmedAt: old.lastConfirmedAt,
        validFrom: now,
        validUntil: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    // Re-point links so the supersede doesn't orphan them.
    tx.update(memoryLinks).set({ fromId: newRow.id }).where(eq(memoryLinks.fromId, old.id)).run();
    tx.update(memoryLinks).set({ toId: newRow.id }).where(eq(memoryLinks.toId, old.id)).run();
    return { kind: "match", oldRow, newRow };
  });
}

// Supersede driven by auto-extraction. Trust-tiered guard (ADR 0006 §3/§6):
// an extracted fact may only supersede ANOTHER extracted row — never an
// explicit `user_tool`/`advisor_tool` note (lower-trust inference must not
// override what the user directly stated). Returns `rejected` when the target
// isn't an extraction-superseding candidate so the caller can fall back to a
// pending confirmation candidate instead.
export type ExtractionSupersedeResult =
  | { ok: true; result: UpdateResult }
  | { ok: false; rejected: "not_found" | "not_extracted" };

export function updateFromExtraction(
  targetId: number,
  newContent: string,
  confidence: number,
): ExtractionSupersedeResult {
  const target = getById(targetId);
  if (!target || target.validUntil !== null) return { ok: false, rejected: "not_found" };
  if (target.source !== "extracted") return { ok: false, rejected: "not_extracted" };
  const result = supersede({ ...target, confidence }, newContent);
  return { ok: true, result };
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

// ── Links ──────────────────────────────────────────────────────────────────
// The model proposes links (meaning); the DB enforces integrity. createLink
// only links rows the current user owns; listLinks is validity-aware — a link
// to a superseded/soft-deleted target is never surfaced.

export function createLink(fromId: number, toId: number, relation: string): MemoryLink | undefined {
  if (fromId === toId) return undefined;
  // Both endpoints must be live rows owned by the caller.
  if (!getById(fromId) || !getById(toId)) return undefined;
  return getDb()
    .insert(memoryLinks)
    .values({
      userId: ownerId(),
      fromId,
      toId,
      relation,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

export interface LinkedPreference {
  relation: string;
  preference: Preference;
}

// Links from `prefId` whose target is still active (valid_until IS NULL),
// scoped to the caller. A superseded/forgotten target drops out automatically.
export function listLinks(prefId: number): LinkedPreference[] {
  const rows = getDb()
    .select({ relation: memoryLinks.relation, preference: userPreferences })
    .from(memoryLinks)
    .innerJoin(userPreferences, eq(memoryLinks.toId, userPreferences.id))
    .where(
      and(
        eq(memoryLinks.fromId, prefId),
        ownedBy(memoryLinks.userId),
        isNull(userPreferences.validUntil),
      ),
    )
    .all();
  return rows.map((r) => ({ relation: r.relation, preference: r.preference }));
}

// Confidence decay for unconfirmed auto-extracted notes (ADR 0006 §6). Lowers
// the confidence of active, never-confirmed `extracted` rows older than
// `minAgeDays` by `step`, floored at `floor` — so an unconfirmed auto-fact
// drifts below the injection threshold over time (→ recall-only) instead of
// injecting forever. Explicit rows (confidence NULL) and confirmed rows are
// untouched. Confidence is metadata, so this updates in place (like confirm()).
export interface DecayOptions {
  step?: number;
  minAgeDays?: number;
  /** Lower bound; defaults to 0.3 (extract.MIN_SAVE_CONFIDENCE — stays recallable). */
  floor?: number;
}

export function decayExtracted(opts: DecayOptions = {}): number {
  const step = opts.step ?? 0.1;
  const floor = opts.floor ?? 0.3;
  const minAgeDays = opts.minAgeDays ?? 30;
  const cutoff = new Date(Date.now() - minAgeDays * 86_400_000).toISOString();
  const rows = getDb()
    .select()
    .from(userPreferences)
    .where(
      and(
        activeScope(),
        eq(userPreferences.source, "extracted"),
        isNotNull(userPreferences.confidence),
        isNull(userPreferences.lastConfirmedAt),
        lt(userPreferences.validFrom, cutoff),
      ),
    )
    .all();
  const now = new Date().toISOString();
  let decayed = 0;
  for (const row of rows) {
    const current = row.confidence ?? 0;
    const next = Math.max(floor, current - step);
    if (next < current) {
      getDb()
        .update(userPreferences)
        .set({ confidence: next, updatedAt: now })
        .where(eq(userPreferences.id, row.id))
        .run();
      decayed++;
    }
  }
  return decayed;
}

export const PREFERENCE_CATEGORIES = CATEGORIES;
