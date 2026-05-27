// GET /api/funds/[projId] — fund detail including enrichment data.
//
// Returns the catalog row for one fund plus all available enrichment snapshots:
//   - performance  — all perf-type rows (fund/benchmark volatility + return,
//                    peer avg) from the latest factsheet
//   - assetAllocation — %NAV breakdown by asset type (latest factsheet)
//   - topHoldings  — top-5 holdings (latest factsheet)
//   - portfolio    — full quarterly portfolio (latest quarter, if ingested)
//   - portfolioAssetType — monthly asset-type summary (latest month, if ingested)
//   - feederMasterMap — master fund mapping if this is a feeder fund (or null)
//   - lookThroughHoldings — master fund's holdings for feeder look-through
//
// Any table that has not been populated (enrichment flags were off during last
// crawl) returns an empty array / null — callers should handle gracefully.
//
// This is an ADDITIVE route; the existing /api/funds (list/filter) is unchanged.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { getMarketDb } from "@/lib/db/context";
import { getFeederEnrichment } from "@/lib/db/queries/feeder-enrichment";
import { getFundEnrichment } from "@/lib/db/queries/fund-enrichment";
import { fundCatalog } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projId: string }> }) {
  const { projId } = await params;
  if (!projId) {
    return NextResponse.json({ error: "projId is required" }, { status: 400 });
  }

  return withDb(() => {
    const fund = getMarketDb()
      .select()
      .from(fundCatalog)
      .where(eq(fundCatalog.projId, projId))
      .get();

    if (!fund) {
      return NextResponse.json({ error: "Fund not found" }, { status: 404 });
    }

    const enrichment = getFundEnrichment(projId);
    const feederEnrichment = getFeederEnrichment(projId);

    return NextResponse.json({
      ...fund,
      ...enrichment,
      ...feederEnrichment,
    });
  });
}
