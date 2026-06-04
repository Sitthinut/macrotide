// GET /api/fund-classes — screener query that returns priceable SHARE CLASSES.
//
// Same filters as /api/funds, but each result is a share class (NAV/fees/tax are
// per class — decision D2b), annotated with its parent metadata + latest NAV.
// Backed by findShareClasses() in lib/db/queries/funds.ts. /api/funds (parent
// funds) is unchanged and still backs the advisor's find_funds tool.
//
// Query params (all optional): assetClass, query, limit (default 50, max 100),
// activeOnly ('0' to include closed), indexOnly ('1'), taxIncentive
// ('SSF'|'ThaiESG'|'RMF'), region ('foreign'|'domestic'|'mixed'),
// excludeFixedTerm ('0' to include), includeNonRetail ('1' to show
// institutional/insurance classes).

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import type { FindFundsFilter } from "@/lib/db/queries/funds";
import { findShareClasses } from "@/lib/db/queries/funds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const assetClass = url.searchParams.get("assetClass") ?? undefined;
  const query = url.searchParams.get("query") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const activeOnlyParam = url.searchParams.get("activeOnly");
  const indexOnlyParam = url.searchParams.get("indexOnly");
  const taxIncentiveParam = url.searchParams.get("taxIncentive");
  const regionParam = url.searchParams.get("region");
  const excludeFixedTermParam = url.searchParams.get("excludeFixedTerm");
  const includeNonRetail = url.searchParams.get("includeNonRetail") === "1";

  const limit = Math.min(limitParam ? Math.max(1, Number.parseInt(limitParam, 10) || 50) : 50, 100);
  const activeOnly = activeOnlyParam !== "0";
  const indexOnly = indexOnlyParam === "1" ? true : undefined;
  const excludeFixedTerm = excludeFixedTermParam !== "0";

  const taxIncentive =
    taxIncentiveParam === "SSF" || taxIncentiveParam === "ThaiESG" || taxIncentiveParam === "RMF"
      ? (taxIncentiveParam as FindFundsFilter["taxIncentive"])
      : undefined;

  const region =
    regionParam === "foreign" || regionParam === "domestic" || regionParam === "mixed"
      ? (regionParam as FindFundsFilter["region"])
      : undefined;

  return withDb(() => {
    const classes = findShareClasses({
      assetClass,
      query,
      activeOnly,
      limit,
      indexOnly,
      taxIncentive,
      region,
      excludeFixedTerm,
      includeNonRetail,
    });
    return NextResponse.json(classes);
  });
}
