// Tool-result shaping (#60) — compact, model-legible views of the heavy advisor
// reads. The AI SDK streams a tool's full `execute` return to the UI, but lets a
// tool expose a SEPARATE model-facing view via `toModelOutput`. read_portfolio /
// read_performance / find_funds / find_cheaper_alternatives return large
// structured objects (allocation + drift + concentration + headline, or a
// many-field fund list); the model only needs the few figures the answer turns
// on. These pure functions produce that lean view — keeping the headline facts
// (largest holding, drift direction, blended fee, the benchmark gap, each fund's
// TER) and dropping JSON scaffolding, redundant labels, and fields no answer
// uses (HHI, tone, project ids).
//
// Why it matters: for a small free-tier model fewer tool tokens means less
// context rot and a lower empty-turn dead-end rate (#21) — the
// highest-leverage token move per docs/explanation/inference-strategy.md §5.
// Anthropic's own concise-vs-detailed example cut a tool result ~66%.
//
// These are PURE (no server-only, no DB) so both lib/advisor/tools.ts and the
// committed eval (scripts/eval) attach the exact same shapers — one source of
// truth for what the model sees.

const num = (
  n: number | null | undefined,
  opts: { pct?: boolean; sign?: boolean } = {},
): string => {
  if (n == null) return "n/a";
  const s = opts.sign && n >= 0 ? "+" : "";
  return `${s}${n}${opts.pct ? "%" : ""}`;
};

// ─── read_portfolio ─────────────────────────────────────────────────────────
export interface PortfolioOutput {
  hasHoldings: boolean;
  totalValue: number;
  baseCurrency: string;
  targetModel: string | null;
  byClass: { label: string; pct: number }[];
  byRegion: { label: string; pct: number }[];
  drift: { ticker: string | null; label: string; current: number; target: number; drift: number }[];
  trackingGapPp: number | null;
  blendedTer: number;
  targetTer: number | null;
  concentration: {
    top: { ticker: string; label: string; pct: number } | null;
    top3Pct: number;
    hhi: number;
    holdingCount: number;
  };
  cashPct: number;
  headline: { tone: string; title: string; body: string };
  message: string;
}

export function portfolioModelText(o: PortfolioOutput): string {
  if (!o.hasHoldings) return o.message;
  const drift =
    o.drift
      .filter((d) => Math.abs(d.drift) >= 0.1)
      .map((d) => `${d.ticker ?? d.label} ${num(d.drift, { sign: true })}pp`)
      .join(", ") || "all sleeves on target";
  const top = o.concentration.top;
  return [
    `Portfolio ฿${o.totalValue.toLocaleString()} (${o.baseCurrency}); target model: ${o.targetModel ?? "none set"}.`,
    `By class: ${o.byClass.map((c) => `${c.label} ${c.pct}%`).join(", ")}.`,
    `By region: ${o.byRegion.map((c) => `${c.label} ${c.pct}%`).join(", ")}.`,
    `Drift vs target: ${drift}.`,
    `Blended fee ${o.blendedTer}%${o.targetTer != null ? ` (target ${o.targetTer}%)` : ""}${
      o.trackingGapPp != null ? `; tracking gap ${o.trackingGapPp}pp` : ""
    }.`,
    `Concentration: ${top ? `largest ${top.ticker} ${top.pct}%` : "n/a"}, top-3 ${o.concentration.top3Pct}%, ${o.concentration.holdingCount} holdings; cash ${o.cashPct}%.`,
    `${o.headline.title} — ${o.headline.body}`,
  ].join("\n");
}

// ─── read_performance ───────────────────────────────────────────────────────
export type PerformanceOutput =
  | { hasData: false; range: string; message: string }
  | {
      hasData: true;
      range: string;
      startDate: string;
      endDate: string;
      periodReturnPct: number | null;
      benchmarks: { label: string; returnPct: number | null; beating: boolean | null }[];
      message: string;
    };

export function performanceModelText(o: PerformanceOutput): string {
  if (!o.hasData) return o.message;
  const benches = o.benchmarks
    .map((b) => {
      const dir = b.beating == null ? "" : b.beating ? " (beating)" : " (trailing)";
      return `${b.label} ${num(b.returnPct, { pct: true, sign: true })}${dir}`;
    })
    .join(", ");
  return `Portfolio ${num(o.periodReturnPct, { pct: true, sign: true })} over ${o.range} (${o.startDate}→${o.endDate}). Benchmarks: ${benches}.`;
}

// ─── find_funds ─────────────────────────────────────────────────────────────
export interface FundsOutput {
  count: number;
  funds: {
    abbr: string;
    terLabel: string;
    isIndex: boolean;
    taxIncentiveType: string | null;
    investRegion: string | null;
    isFeederFund: boolean;
  }[];
  cheapestAbbr?: string | null;
  message: string;
}

function fundLine(f: FundsOutput["funds"][number]): string {
  const tags = [
    f.isIndex ? "index" : null,
    f.taxIncentiveType,
    f.investRegion,
    f.isFeederFund ? "feeder" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- ${f.abbr}: ${f.terLabel}${tags ? ` (${tags})` : ""}`;
}

export function fundsModelText(o: FundsOutput): string {
  if (!o.count) return o.message;
  const head = `${o.count} fund(s), cheapest first${o.cheapestAbbr ? ` (lowest TER: ${o.cheapestAbbr})` : ""}:`;
  return `${head}\n${o.funds.map(fundLine).join("\n")}`;
}

// ─── find_cheaper_alternatives ──────────────────────────────────────────────
export interface CheaperOutput {
  count: number;
  alternatives: {
    abbr: string;
    terLabel: string;
    isIndex: boolean;
    investRegion: string | null;
  }[];
  referenceAbbr?: string;
  message: string;
}

export function cheaperModelText(o: CheaperOutput): string {
  if (!o.count) return o.message;
  const lines = o.alternatives.map((f) => {
    const tags = [f.isIndex ? "index" : null, f.investRegion].filter(Boolean).join(", ");
    return `- ${f.abbr}: ${f.terLabel}${tags ? ` (${tags})` : ""}`;
  });
  return `Cheaper than ${o.referenceAbbr ?? "the held fund"} (${o.count}, cheapest first):\n${lines.join("\n")}`;
}

/**
 * Keyed shapers so callers (the real tools, the eval) attach the same view by
 * name. Each takes a tool's `execute` output and returns the compact model text.
 */
export const shapeForModel = {
  portfolio: portfolioModelText,
  performance: performanceModelText,
  funds: fundsModelText,
  cheaper: cheaperModelText,
} as const;
