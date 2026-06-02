// Regenerate the committed demo NAV-history fixture (lib/mock/demo-history.ts).
//
// WHY THIS EXISTS
// ---------------
// In demo mode the Portfolio chart should show ~5 years of realistic history for
// both the portfolio line and the benchmark overlay — fully self-contained,
// offline at runtime, zero per-session provider quota. We get there by pulling
// ~5y of REAL public index data ONCE (here), deriving each demo fund's series
// from the index it tracks (fee + tracking transform), and COMMITTING the result
// as a typed fixture. The runtime demo read path reads the fixture — it never
// calls a provider. See lib/db/queries/series.ts + lib/market/benchmarks.ts.
//
// RESOLUTION & ENCODING
// ---------------------
// VARIABLE resolution keeps every UI range dense without a fat fixture: DAILY for
// the most recent ~15 months (so 1M/3M/6M/1Y show real trading-day detail) and
// WEEKLY before that (far-back density is invisible at "All" zoom). Points are
// stored as compact [date, value] tuples (one line each), not {date,value}
// objects, to keep the file small (well under 300 KB).
//
// USAGE
// -----
//   npm run refresh:demo-history
// (reads provider keys from .env.local via tsx --env-file; see package.json)
//
// CADENCE
// -------
// Re-run occasionally (e.g. quarterly) to roll the 5-year window forward so the
// demo's "now" stays recent. It is NOT on the live path — stale-by-a-quarter is
// fine. Could later ride the scheduler (background jobs) but does not need to.
//
// DATA SOURCES (real, public only — no real fund NAVs; see AGENTS.md):
//   - S&P 500 (^GSPC)              → FMP real index, ~5y daily
//   - Nasdaq / Nikkei / SET / ACWI → Twelve Data ETF proxy, ~5y daily (EODHD's
//                                     free index tier caps at ~1y; the proxy
//                                     tracks the index shape, all we rebase on)
//   - Gold (XAU/USD, GC=F)         → Twelve Data, ~5y daily
//   - Thai bonds / cash            → synthetic smooth series (no free real index
//                                     in the provider chain)

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fmpProvider } from "@/lib/market/providers/fmp";
import { twelveDataProvider } from "@/lib/market/providers/twelvedata";
import type { Provider } from "@/lib/market/providers/types";
import { PORTFOLIOS } from "@/lib/mock/data";
import { DEMO_INDICES, indexKeyForHolding, wobbleAmpForTer } from "@/lib/mock/demo-history-map";
import {
  buildHoldingSeries,
  downsampleVariable,
  type HistoryPoint,
} from "@/lib/mock/demo-history-transform";

// ~5y span; daily for the most recent ~15 months, weekly before that.
const MAX_DAYS = 5 * 366;
const DAILY_DAYS = 460; // ~15 months of trading days kept at daily resolution
const DEMO_QUOTE_SOURCE = "thai_mutual_fund";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pick the provider that yields the DEEPEST daily history for a fixture index. */
function providerFor(ticker: string): Provider {
  // FMP serves the real ^GSPC with full ~5y depth; everything else goes to the
  // Twelve Data ETF proxy (also ~5y; EODHD's free index tier only gives ~1y).
  return ticker === "^GSPC" ? fmpProvider : twelveDataProvider;
}

/** Fetch a real index's daily series, then variable-downsample it. */
async function fetchIndexSeries(ticker: string): Promise<HistoryPoint[]> {
  const provider = providerFor(ticker);
  const { series } = await provider.fetchSeries(ticker, "5y", "1d");
  const daily = series.map((p) => ({
    date: new Date(p.t * 1000).toISOString().slice(0, 10),
    value: Math.round(p.close * 100) / 100, // 2dp keeps index levels readable
  }));
  return downsampleVariable(daily, { maxDays: MAX_DAYS, dailyDays: DAILY_DAYS });
}

/** Build a smooth synthetic series at `annualPct`, anchored on a date calendar. */
function syntheticSeries(dates: string[], annualPct: number): HistoryPoint[] {
  if (dates.length === 0) return [];
  const t0 = Date.parse(`${dates[0]}T00:00:00Z`);
  return dates.map((date) => {
    const years = (Date.parse(`${date}T00:00:00Z`) - t0) / (365.25 * 86400_000);
    return { date, value: Math.round((1 + annualPct / 100) ** years * 1e6) / 1e6 };
  });
}

