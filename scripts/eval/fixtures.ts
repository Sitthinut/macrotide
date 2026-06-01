// Synthetic data + tool surface for the Advisor eval (scripts/eval).
//
// Hermetic by design: the real createAdvisorTools (lib/advisor/tools.ts) reads
// the live SQLite DB (opened eagerly by lib/db/client.ts), so the eval cannot
// reuse it without a DB and real fund codes. Instead this module mirrors the
// real tool SURFACE — same names, same input schemas, the same fee-first /
// index-first steering in the descriptions — but every execute returns fixed
// SYNTHETIC data using EXAMPLE-FUND-* codes only. The numbers are chosen to make
// answers checkable (a clear biggest holding, an unambiguous drift, a benchmark
// the portfolio beats and one it trails). Keep this in sync with the real tool
// surface when that changes; the committed guard test (tests/eval) checks the
// surface shape.
import { tool } from "ai";
import { z } from "zod";

// ─── Synthetic portfolio ────────────────────────────────────────────────────
// ฿1,000,000 across three EXAMPLE funds + 10% cash. Target model is 40/20/30/10
// (global equity / Thai equity / global bond / cash), so the portfolio is
// +10pp global equity, +5pp Thai equity, −15pp bond — an unambiguous "trim
// equity, add bonds" rebalance. EXAMPLE-FUND-A is the clear biggest holding.
export const PORTFOLIO = {
  ok: true as const,
  hasHoldings: true,
  totalValue: 1_000_000,
  baseCurrency: "THB",
  targetModel: "Bogle 3-Fund (Global)",
  byClass: [
    { label: "Equity", pct: 75 },
    { label: "Bond", pct: 15 },
    { label: "Cash", pct: 10 },
  ],
  byRegion: [
    { label: "Global ex-Thailand", pct: 50 },
    { label: "Thailand", pct: 25 },
    { label: "Bond (Global)", pct: 15 },
    { label: "Cash", pct: 10 },
  ],
  drift: [
    { ticker: "EXAMPLE-FUND-A", label: "Global Equity", current: 50, target: 40, drift: 10 },
    { ticker: "EXAMPLE-FUND-B", label: "Thai Equity", current: 25, target: 20, drift: 5 },
    { ticker: "EXAMPLE-FUND-C", label: "Global Bond", current: 15, target: 30, drift: -15 },
    { ticker: "CASH", label: "Cash", current: 10, target: 10, drift: 0 },
  ],
  trackingGapPp: 6.2,
  blendedTer: 0.585,
  targetTer: 0.3,
  concentration: {
    top: { ticker: "EXAMPLE-FUND-A", label: "Global Equity", pct: 50 },
    top3Pct: 90,
    hhi: 0.35,
    holdingCount: 3,
  },
  cashPct: 10,
  headline: {
    tone: "warn" as const,
    title: "Off target — bonds underweight",
    body: "Global equity is 10pp over target and bonds are 15pp under; consider rebalancing.",
  },
  message: "Read 3 holding(s) across 2 bucket(s); total ฿1,000,000.",
};

// ─── Synthetic performance ──────────────────────────────────────────────────
// +7.1% over 6mo — BEATS the SET (+4.3%) but TRAILS the S&P 500 (+9.8%). The
// split lets a question about "beating my index" be answered with nuance.
export const PERFORMANCE = {
  ok: true as const,
  hasData: true,
  range: "6mo" as const,
  startDate: "2025-11-30",
  endDate: "2026-05-30",
  startValue: 933_700,
  endValue: 1_000_000,
  periodReturnPct: 7.1,
  asOf: "2026-05-30",
  benchmarks: [
    { key: "set", label: "SET Index", returnPct: 4.3, beating: true },
    { key: "sp500", label: "S&P 500", returnPct: 9.8, beating: false },
  ],
  message:
    "Portfolio +7.1% over 6mo (2025-11-30→2026-05-30). Benchmarks: SET Index +4.3%, S&P 500 +9.8%.",
};

