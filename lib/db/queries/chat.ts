import { and, asc, desc, eq, gt, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { getDb } from "../context";
import { chatMessages, chatThreads } from "../schema";

export type ChatThread = typeof chatThreads.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatRole = "user" | "assistant" | "tool" | "summary";

/**
 * Role marker for the context-compression summary row (Phase 5b #3). Stored in
 * the free-TEXT `chat_messages.role` column (no migration). These rows are an
 * internal model-input artifact: excluded from display ({@link listMessages}'s
 * `includeInternal` filter) and from FTS search. Keep in sync with
 * `SUMMARY_ROLE` in lib/ai/summarize.ts.
 */
export const SUMMARY_ROLE = "summary";
/**
 * Session lifecycle states (Phase 5b). Deletion is intentionally NOT a status —
 * it lives on `deletedAt` (30-day trash) so a thread can be e.g. archived AND
 * trashed independently.
 */
export type ThreadStatus = "active" | "idle" | "archived";

function randomId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * List active (non-deleted) threads, newest activity first. Pass
 * `includeDeleted: true` to bypass the soft-delete filter (admin / debug);
 * UI listings should leave it false and use {@link listDeletedThreads} for
 * the trash group.
 */
export function listThreads(opts: { includeDeleted?: boolean } = {}): ChatThread[] {
  const q = getDb().select().from(chatThreads).orderBy(desc(chatThreads.updatedAt));
  if (opts.includeDeleted) return q.all();
  return q.where(isNull(chatThreads.deletedAt)).all();
}

/**
 * List soft-deleted threads still within the restore window (default 30
 * days). Older trash isn't shown; a maintenance job purges it later. Order
 * is most-recently-deleted first.
 */
export function listDeletedThreads(daysAgo = 30): ChatThread[] {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60_000).toISOString();
  return getDb()
    .select()
    .from(chatThreads)
    .where(and(isNotNull(chatThreads.deletedAt), gt(chatThreads.deletedAt, cutoff)))
    .orderBy(desc(chatThreads.deletedAt))
    .all();
}

export function getThread(id: string): ChatThread | undefined {
  return getDb().select().from(chatThreads).where(eq(chatThreads.id, id)).get();
}

export function createThread(input: { title?: string | null } = {}): ChatThread {
  const now = new Date().toISOString();
  return getDb()
    .insert(chatThreads)
    .values({ id: randomId(), title: input.title ?? null, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function renameThread(id: string, title: string): ChatThread | undefined {
  return getDb()
    .update(chatThreads)
    .set({ title, updatedAt: new Date().toISOString() })
    .where(eq(chatThreads.id, id))
    .returning()
    .get();
}

/**
 * Move a thread to the trash. Row stays in the table with
 * `deletedAt = now()`; {@link listThreads} hides it,
 * {@link listDeletedThreads} surfaces it for the 30-day restore window.
 * Hard-removal is {@link purgeThread}.
 */
export function softDeleteThread(id: string): ChatThread | undefined {
  return getDb()
    .update(chatThreads)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(chatThreads.id, id))
    .returning()
    .get();
}

/** Undo {@link softDeleteThread} — clears `deleted_at`. */
export function restoreThread(id: string): ChatThread | undefined {
  return getDb()
    .update(chatThreads)
    .set({ deletedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(chatThreads.id, id))
    .returning()
    .get();
}

/**
 * Hard-delete a thread and its messages (cascade). Use only for "Delete
 * forever" from the trash; the regular delete button should call
 * {@link softDeleteThread}.
 */
export function purgeThread(id: string): void {
  // chat_messages cascade-delete via foreign key.
  getDb().delete(chatThreads).where(eq(chatThreads.id, id)).run();
}

/**
 * @deprecated Prefer {@link softDeleteThread} for user-initiated deletes or
 * {@link purgeThread} for hard removal from the trash.
 */
export function deleteThread(id: string): void {
  purgeThread(id);
}

/** Purge any soft-deleted threads older than `daysAgo` (default 30). */
export function purgeExpiredDeletedThreads(daysAgo = 30): number {
  const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60_000).toISOString();
  const rows = getDb()
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(and(isNotNull(chatThreads.deletedAt), lt(chatThreads.deletedAt, cutoff)))
    .all();
  for (const row of rows) {
    getDb().delete(chatThreads).where(eq(chatThreads.id, row.id)).run();
  }
  return rows.length;
}

// ───────────────────────────────────────────────────────────────────────────
// Session lifecycle (Phase 5b). `status` tracks active → idle → archived based
// on `updatedAt` age; the archive job (lib/jobs/archive-idle-sessions.ts) drives
// the transitions. Deletion stays orthogonal on `deletedAt`.
// ───────────────────────────────────────────────────────────────────────────

/** Mark a thread idle. No-op timestamp bump — does not touch `updatedAt`. */
export function markIdle(threadId: string): ChatThread | undefined {
  return getDb()
    .update(chatThreads)
    .set({ status: "idle" })
    .where(eq(chatThreads.id, threadId))
    .returning()
    .get();
}

/**
 * Archive a thread: set `status = 'archived'` and stamp `archivedAt`. Leaves
 * `updatedAt` untouched so idle-age computation reflects real activity, not
 * the archival write.
 */
export function archiveThread(threadId: string): ChatThread | undefined {
  return getDb()
    .update(chatThreads)
    .set({ status: "archived", archivedAt: new Date().toISOString() })
    .where(eq(chatThreads.id, threadId))
    .returning()
    .get();
}

/**
 * List threads in a given lifecycle status, newest activity first. Excludes
 * soft-deleted threads (trash is orthogonal to lifecycle).
 */
export function listByStatus(status: ThreadStatus): ChatThread[] {
  return getDb()
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.status, status), isNull(chatThreads.deletedAt)))
    .orderBy(desc(chatThreads.updatedAt))
    .all();
}

