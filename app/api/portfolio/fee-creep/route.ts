// GET /api/portfolio/fee-creep — fee-creep analysis for the current portfolio.
//
// Returns the list of held funds that have a cheaper active peer in the same
// asset class. Each finding includes the held fund's name, current TER, up to
// three cheaper alternatives sorted cheapest-first, and the potential annual
// fee saving in percentage-points.
//
// An empty array is a valid (and happy-path) response — it means the user is
// already paying the lowest fees available for their exposure.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { computeFeeCreep } from "@/lib/portfolio/fee-creep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withDb(() => {
    const findings = computeFeeCreep();
    return NextResponse.json(findings);
  });
}