// ─── Synthetic fund catalog (for find_funds / find_cheaper_alternatives) ─────
// A cheaper global-equity index alternative to EXAMPLE-FUND-A, plus an SSF and
// an RMF wrapper so the "SSF vs RMF" question has real options to weigh.
interface CatalogFund {
  projId: string;
  abbr: string;
  englishName: string;
  amc: string;
  assetClass: "equity" | "bond" | "alternative" | "cash";
  terPct: number;
  managementStyle: "PN" | "AA";
  taxIncentiveType: "SSF" | "RMF" | "ThaiESG" | null;
  investRegion: "foreign" | "domestic" | "mixed";
  isFeederFund: boolean;
  feederMasterFund: string | null;
}
const CATALOG: CatalogFund[] = [
  {
    projId: "EXMP_D",
    abbr: "EXAMPLE-FUND-D",
    englishName: "Example Global Equity Index",
    amc: "Example AMC",
    assetClass: "equity",
    terPct: 0.2,
    managementStyle: "PN",
    taxIncentiveType: null,
    investRegion: "foreign",
    isFeederFund: true,
    feederMasterFund: "Example MSCI World ETF",
  },
  {
    projId: "EXMP_SSF1",
    abbr: "EXAMPLE-FUND-SSF1",
    englishName: "Example Global Equity SSF",
    amc: "Example AMC",
    assetClass: "equity",
    terPct: 0.45,
    managementStyle: "PN",
    taxIncentiveType: "SSF",
    investRegion: "foreign",
    isFeederFund: true,
    feederMasterFund: "Example MSCI World ETF",
  },
  {
    projId: "EXMP_RMF1",
    abbr: "EXAMPLE-FUND-RMF1",
    englishName: "Example Global Equity RMF",
    amc: "Example AMC",
    assetClass: "equity",
    terPct: 0.5,
    managementStyle: "PN",
    taxIncentiveType: "RMF",
    investRegion: "foreign",
    isFeederFund: true,
    feederMasterFund: "Example MSCI World ETF",
  },
  {
    projId: "EXMP_THAI",
    abbr: "EXAMPLE-FUND-THAI-IDX",
    englishName: "Example SET50 Index",
    amc: "Example AMC",
    assetClass: "equity",
    terPct: 0.3,
    managementStyle: "PN",
    taxIncentiveType: null,
    investRegion: "domestic",
    isFeederFund: false,
    feederMasterFund: null,
  },
];

function fundItem(f: CatalogFund) {
  return {
    projId: f.projId,
    abbr: f.abbr,
    englishName: f.englishName,
    amc: f.amc,
    assetClass: f.assetClass,
    terPct: f.terPct,
    terLabel: `${f.terPct.toFixed(2)}% p.a.`,
    managementStyle: f.managementStyle,
    // Real funds mark index style "PN"/"PM"; the synthetic catalog uses "PN".
    isIndex: f.managementStyle === "PN",
    taxIncentiveType: f.taxIncentiveType,
    distributionPolicy: null,
    investRegion: f.investRegion,
    isFeederFund: f.isFeederFund,
    feederMasterFund: f.feederMasterFund,
  };
}

// ─── Tool surface ───────────────────────────────────────────────────────────
// 9 advisor tools + 5 memory tools, matching the real surface size (~14) so the
// model faces the same tool-choice complexity. Descriptions on the four measured
// READS mirror the real steering; the rest are terse.

const okResult = (o: object) => ({ ok: true as const, ...o });