/**
 * Find `status = 'active'` threads whose last activity (`updatedAt`) is older
 * than `olderThanDays` days — i.e. archival candidates. The boundary is
 * inclusive: a thread updated exactly `olderThanDays` ago (or earlier) is
 * returned. Soft-deleted threads are excluded.
 */
export function findIdleThreads(olderThanDays: number): ChatThread[] {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60_000).toISOString();
  return getDb()
    .select()
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.status, "active"),
        isNull(chatThreads.deletedAt),
        lte(chatThreads.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(chatThreads.updatedAt))
    .all();
}

/**
 * List a thread's messages oldest-first. By default the internal
 * context-summary rows ({@link SUMMARY_ROLE}) are excluded — they are a
 * model-input artifact, not part of the visible conversation. Pass
 * `includeInternal: true` to get them too (e.g. for audit).
 */
export function listMessages(
  threadId: string,
  opts: { includeInternal?: boolean } = {},
): ChatMessage[] {
  const rows = getDb()
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
    .all();
  if (opts.includeInternal) return rows;
  return rows.filter((m) => m.role !== SUMMARY_ROLE);
}

/**
 * Store (or refresh) the context-compression summary for a thread (Phase 5b
 * #3). Migration-free: writes a {@link SUMMARY_ROLE} row into `chat_messages`.
 * Exactly one summary row is kept per thread — a prior one is replaced. This
 * NEVER touches user/assistant rows, so the persisted conversation is intact;
 * summarization only ever compresses the model's *input view*.
 */
export function upsertSummary(threadId: string, content: string): ChatMessage {
  const db = getDb();
  db.delete(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.role, SUMMARY_ROLE)))
    .run();
  return db
    .insert(chatMessages)
    .values({
      threadId,
      role: SUMMARY_ROLE,
      content,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** Latest stored context-compression summary for a thread, if any. */
export function getLatestSummary(threadId: string): ChatMessage | undefined {
  return getDb()
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.role, SUMMARY_ROLE)))
    .orderBy(desc(chatMessages.id))
    .get();
}

export function appendMessage(input: {
  threadId: string;
  role: ChatRole;
  content: string;
  toolCallId?: string | null;
}): ChatMessage {
  const now = new Date().toISOString();
  const row = getDb()
    .insert(chatMessages)
    .values({
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      toolCallId: input.toolCallId ?? null,
      createdAt: now,
    })
    .returning()
    .get();
  // Bump the thread's updatedAt so listThreads() orders by most-recent activity.
  getDb()
    .update(chatThreads)
    .set({ updatedAt: now })
    .where(eq(chatThreads.id, input.threadId))
    .run();
  return row;
}

export function setMessageFeedback(
  id: number,
  threadId: string,
  feedback: "up" | "down" | null,
): ChatMessage | undefined {
  return getDb()
    .update(chatMessages)
    .set({ feedback })
    .where(and(eq(chatMessages.id, id), eq(chatMessages.threadId, threadId)))
    .returning()
    .get();
}
