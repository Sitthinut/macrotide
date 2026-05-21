// Internal admin endpoint: refreshes cached market data for INDICES + every
// ticker present in `holdings`. Designed to be called from a cron job:
//
//   0 7 * * *  curl -s -X POST http://localhost:3000/api/admin/refresh-market
//
// In multi-user mode (Phase 2.5) this should be gated behind a shared secret
// or admin-only auth; for single-user / localhost it's intentionally open.

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { holdings } from "@/lib/db/schema";
import { refreshSymbols } from "@/lib/market/cache";
import { INDICES } from "@/lib/market/indices";

export async function POST() {
  const heldTickers = db.selectDistinct({ ticker: holdings.ticker }).from(holdings).all();
  const indexSymbols = INDICES.map((i) => i.symbol);
  const heldSymbols = heldTickers
    .map((r) => r.ticker)
    // Yahoo doesn't carry Thai mutual fund NAVs — skip them so we don't hammer
    // the API with guaranteed-misses. Tickers starting with letters and
    // containing & or "-" are typically Thai mutual funds.
    .filter((t) => !/^[A-Z]+[-&]/i.test(t));

  const allSymbols = Array.from(new Set([...indexSymbols, ...heldSymbols]));
  const results = await refreshSymbols(allSymbols, "6mo");
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    requested: allSymbols.length,
    ok,
    failed: failed.length,
    errors: failed.map((f) => ({ symbol: f.symbol, error: f.error })),
  });
}

export async function GET() {
  return NextResponse.json({
    hint: "POST this endpoint to refresh market data (Yahoo Finance cache).",
    indices: INDICES.map((i) => i.symbol),
  });
}
