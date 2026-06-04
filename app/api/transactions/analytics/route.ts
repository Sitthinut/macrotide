import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { listBuckets } from "@/lib/db/queries/buckets";
import {
  listTransactionsByBucket,
  listTransactionsForBuckets,
} from "@/lib/db/queries/transactions";
import type { CostBasisMethod } from "@/lib/portfolio/lots";
import { computeTransactionAnalytics } from "@/lib/portfolio/transaction-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/transactions/analytics?bucket=ID&method=average|fifo
//
// Realized gains, money-weighted return (IRR), and the cost-basis timeline —
// scoped to the caller's buckets. Holdings ARE the ledger's projection
// (ADR 0004), so there is no snapshot to reconcile against. The two-DB join
// (ledger in app.db, current NAV + FX from market.db) happens in the analytics
// orchestrator; the pure math stays DB-free.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") ?? undefined;
  const method: CostBasisMethod = url.searchParams.get("method") === "fifo" ? "fifo" : "average";

  return withDb(async () => {
    const owned = listBuckets();
    const ownedIds = owned.map((b) => b.id);

    let bucketIds: string[];
    if (bucket) {
      if (!ownedIds.includes(bucket))
        return NextResponse.json({ error: "bucket_not_found" }, { status: 404 });
      bucketIds = [bucket];
    } else {
      bucketIds = ownedIds;
    }

    const txns =
      bucketIds.length === 1
        ? listTransactionsByBucket(bucketIds[0])
        : listTransactionsForBuckets(bucketIds);

    const asOf = new Date().toISOString().slice(0, 10);
    const analytics = await computeTransactionAnalytics(txns, { method, asOf });
    return NextResponse.json({ ...analytics, transactionCount: txns.length });
  });
}
