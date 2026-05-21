import { NextResponse } from "next/server";
import { listFundQuotes } from "@/lib/db/queries/quotes";

export async function GET(req: Request) {
  const tickersParam = new URL(req.url).searchParams.get("tickers");
  const tickers = tickersParam ? tickersParam.split(",").filter(Boolean) : undefined;
  return NextResponse.json(listFundQuotes(tickers));
}
