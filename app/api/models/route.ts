import { NextResponse } from "next/server";
import { createModelPortfolio, listModelPortfolios } from "@/lib/db/queries/models";

export async function GET() {
  return NextResponse.json(listModelPortfolios());
}

export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json(createModelPortfolio(body), { status: 201 });
}
