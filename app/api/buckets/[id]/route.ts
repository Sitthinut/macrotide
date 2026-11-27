import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { deleteBucket, getBucket, updateBucket } from "@/lib/db/queries/buckets";
import { bucketUpdateSchema, MAX_PORTFOLIO_NAME_LENGTH } from "@/lib/portfolio/bucket-input";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDb(() => {
    const row = getBucket(id);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = bucketUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // `brokerage` is NOT NULL; a null or empty one leaves it as it is.
  const { brokerage, ...rest } = parsed.data;
  const patch = brokerage ? { ...rest, brokerage } : rest;
  return withDb(() => {
    const name = patch.name;
    if (name && name.length > MAX_PORTFOLIO_NAME_LENGTH && name !== getBucket(id)?.name) {
      return NextResponse.json(
        {
          error: "validation_failed",
          message: `A portfolio name can be at most ${MAX_PORTFOLIO_NAME_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }
    const row = updateBucket(id, patch);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withDb(() => {
    deleteBucket(id);
    return new NextResponse(null, { status: 204 });
  });
}
