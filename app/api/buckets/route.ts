import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { createBucket, listBuckets } from "@/lib/db/queries/buckets";

export async function GET() {
  return withDb(() => NextResponse.json(listBuckets()));
}

export async function POST(req: Request) {
  const body = await req.json();
  return withDb(() => NextResponse.json(createBucket(body), { status: 201 }));
}
