import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import {
  createJournalEntry,
  JOURNAL_KINDS,
  type JournalKind,
  journalCreateBody,
  listJournalEntries,
} from "@/lib/db/queries/journal";

function parseKind(value: string | null): JournalKind | undefined {
  if (!value) return undefined;
  return (JOURNAL_KINDS as readonly string[]).includes(value) ? (value as JournalKind) : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");
  const filters = {
    kind: parseKind(url.searchParams.get("kind")),
    since: url.searchParams.get("since") ?? undefined,
    includeArchived: url.searchParams.get("includeArchived") === "true",
    limit: limitParam ? Number(limitParam) : undefined,
  };
  return withDb(() => NextResponse.json(listJournalEntries(filters)));
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = journalCreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;
  return withDb(() => NextResponse.json(createJournalEntry(input), { status: 201 }));
}