export function buildEvalTools() {
  return {
    read_portfolio: tool({
      description:
        "Read the user's REAL portfolio: total value, allocation by asset class and region, " +
        "per-sleeve drift from their target model, blended (value-weighted) expense ratio, " +
        "concentration (largest holding, top-3, HHI), and cash drag. Use before answering " +
        "anything about how they're doing, their mix, fees, concentration, or rebalancing.",
      inputSchema: z.object({}),
      execute: async () => PORTFOLIO,
    }),
    read_performance: tool({
      description:
        "Read how the portfolio PERFORMED over a period: total return % AND the same-period " +
        "return of reference indices (SET, S&P 500) so you can answer 'am I matching / beating " +
        "my index?' with real numbers. Call for any question about returns or keeping up with an index.",
      inputSchema: z.object({
        range: z.enum(["1mo", "3mo", "6mo", "1y", "5y", "max"]).optional(),
      }),
      execute: async () => PERFORMANCE,
    }),
    read_plan: tool({
      description:
        "Read the user's written investing plan (target, principles, risk, commitments).",
      inputSchema: z.object({}),
      execute: async () =>
        okResult({
          hasPlan: true,
          markdown:
            "# Investing Plan\n## Target\nBogle 3-fund, 40% global equity / 20% Thai equity / 30% global bond / 10% cash.\n## Principles\n- Index funds only, no single stocks.\n- Rebalance when any sleeve drifts more than 5pp.\n## Risk\n- Max drawdown tolerance 25%. Long horizon (20y+).",
          spine: {
            target: "Bogle 3-fund (40/20/30/10)",
            principles: ["Index funds only, no single stocks", "Rebalance when drift > 5pp"],
            risk: ["Max drawdown 25%", "20y+ horizon"],
            commitments: [],
          },
          extras: [],
          selectedModelId: "bogle-3-global",
          message: "Loaded the user's plan.",
        }),
    }),
    read_journal: tool({
      description: "Read past journal entries (note/decision/question/reading).",
      inputSchema: z.object({
        kind: z.enum(["note", "decision", "question", "reading"]).optional(),
        tag: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().max(50).optional(),
      }),
      execute: async () =>
        okResult({
          count: 1,
          entries: [
            {
              id: "j1",
              kind: "decision",
              title: "Trimmed global equity in January",
              body: "Sold a little EXAMPLE-FUND-A after it ran up; want to stay near target.",
              tags: ["rebalance"],
              createdAt: "2026-01-15",
            },
          ],
          message: "Found 1 journal entry.",
        }),
    }),
    write_journal: tool({
      description:
        "Save a new journal entry when the user makes a decision or asks to log something.",
      inputSchema: z.object({
        kind: z.enum(["note", "decision", "question", "reading"]),
        title: z.string().max(200).optional(),
        body: z.string().min(1).max(4000),
        tags: z.array(z.string()).max(10).optional(),
      }),
      execute: async ({ kind, title }) =>
        okResult({
          id: "j-new",
          kind,
          message: `Saved to your journal as a ${kind}${title ? `: "${title}"` : ""}.`,
        }),
    }),
    propose_plan_edit: tool({
      description:
        "Propose adding a rule/principle/risk note/target to the plan. Shows a confirm card; does NOT change the plan.",
      inputSchema: z.object({
        section: z.string().min(1),
        add: z.string().min(1),
        rationale: z.string().min(1).max(500),
      }),
      execute: async ({ section, add, rationale }) =>
        okResult({
          proposal: { section, rationale, add: `- ${add.replace(/^[-*]\s*/, "")}`, rm: null },
          message: `Drafted a change to your ${section} section — confirm on the card to apply it.`,
        }),
    }),
    propose_holding: tool({
      description:
        "Propose adding ONE holding (call once per position). Shows a confirm card; writes nothing until accepted.",
      inputSchema: z.object({
        ticker: z.string().min(1).max(40),
        englishName: z.string().min(1).max(200),
        units: z.number().positive(),
        avgCost: z.number().positive().optional(),
        assetClass: z.enum(["equity", "bond", "alternative", "cash"]).optional(),
        rationale: z.string().min(1).max(300),
      }),
      execute: async ({ ticker, units }) =>
        okResult({
          holding: { ticker: ticker.toUpperCase(), units },
          message: `Drafted ${ticker.toUpperCase()} (${units} units) — confirm on the card to add it.`,
        }),
    }),
    find_funds: tool({
      description:
        "Search the SEC-registered Thai mutual fund catalog and return funds matching a TARGET " +
        "EXPOSURE, sorted CHEAPEST FIRST by all-in annual fee (TER). Use indexOnly=true for " +
        "passive funds; taxIncentive to find SSF/ThaiESG/RMF wrappers. Fee is the controllable edge.",
      inputSchema: z.object({
        assetClass: z.enum(["equity", "bond", "alternative", "cash"]).optional(),
        indexOnly: z.boolean().optional(),
        taxIncentive: z.enum(["SSF", "ThaiESG", "RMF"]).optional(),
        region: z.enum(["foreign", "domestic", "mixed"]).optional(),
        query: z.string().optional(),
        limit: z.number().int().positive().max(30).optional(),
      }),
      execute: async ({ assetClass, taxIncentive, region, limit }) => {
        let funds = CATALOG.filter((f) => {
          if (assetClass && f.assetClass !== assetClass) return false;
          if (taxIncentive && f.taxIncentiveType !== taxIncentive) return false;
          if (region && f.investRegion !== region) return false;
          return true;
        });
        if (funds.length === 0) funds = CATALOG;
        funds = [...funds].sort((a, b) => a.terPct - b.terPct).slice(0, limit ?? 10);
        const items = funds.map(fundItem);
        return okResult({
          count: items.length,
          funds: items,
          cheapestAbbr: items[0]?.abbr ?? null,
          message: `Found ${items.length} fund(s) — sorted cheapest first. Lowest TER: ${items[0]?.terLabel} (${items[0]?.abbr}).`,
        });
      },
    }),
    find_cheaper_alternatives: tool({
      description:
        "Given a fund the user holds (by abbr or SEC project id), find cheaper funds with the " +
        "same exposure — strictly lower TER, cheapest first. Present the fee delta prominently.",
      inputSchema: z.object({
        fundAbbr: z.string().optional(),
        projId: z.string().optional(),
        limit: z.number().int().positive().max(10).optional(),
      }),
      execute: async ({ fundAbbr }) => {
        // The only held fund with a cheaper twin in the fixture is EXAMPLE-FUND-A
        // (global equity at 0.60% → EXAMPLE-FUND-D at 0.20%).
        const ref = (fundAbbr ?? "EXAMPLE-FUND-A").toUpperCase();
        const alt = fundItem(CATALOG[0]); // EXAMPLE-FUND-D @ 0.20
        return okResult({
          count: 1,
          alternatives: [alt],
          referenceAbbr: ref,
          cheapestAlternativeAbbr: alt.abbr,
          message:
            `Found 1 cheaper alternative for ${ref} — ${alt.abbr} at ${alt.terLabel} ` +
            "(vs 0.60% p.a., a 0.40pp saving). Even a 0.5% TER difference compounds materially.",
        });
      },
    }),
    // ─── memory tools (terse synthetic stand-ins; here for surface fidelity) ──
    save_preference: tool({
      description: "Save a durable user preference (how to advise them).",
      inputSchema: z.object({ category: z.string(), content: z.string() }),
      execute: async ({ content }) => okResult({ saved: true, content }),
    }),
    update_preference: tool({
      description: "Update an existing saved preference by id.",
      inputSchema: z.object({ id: z.string(), content: z.string() }),
      execute: async () => okResult({ updated: true }),
    }),
    forget_preference: tool({
      description: "Delete a saved preference by id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async () => okResult({ forgotten: true }),
    }),
    list_preferences: tool({
      description: "List all saved preferences.",
      inputSchema: z.object({}),
      execute: async () => okResult({ preferences: [] }),
    }),
    recall_preferences: tool({
      description: "Recall preferences relevant to a topic.",
      inputSchema: z.object({ topic: z.string().optional() }),
      execute: async () => okResult({ preferences: [] }),
    }),
  };
}

/** Tool names the eval expects to exist (guards drift against the real surface). */
export const EVAL_TOOL_NAMES = Object.keys(buildEvalTools()) as Array<
  keyof ReturnType<typeof buildEvalTools>
>;
