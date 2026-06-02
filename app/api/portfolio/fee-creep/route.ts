// GET /api/portfolio/fee-creep — fee-creep analysis for the current portfolio.
//
// Returns the list of held funds that have a cheaper active peer with the same
// exposure (asset class + geographic region). Each finding includes the held
// fund's name, current TER, up to three cheaper alternatives sorted
// cheapest-first, and the potential annual fee saving in percentage-points.
//
// An empty array is a valid (and happy-path) response — it means the user is
// already paying the lowest fees available for their exposure.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { listSuppressed } from "@/lib/db/queries/action-items";
import { feeCreepKey } from "@/lib/portfolio/action-item-key";
import { computeFeeCreep } from "@/lib/portfolio/fee-creep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withDb(() => {
    const findings = computeFeeCreep();
    // Drop findings the user has dismissed, is currently snoozing, or has
    // disagreed with. Suppression is applied server-side so it's authoritative —
    // the client never has to know the rules. Expired snoozes self-heal in
    // listSuppressed (they aren't returned), so the finding reappears.
    const suppressed = new Set(listSuppressed().map((s) => s.itemKey));
    const visible = findings.filter((f) => !suppressed.has(feeCreepKey(f.heldTicker)));
    return NextResponse.json(visible);
  });
}
