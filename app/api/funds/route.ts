// GET /api/funds — fee-aware fund catalog query endpoint.
//
// Powers the Select UI: given optional filters (assetClass, fundType, query),
// returns funds from the SEC catalog sorted cheapest-first by TER. Backed by
// findFunds() in lib/db/queries/funds.ts, which annotates each fund with its
// current Total Fee and Expense figure.
//
// Query params (all optional):
//   assetClass  — 'equity' | 'bond' | 'alternative' | 'cash'
//   fundType    — substring match against SEC fund type
//   query       — free-text search against name / policy text
//   limit       — cap result count (default 50, max 100)
//   activeOnly  — '0' to include inactive/closed funds (default: active only)

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { findFunds } from "@/lib/db/queries/funds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assetClass = url.searchParams.get("assetClass") ?? undefined;
  const fundType = url.searchParams.get("fundType") ?? undefined;
  const query = url.searchParams.get("query") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const activeOnlyParam = url.searchParams.get("activeOnly");

  const limit = Math.min(limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : 50, 100);
  const activeOnly = activeOnlyParam !== "0";

  return withDb(() => {
    const funds = findFunds({ assetClass, fundType, query, activeOnly, limit });
    return NextResponse.json(funds);
  });
}
