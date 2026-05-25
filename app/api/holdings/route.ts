import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { getBucket, listBuckets } from "@/lib/db/queries/buckets";
import { createHolding, listHoldings } from "@/lib/db/queries/holdings";

export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get("bucket") ?? undefined;
  return withDb(() => {
    if (bucket) {
      // Holdings have no user_id of their own — they're scoped through their
      // bucket. getBucket is user-scoped, so a bucket id from another user
      // resolves to undefined: return nothing rather than leak their holdings.
      if (!getBucket(bucket)) return NextResponse.json([]);
      return NextResponse.json(listHoldings(bucket));
    }
    // No bucket filter: scope to the caller's own buckets (listBuckets is
    // user-scoped) so an unfiltered list can't span other users' holdings.
    const mine = new Set(listBuckets().map((b) => b.id));
    return NextResponse.json(listHoldings().filter((h) => mine.has(h.bucketId)));
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  return withDb(() => {
    // Never insert against a bucket the caller doesn't own. getBucket is
    // user-scoped, so a foreign or missing bucket id is rejected here.
    const bucketId = typeof body?.bucketId === "string" ? body.bucketId.trim() : "";
    if (!bucketId || !getBucket(bucketId)) {
      return NextResponse.json({ error: "bucket_not_found" }, { status: 404 });
    }
    return NextResponse.json(createHolding(body), { status: 201 });
  });
}
