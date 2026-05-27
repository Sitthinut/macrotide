// Internal admin endpoint: refreshes cached market data for every indicator in
// the catalog + every ticker present in `holdings`. Designed to be called from
// a cron job:
//
//   0 7 * * *  curl -s -X POST http://localhost:3000/api/admin/refresh-market
//
// In multi-user mode this should be gated behind a shared secret
// or admin-only auth; for single-user / localhost it's intentionally open.

import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { holdings } from "@/lib/db/schema";
import { refreshSymbols } from "@/lib/market/cache";
import { INDICATOR_CATALOG } from "@/lib/market/indicators";

export async function POST() {
  // Warm every catalog indicator (so any user's selection is cached) — all
  // route through the "yahoo" provider chain.
  const indexRefs = INDICATOR_CATALOG.map((i) => ({ source: "yahoo", ticker: i.symbol }));
  // Every held position is refreshed via its own provider — holdings now
  // carry quote_source explicitly so we don't need to guess by ticker shape.
  const heldRows = db
    .selectDistinct({ source: holdings.quoteSource, ticker: holdings.ticker })
    .from(holdings)
    .all();
  const heldRefs = heldRows.map((r) => ({ source: r.source, ticker: r.ticker }));

  const seen = new Set<string>();
  const allRefs = [...indexRefs, ...heldRefs].filter((r) => {
    const k = `${r.source}:${r.ticker}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const results = await refreshSymbols(allRefs, "6mo");
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    requested: allRefs.length,
    ok,
    failed: failed.length,
    errors: failed.map((f) => ({ source: f.source, ticker: f.ticker, error: f.error })),
  });
}

export async function GET() {
  return NextResponse.json({
    hint: "POST this endpoint to refresh market data (provider-chain cache).",
    indices: INDICATOR_CATALOG.map((i) => i.symbol),
  });
}
