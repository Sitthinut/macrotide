import { NextResponse } from "next/server";
import { listSettings, setSetting } from "@/lib/db/queries/settings";

export async function GET() {
  const rows = listSettings();
  const map: Record<string, unknown> = {};
  for (const r of rows) map[r.key] = r.value;
  return NextResponse.json(map);
}

export async function PUT(req: Request) {
  const body = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "expected_object" }, { status: 400 });
  }
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    setSetting(key, value);
  }
  return NextResponse.json({ ok: true });
}
