import "server-only";
import { and, desc, eq, gte, isNull, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../context";
import { journalEntries } from "../schema";
import { ownedBy, ownerId, pickEditable } from "./scope";

export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalEntryInsert = typeof journalEntries.$inferInsert;

export const JOURNAL_KINDS = ["note", "decision", "question", "reading"] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

/** The columns a journal update may change. Ownership and timestamps are server-managed. */
export const JOURNAL_EDITABLE_FIELDS = [
  "kind",
  "title",
  "body",
  "url",
  "source",
  "tags",
  "pinned",
] as const;
export type JournalEntryUpdate = Partial<
  Pick<JournalEntryInsert, (typeof JOURNAL_EDITABLE_FIELDS)[number]>
>;
export type JournalEntryCreate = Omit<JournalEntryInsert, "id" | "userId" | "createdAt">;

/** Request body for creating an entry; unknown keys are dropped. */
export const journalCreateBody = z.object({
  kind: z.enum(JOURNAL_KINDS),
  title: z.string().nullish(),
  body: z.string().nullish(),
  url: z.string().nullish(),
  source: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  pinned: z.boolean().optional(),
});

/** Request body for updating an entry: any subset of the editable fields. */
export const journalUpdateBody = journalCreateBody.partial();

export interface JournalFilters {
  kind?: JournalKind;
  since?: string; // ISO date string
  includeArchived?: boolean;
  limit?: number;
}

export function listJournalEntries(filters: JournalFilters = {}): JournalEntry[] {
  const where: SQL[] = [ownedBy(journalEntries.userId)];
  if (filters.kind) where.push(eq(journalEntries.kind, filters.kind));
  if (filters.since) where.push(gte(journalEntries.createdAt, filters.since));
  if (!filters.includeArchived) where.push(isNull(journalEntries.archivedAt));

  const q = getDb()
    .select()
    .from(journalEntries)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(journalEntries.pinned), desc(journalEntries.createdAt));

  return (filters.limit ? q.limit(filters.limit) : q).all();
}

export function getJournalEntry(id: number): JournalEntry | undefined {
  return getDb()
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), ownedBy(journalEntries.userId)))
    .get();
}

export function createJournalEntry(input: JournalEntryCreate): JournalEntry {
  return (
    getDb()
      .insert(journalEntries)
      // Stamp ownership AFTER the input spread so a client-supplied `userId` can't
      // override the server's owner scoping.
      .values({ ...input, userId: ownerId(), createdAt: new Date().toISOString() })
      .returning()
      .get()
  );
}

export function updateJournalEntry(
  id: number,
  patch: JournalEntryUpdate,
): JournalEntry | undefined {
  const set = pickEditable(patch, JOURNAL_EDITABLE_FIELDS);
  if (Object.keys(set).length === 0) return getJournalEntry(id);
  return getDb()
    .update(journalEntries)
    .set(set)
    .where(and(eq(journalEntries.id, id), ownedBy(journalEntries.userId)))
    .returning()
    .get();
}

export function archiveJournalEntry(id: number): void {
  getDb()
    .update(journalEntries)
    .set({ archivedAt: new Date().toISOString() })
    .where(and(eq(journalEntries.id, id), ownedBy(journalEntries.userId)))
    .run();
}

export function deleteJournalEntry(id: number): void {
  getDb()
    .delete(journalEntries)
    .where(and(eq(journalEntries.id, id), ownedBy(journalEntries.userId)))
    .run();
}
