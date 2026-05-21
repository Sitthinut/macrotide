import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { deleteHolding, getHolding, updateHolding } from "@/lib/db/queries/holdings";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDb(() => {
    const row = getHolding(Number(id));
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  return withDb(() => {
    const row = updateHolding(Number(id), body);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDb(() => {
    deleteHolding(Number(id));
    return new NextResponse(null, { status: 204 });
  });
}
