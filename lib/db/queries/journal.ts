import { and, desc, eq, gte, isNull, type SQL } from "drizzle-orm";
import { db } from "../client";
import { journalEntries } from "../schema";

export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalEntryInsert = typeof journalEntries.$inferInsert;
export type JournalEntryUpdate = Partial<Omit<JournalEntryInsert, "id" | "createdAt">>;

export type JournalKind = "note" | "decision" | "question" | "reading";

export interface JournalFilters {
  kind?: JournalKind;
  since?: string; // ISO date string
  includeArchived?: boolean;
  limit?: number;
}

export function listJournalEntries(filters: JournalFilters = {}): JournalEntry[] {
  const where: SQL[] = [];
  if (filters.kind) where.push(eq(journalEntries.kind, filters.kind));
  if (filters.since) where.push(gte(journalEntries.createdAt, filters.since));
  if (!filters.includeArchived) where.push(isNull(journalEntries.archivedAt));

  const q = db
    .select()
    .from(journalEntries)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(journalEntries.pinned), desc(journalEntries.createdAt));

  return (filters.limit ? q.limit(filters.limit) : q).all();
}

export function getJournalEntry(id: number): JournalEntry | undefined {
  return db.select().from(journalEntries).where(eq(journalEntries.id, id)).get();
}

export function createJournalEntry(input: Omit<JournalEntryInsert, "createdAt">): JournalEntry {
  return db
    .insert(journalEntries)
    .values({ ...input, createdAt: new Date().toISOString() })
    .returning()
    .get();
}

export function updateJournalEntry(
  id: number,
  patch: JournalEntryUpdate,
): JournalEntry | undefined {
  return db.update(journalEntries).set(patch).where(eq(journalEntries.id, id)).returning().get();
}

export function archiveJournalEntry(id: number): void {
  db.update(journalEntries)
    .set({ archivedAt: new Date().toISOString() })
    .where(eq(journalEntries.id, id))
    .run();
}

export function deleteJournalEntry(id: number): void {
  db.delete(journalEntries).where(eq(journalEntries.id, id)).run();
}
