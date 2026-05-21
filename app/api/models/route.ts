import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { createModelPortfolio, listModelPortfolios } from "@/lib/db/queries/models";

export async function GET() {
  return withDb(() => NextResponse.json(listModelPortfolios()));
}

export async function POST(req: Request) {
  const body = await req.json();
  return withDb(() => NextResponse.json(createModelPortfolio(body), { status: 201 }));
}