async function main() {
  console.log("Pulling real index history for the demo fixture…\n");

  // 1. Pull each REAL index (rate-limited; Twelve Data free tier ~8/min).
  const realDefs = DEMO_INDICES.filter((d) => d.ticker !== null);
  const indices: Record<string, HistoryPoint[]> = {};
  let calendar: string[] = [];
  for (const def of realDefs) {
    try {
      const s = await fetchIndexSeries(def.ticker as string);
      indices[def.indexKey] = s;
      if (s.length > calendar.length) calendar = s.map((p) => p.date);
      console.log(
        `  OK   ${def.indexKey.padEnd(8)} ${(def.ticker as string).padEnd(8)} ` +
          `${String(s.length).padStart(4)} pts  ${s[0]?.date} → ${s.at(-1)?.date}`,
      );
    } catch (err) {
      console.error(`  FAIL ${def.indexKey} (${def.ticker}): ${err}`);
      process.exitCode = 1;
      return;
    }
    await sleep(9000); // stay under Twelve Data's free-tier rate limit
  }

  // 2. Synthetic indices share the densest real calendar so every series lines up.
  for (const def of DEMO_INDICES) {
    if (def.ticker === null && def.syntheticAnnualPct !== undefined) {
      indices[def.indexKey] = syntheticSeries(calendar, def.syntheticAnnualPct);
      console.log(`  SYNTH ${def.indexKey.padEnd(8)} @ ${def.syntheticAnnualPct}%/yr`);
    }
  }

  // 3. Per-holding series, keyed by the runtime cache key `${quoteSource}:${ticker}`.
  const holdings: Record<string, HistoryPoint[]> = {};
  for (const portfolio of PORTFOLIOS) {
    for (const h of portfolio.holdings) {
      const key = `${DEMO_QUOTE_SOURCE}:${h.ticker}`;
      const indexKey = indexKeyForHolding(h.class, h.region);
      const index = indices[indexKey];
      if (!index || index.length === 0) {
        console.error(`  FAIL holding ${key}: no index series for "${indexKey}"`);
        process.exitCode = 1;
        return;
      }
      const terPct = h.ter ?? 0;
      holdings[key] = buildHoldingSeries({
        seedKey: key,
        index,
        terPct,
        currentValue: h.value,
        wobbleAmp: wobbleAmpForTer(terPct),
      });
    }
  }

  // 4. Emit the fixture module.
  const generatedAt = new Date().toISOString();
  const out = renderFixture({ generatedAt, calendar, indices, holdings });
  const dest = resolve(process.cwd(), "lib/mock/demo-history.ts");
  writeFileSync(dest, out, "utf8");
  const totalPts =
    Object.values(holdings).reduce((s, a) => s + a.length, 0) +
    Object.values(indices).reduce((s, a) => s + a.length, 0);
  console.log(
    `\nWrote ${dest}\n  ${Object.keys(holdings).length} holdings, ` +
      `${Object.keys(indices).length} indices, ${calendar.length} pts/series (densest), ` +
      `${totalPts} points total, ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB`,
  );
}

function renderFixture(data: {
  generatedAt: string;
  calendar: string[];
  indices: Record<string, HistoryPoint[]>;
  holdings: Record<string, HistoryPoint[]>;
}): string {
  const j = (v: unknown) => JSON.stringify(v);
  // Compact: one [date, value] tuple per line.
  const block = (rec: Record<string, HistoryPoint[]>) =>
    Object.entries(rec)
      .map(
        ([k, pts]) =>
          `  ${j(k)}: [\n${pts.map((p) => `    [${j(p.date)}, ${p.value}],`).join("\n")}\n  ],`,
      )
      .join("\n");

  return `// GENERATED FILE — do not edit by hand.
// Regenerate with: npm run refresh:demo-history (scripts/refresh-demo-history.ts).
//
// Self-contained ~5-year NAV history for DEMO MODE only. Built from REAL public
// index data (S&P 500 via FMP; Nasdaq/Nikkei/SET/ACWI/Gold via Twelve Data; Thai
// bonds/cash synthetic) transformed into per-holding series. The demo read path
// (lib/db/queries/series.ts, lib/market/benchmarks.ts) reads this so it never
// calls a provider. Owner mode is unaffected — it still reads market.db.
//
// Resolution: DAILY for the most recent ~15 months, WEEKLY before that.
// Encoding: compact [date, value] tuples (decode via lib/mock/demo-history-read).
//
// Generated: ${data.generatedAt}

/** A committed point: [ISO YYYY-MM-DD date, value]. */
export type EncodedPoint = [string, number];

/** Per-holding series (integer THB total value), keyed by \`\${quoteSource}:\${ticker}\`. */
export const DEMO_HOLDING_HISTORY: Record<string, EncodedPoint[]> = {
${block(data.holdings)}
};

/** Real (and synthetic) index series, keyed by fixture index key. */
export const DEMO_INDEX_HISTORY: Record<string, EncodedPoint[]> = {
${block(data.indices)}
};

/** When this fixture was generated (ISO). */
export const DEMO_HISTORY_GENERATED_AT = ${j(data.generatedAt)};
`;
}

void main();
