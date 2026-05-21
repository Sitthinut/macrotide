import { NextResponse } from "next/server";
import {
  deleteModelPortfolio,
  getModelPortfolio,
  updateModelPortfolio,
} from "@/lib/db/queries/models";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getModelPortfolio(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const row = updateModelPortfolio(id, body);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  deleteModelPortfolio(id);
  return new NextResponse(null, { status: 204 });
}
