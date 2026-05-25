import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import { getCachedSeries } from "@/lib/market/cache";
import { INDICES } from "@/lib/market/indices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // withDb resolves the per-request DB context — without it getCachedSeries
  // reads the owner singleton, so a demo session never sees its own warmed
  // index cache (it falsely reports every index unavailable).
  return withDb(async () => {
    const results = await Promise.allSettled(
      INDICES.map(async (def) => {
        // Indices route through Yahoo (^SET.BK, ^GSPC, ^IXIC, ^N225, THB=X).
        const cached = await getCachedSeries("yahoo", def.symbol, "6mo", "1d");
        const series = cached.series;
        const latest = series.at(-1);
        const prev = series.length > 1 ? series[series.length - 2] : null;
        const d1Pct = latest && prev ? ((latest.close - prev.close) / prev.close) * 100 : 0;
        return {
          symbol: def.symbol,
          label: def.label,
          name: def.name,
          currency: undefined as string | undefined,
          price: latest?.close ?? null,
          d1Pct,
          series: series.map((p) => ({ d: p.date, v: p.close })),
          asOf: cached.quote?.asOf ?? null,
        };
      }),
    );

    const payload = results.map((r, i) => {
      if (r.status === "fulfilled") return { ok: true as const, ...r.value };
      return {
        ok: false as const,
        symbol: INDICES[i].symbol,
        label: INDICES[i].label,
        name: INDICES[i].name,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });

    return NextResponse.json(payload);
  });
}
