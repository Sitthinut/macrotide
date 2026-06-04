import { NextResponse } from "next/server";
import { z } from "zod";
import { withDb } from "@/lib/api/with-db";
import { listBuckets } from "@/lib/db/queries/buckets";
import { deleteTransaction, updateTransaction } from "@/lib/db/queries/transactions";
import { LEDGER_KINDS, signedAmount } from "@/lib/portfolio/txn-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH / DELETE a single ledger event — the inline-edit path for the Activity
// view (ADR 0004). Editing or deleting an event rebuilds the bucket's derived
// holdings. Scoped through the caller's buckets (transactions have no user_id).
//
// `amount` is derived server-side from the kind so the stored sign can't
// disagree with it: a snapshot moves no cash (0); a costed opening is the cost
// out (−units×price); a delta uses signedAmount(kind, magnitude). The client
// sends a POSITIVE magnitude, exactly like POST /api/transactions.
const patchBody = z
  .object({
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "tradeDate must be ISO (YYYY-MM-DD)"),
    kind: z.enum(LEDGER_KINDS),
    ticker: z.string().trim().min(1).max(64),
    englishName: z.string().trim().max(200).nullish(),
    units: z.number().finite().nonnegative().nullish(),
    pricePerUnit: z.number().finite().nonnegative().nullish(),
    amount: z.number().finite().nonnegative().default(0),
    fee: z.number().finite().nonnegative().nullish(),
    quoteSource: z.string().trim().min(1).max(40),
  })
  // A cash-moving delta needs a positive amount; anchors and splits may be 0.
  .refine(
    (r) => r.kind === "split" || r.kind === "opening" || r.kind === "snapshot" || r.amount > 0,
    { message: "amount must be greater than zero for a cash transaction", path: ["amount"] },
  );

/** Derive the stored signed THB amount from the kind (never trust a client sign). */
function deriveAmount(
  kind: string,
  magnitude: number,
  units: number | null,
  price: number | null,
): number {
  if (kind === "snapshot") return 0;
  if (kind === "opening") return price != null && units != null ? -(units * price) : 0;
  // deltas: buy/sell/dividend/fee/split/reinvest
  return signedAmount(kind as Parameters<typeof signedAmount>[0], magnitude);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const parsed = patchBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const t = parsed.data;

  return withDb(() => {
    const owned = listBuckets().map((b) => b.id);
    const units = t.units ?? null;
    const pricePerUnit = t.pricePerUnit ?? null;
    const updated = updateTransaction(numId, owned, {
      tradeDate: t.tradeDate,
      kind: t.kind,
      ticker: t.ticker,
      englishName: t.englishName ?? null,
      units,
      pricePerUnit,
      amount: deriveAmount(t.kind, t.amount, units, pricePerUnit),
      fee: t.fee ?? null,
      quoteSource: t.quoteSource,
    });
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }
  return withDb(() => {
    const owned = listBuckets().map((b) => b.id);
    const removed = deleteTransaction(numId, owned);
    if (removed === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  });
}
