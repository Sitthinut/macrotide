import { NextResponse } from "next/server";
import { createBucket, listBuckets } from "@/lib/db/queries/buckets";

export async function GET() {
  return NextResponse.json(listBuckets());
}

export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json(createBucket(body), { status: 201 });
}
