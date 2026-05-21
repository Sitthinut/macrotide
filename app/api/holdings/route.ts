import { NextResponse } from "next/server";
import { createHolding, listHoldings } from "@/lib/db/queries/holdings";

export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get("bucket") ?? undefined;
  return NextResponse.json(listHoldings(bucket));
}

export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json(createHolding(body), { status: 201 });
}
