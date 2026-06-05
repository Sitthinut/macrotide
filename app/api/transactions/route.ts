import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withDb } from "@/lib/api/with-db";
import { listBuckets } from "@/lib/db/queries/buckets";
import {
  insertTransactions,
  listTransactionsByBucket,
  listTransactionsForBuckets,
  type TransactionInsert,
} from "@/lib/db/queries/transactions";
import {
  isAnchorKind,
  LEDGER_KINDS,
  promoteAnchorKinds,
  signedAmount,
} from "@/lib/portfolio/txn-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One submitted transaction. `amount` is a POSITIVE magnitude — the server
// applies the sign from `kind` (see signedAmount), so a client can never send a
// sign that disagrees with the kind. This is a reject-gate, not a coercer: a
// row that violates the schema (bad kind, missing/negative amount on a cash
// event) is rejected, never silently fixed.
const txnInput = z
  .object({
    tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "tradeDate must be ISO (YYYY-MM-DD)"),
    // The unified ledger accepts trade deltas AND position anchors
    // (opening = Starting balance, snapshot = Restatement) — see ADR 0004.
    kind: z.enum(LEDGER_KINDS),
    ticker: z.string().trim().min(1).max(64),
    englishName: z.string().trim().max(200).optional(),
    units: z.number().finite().nonnegative().nullish(),
    pricePerUnit: z.number().finite().nonnegative().nullish(),
    // The asset's current/market price per unit (a Balance's "current price").
    // Trades derive their own from the execution price, so this is optional.
    marketPrice: z.number().finite().nonnegative().nullish(),
    amount: z.number().finite().nonnegative(),
    fee: z.number().finite().nonnegative().nullish(),
    quoteSource: z.string().trim().min(1).max(40).default("market"),
    tradeCurrency: z.string().trim().min(1).max(8).default("THB"),
    fxToThb: z.number().finite().positive().default(1),
    note: z.string().trim().max(500).optional(),
    source: z.string().trim().max(120).optional(),
  })
  // A cash-moving event must carry a positive amount; a split and the position
  // anchors (opening/snapshot) carry no cash, so their amount is zero.
  .refine((r) => r.kind === "split" || isAnchorKind(r.kind) || r.amount > 0, {
    message: "amount must be greater than zero for a cash transaction",
    path: ["amount"],
  });

const postBody = z.object({
  bucketId: z.string().trim().min(1),
  transactions: z.array(txnInput).min(1).max(2000),
});

export async function GET(req: Request) {
  const bucket = new URL(req.url).searchParams.get("bucket") ?? undefined;
  return withDb(() => {
    const owned = listBuckets();
    if (bucket) {
      if (!owned.some((b) => b.id === bucket)) return NextResponse.json([]);
      return NextResponse.json(listTransactionsByBucket(bucket));
    }
    return NextResponse.json(listTransactionsForBuckets(owned.map((b) => b.id)));
  });
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Expected a JSON body." },
      { status: 400 },
    );
  }

  const parsed = postBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { bucketId, transactions } = parsed.data;

  return withDb(() => {
    // Scope through the bucket: a user can only write to a bucket they own.
    if (!listBuckets().some((b) => b.id === bucketId)) {
      return NextResponse.json({ error: "bucket_not_found" }, { status: 404 });
    }

    // Auto-promote anchors (ADR 0004): the FIRST anchor for a fund is its
    // Starting balance (opening); any LATER anchor — a quarterly re-paste of
    // current holdings — becomes a Restatement (snapshot), which re-bases units
    // WITHOUT re-counting the money as a new contribution. So a user who just
    // re-pastes their portfolio every few months gets correct invested/return.
    const alreadyAnchored = listTransactionsByBucket(bucketId)
      .filter((t) => isAnchorKind(t.kind))
      .map((t) => t.ticker);
    const kinds = promoteAnchorKinds(alreadyAnchored, transactions);

    const importBatchId = randomUUID();
    const rows: TransactionInsert[] = transactions.map((t, i) => {
      const kind = kinds[i];
      return {
        bucketId,
        ticker: t.ticker,
        englishName: t.englishName ?? null,
        quoteSource: t.quoteSource,
        kind,
        tradeDate: t.tradeDate,
        units: t.units ?? null,
        pricePerUnit: t.pricePerUnit ?? null,
        // The asset's market price at this date. A Balance supplies its own
        // ("current price"); a trade's execution price doubles as its market point.
        marketPrice: t.marketPrice ?? (isAnchorKind(kind) ? null : (t.pricePerUnit ?? null)),
        // Authoritative sign applied here from the (possibly promoted) kind.
        amount: signedAmount(kind, t.amount),
        fee: t.fee ?? null,
        tradeCurrency: t.tradeCurrency,
        fxToThb: t.fxToThb,
        note: t.note ?? null,
        source: t.source ?? null,
        importBatchId,
      };
    });

    const inserted = insertTransactions(rows);
    return NextResponse.json({ inserted, importBatchId, count: inserted.length }, { status: 201 });
  });
}
