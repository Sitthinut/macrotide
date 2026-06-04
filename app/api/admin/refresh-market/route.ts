// Internal admin endpoint: refreshes cached market data for every indicator in
// the catalog + every ticker present in `holdings`. Designed to be called from
// a cron job — but the scheduled path is now a systemd timer running
// `npm run jobs:refresh-market` (scripts/refresh-tracked-market.ts), which
// invokes the same `refreshTrackedMarket` job this route does. Both share the
// symbol-set logic so the route and the timer can never drift.
//
//   0 7 * * *  curl -s -X POST http://localhost:3000/api/admin/refresh-market
//
// In multi-user mode this should be gated behind a shared secret
// or admin-only auth; for single-user / localhost it's intentionally open.

import { NextResponse } from "next/server";
import { refreshTrackedMarket } from "@/lib/jobs/refresh-tracked-market";
import { INDICATOR_CATALOG } from "@/lib/market/indicators";

export async function POST() {
  const result = await refreshTrackedMarket();
  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    requested: result.requested,
    ok: result.ok,
    failed: result.failed,
    errors: result.errors,
  });
}

export async function GET() {
  return NextResponse.json({
    hint: "POST this endpoint to refresh market data (provider-chain cache).",
    indices: INDICATOR_CATALOG.map((i) => i.symbol),
  });
}
