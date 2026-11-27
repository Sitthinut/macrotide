import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import {
  archiveJournalEntry,
  deleteJournalEntry,
  getJournalEntry,
  journalUpdateBody,
  updateJournalEntry,
} from "@/lib/db/queries/journal";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDb(() => {
    const row = getJournalEntry(Number(id));
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = journalUpdateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const patch = parsed.data;
  return withDb(() => {
    const row = updateJournalEntry(Number(id), patch);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const archive = new URL(req.url).searchParams.get("archive") === "true";
  return withDb(() => {
    if (archive) {
      archiveJournalEntry(Number(id));
    } else {
      deleteJournalEntry(Number(id));
    }
    return new NextResponse(null, { status: 204 });
  });
}
