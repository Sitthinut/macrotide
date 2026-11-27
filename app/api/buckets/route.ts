import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { createBucket, listBuckets } from "@/lib/db/queries/buckets";
import { bucketCreateSchema } from "@/lib/portfolio/bucket-input";

export async function GET() {
  return withDb(() => NextResponse.json(listBuckets()));
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = bucketCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // The id is opaque to the user (they only see the name), so the server mints
  // it. `brokerage` is a NOT NULL column: manual portfolios get a dash.
  const insert = {
    ...parsed.data,
    id: randomUUID(),
    brokerage: parsed.data.brokerage || "—",
  };
  return withDb(() => NextResponse.json(createBucket(insert), { status: 201 }));
}
