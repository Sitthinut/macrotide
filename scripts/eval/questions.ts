// The committed Advisor benchmark questions + a deterministic grader.
//
// Two tiers (issue #59):
//  - "retrieve": the common path — read a tool, report the number. Reasoning is
//    pure cost here (see docs/explanation/inference-strategy.md §3).
//  - "complex":  multi-step judgment the tools didn't pre-compute (rebalance
//    sequencing, SSF-vs-RMF weighing, a plan-anchored tilt). Where reasoning may
//    earn its cost — the tier that lets us MEASURE that, not guess.
//
// Quality is graded deterministically, not by an LLM judge: each question lists
// the grounded facts the answer must carry (it read the synthetic data), the
// tools it should have called, and guards against inventing data. That measures
// the two things that actually make Advisor answers good — grounded + complete +
// safe — cheaply and repeatably. An optional LLM-judge layer can be added later;
// the deterministic floor is what guards a model/prompt change.

export type Matcher = string | RegExp;

export interface Expect {
  /** Every matcher must appear in the answer (grounded facts / completeness). */
  mustInclude?: Matcher[];
  /** At least one must appear (tolerates phrasing variation). */
  anyOf?: Matcher[];
  /** None may appear (hallucination / wrong-direction guards). */
  mustNotInclude?: Matcher[];
  /** These tool names must have been called during the turn. */
  expectTools?: string[];
  /** These tool names must NOT have been called — guards against over-calling
   * (a simple lookup spuriously proposing an edit, or a concept question that
   * fires a fund search). Per the agent-evals research: test negative cases. */
  mustNotCallTools?: string[];
  /** Minimum number of tool calls (defaults to expectTools.length when unset). */
  minToolCalls?: number;
}

export type EvalTier = "retrieve" | "complex";

export interface EvalQuestion {
  id: string;
  tier: EvalTier;
  prompt: string;
  expect: Expect;
  /** Why this question is here / what it probes. */
  note?: string;
}

// A safety disclaimer is required by the system prompt on any buy/sell/hold or
// rebalancing guidance — assert its presence on those turns.
const DISCLAIMER: Matcher =
  /educational|not\s+(a\s+)?licensed|final\s+(call|decision)|your\s+(call|decision|choice)/i;

export const QUESTIONS: EvalQuestion[] = [
  // ── Tier 1: retrieve-then-explain (the common path) ───────────────────────
  {
    id: "R1-biggest-holding",
    tier: "retrieve",
    prompt: "Read my portfolio and tell me my single biggest holding and what percent it is.",
    expect: {
      expectTools: ["read_portfolio"],
      mustInclude: ["EXAMPLE-FUND-A", /50\s?%/],
      // A read-only lookup must not propose changes to the portfolio/plan.
      mustNotCallTools: ["propose_holding", "propose_plan_edit"],
    },
    note: "Pure lookup: a tool returns the answer. Reasoning is wasted cost.",
  },
  {
    id: "R2-beating-index",
    tier: "retrieve",
    prompt: "Am I beating my index? Check my performance.",
    expect: {
      expectTools: ["read_performance"],
      mustInclude: [/7\.1/, /4\.3/],
      anyOf: [/beat/i, /ahead/i, /outperform/i, /\bSET\b/],
    },
    note: "Beats the SET (+4.3) but trails the S&P (+9.8) — a good answer reports the real split.",
  },
  {
    id: "R3-health-check",
    tier: "retrieve",
    prompt: "Give me a quick health check on my portfolio.",
    expect: {
      expectTools: ["read_portfolio"],
      anyOf: [/drift/i, /underweight/i, /concentrat/i, /fee|ter|expense/i, /bond/i],
    },
    note: "Reads health and summarizes — knowledge-light, no deduction.",
  },
  {
    id: "R4-concentration",
    tier: "retrieve",
    prompt: "How concentrated is my portfolio? Is any one fund too big?",
    expect: {
      expectTools: ["read_portfolio"],
      mustInclude: ["EXAMPLE-FUND-A"],
      anyOf: [/50\s?%/, /top\s*3|top-3|90\s?%/i, /concentrat/i],
    },
  },
  {
    id: "R5-blended-fee",
    tier: "retrieve",
    prompt: "What's my blended fee, and is it high?",
    expect: {
      expectTools: ["read_portfolio"],
      anyOf: [/0\.58|0\.59|0\.6\b/, /blended|weighted/i],
    },
    note: "blendedTer 0.585 — the tool computes it; the model just reports.",
  },
  {
    id: "R6-explain-concept",
    tier: "retrieve",
    prompt: "In one short paragraph, what is index investing and why does it suit me?",
    expect: {
      anyOf: [/index/i],
      mustNotInclude: [/EXAMPLE-FUND-[B-Z]/],
      // A concept explanation shouldn't search the catalog or propose anything.
      mustNotCallTools: ["find_funds", "propose_holding", "propose_plan_edit"],
    },
    note: "Knowledge recall + clear writing, not deduction; no tool strictly required.",
  },
  {
    // Negative control: a definitional question the model should answer from
    // knowledge with NO tool call at all — guards against reflexive over-calling.
    id: "N1-no-overcall",
    tier: "retrieve",
    prompt: "Quick one — what does the abbreviation TER stand for?",
    expect: {
      anyOf: [/total expense ratio/i, /expense ratio/i],
      mustNotCallTools: [
        "read_portfolio",
        "read_performance",
        "find_funds",
        "find_cheaper_alternatives",
        "propose_holding",
        "propose_plan_edit",
      ],
    },
    note: "No tool needed; a model that reads the portfolio to define an acronym is over-calling.",
  },

  // ── Tier 2: complex multi-step (where reasoning may help) ─────────────────
  {
    id: "C1-rebalance-plan",
    tier: "complex",
    prompt: "Give me a step-by-step rebalance plan to get my portfolio back to my target model.",
    expect: {
      expectTools: ["read_portfolio"],
      anyOf: [/trim|sell|reduce|cut/i],
      mustInclude: [/bond/i, DISCLAIMER],
    },
    note: "Multi-step: compute trades to close +10/+5/−15pp drift, sequence them. Reasoning candidate.",
  },
  {
    id: "C2-ssf-vs-rmf",
    tier: "complex",
    prompt:
      "I have ฿100,000 to invest in a tax-advantaged fund this year. Should I use an SSF or an RMF for my situation? Find me options.",
    expect: {
      expectTools: ["find_funds"],
      mustInclude: [/SSF/i, /RMF/i],
      anyOf: [/lock|withdraw|until|age 55|horizon|liquid/i],
    },
    note: "Rules interplay (lock-up, deductions) + the user's numbers → a real weighing.",
  },
  {
    id: "C3-fx-tilt",
    tier: "complex",
    prompt:
      "The Thai baht has been weak lately. Should I tilt more toward global equity given that, or stick to my plan?",
    expect: {
      expectTools: ["read_portfolio"],
      mustInclude: [DISCLAIMER],
      anyOf: [/plan|target|already|overweight|50\s?%|discipline|stick/i],
    },
    note: "Weighs a macro factor against the plan — must stay plan-anchored, not chase FX.",
  },
  {
    id: "C4-fee-switch",
    tier: "complex",
    prompt:
      "I hold EXAMPLE-FUND-A. Is there a cheaper fund with the same exposure, and should I switch?",
    expect: {
      expectTools: ["find_cheaper_alternatives"],
      mustInclude: ["EXAMPLE-FUND-D", /0\.2(0)?\s?%/],
      anyOf: [/0\.4(0)?\s?(pp|%)|saving|cheaper|lower fee/i],
    },
    note: "Fee delta reasoning + a switch recommendation grounded in the alternative the tool returned.",
  },
];

// ── Grading ───────────────────────────────────────────────────────────────

function matches(text: string, m: Matcher): boolean {
  return typeof m === "string" ? text.includes(m) : m.test(text);
}

export interface GradeInput {
  text: string;
  toolNames: string[];
}

// The three sub-signals the agent-evals research recommends reporting separately
// rather than collapsing into one number (so a regression localizes):
//   - facts:  grounded completeness (mustInclude / anyOf) — did it carry the data
//   - tools:  trajectory (expectTools / minToolCalls / mustNotCallTools) — right
//             tools, no over-calling
//   - safety: no-hallucination guards (mustNotInclude)
export type GradeCategory = "facts" | "tools" | "safety";
export interface CategoryScore {
  passed: number;
  total: number;
}

export interface GradeResult {
  passed: number;
  total: number;
  score: number; // passed / total, 1 = perfect
  failures: string[];
  byCategory: Record<GradeCategory, CategoryScore>;
}

/**
 * Deterministically grade one answer against a question's expectations. Each
 * matcher / group / tool requirement is one check, tagged with a category; the
 * overall score is the pass fraction and per-category sub-scores localize a
 * regression. A grounded, complete, safe answer scores 1.0; a dead-end (empty
 * text) scores 0 on every text check.
 */
export function gradeAnswer(q: EvalQuestion, input: GradeInput): GradeResult {
  const { text, toolNames } = input;
  const checks: Array<{ ok: boolean; label: string; cat: GradeCategory }> = [];

  for (const m of q.expect.mustInclude ?? []) {
    checks.push({ ok: matches(text, m), label: `mustInclude ${String(m)}`, cat: "facts" });
  }
  if (q.expect.anyOf?.length) {
    checks.push({
      ok: q.expect.anyOf.some((m) => matches(text, m)),
      label: `anyOf ${q.expect.anyOf.map(String).join(" | ")}`,
      cat: "facts",
    });
  }
  for (const m of q.expect.mustNotInclude ?? []) {
    checks.push({ ok: !matches(text, m), label: `mustNotInclude ${String(m)}`, cat: "safety" });
  }
  for (const t of q.expect.expectTools ?? []) {
    checks.push({ ok: toolNames.includes(t), label: `expectTool ${t}`, cat: "tools" });
  }
  for (const t of q.expect.mustNotCallTools ?? []) {
    checks.push({ ok: !toolNames.includes(t), label: `mustNotCallTool ${t}`, cat: "tools" });
  }
  const minTools = q.expect.minToolCalls ?? q.expect.expectTools?.length ?? 0;
  if (minTools > 0) {
    checks.push({
      ok: toolNames.length >= minTools,
      label: `minToolCalls ${minTools}`,
      cat: "tools",
    });
  }

  const byCategory: Record<GradeCategory, CategoryScore> = {
    facts: { passed: 0, total: 0 },
    tools: { passed: 0, total: 0 },
    safety: { passed: 0, total: 0 },
  };
  for (const c of checks) {
    byCategory[c.cat].total++;
    if (c.ok) byCategory[c.cat].passed++;
  }

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length || 1;
  return {
    passed,
    total,
    score: passed / total,
    failures: checks.filter((c) => !c.ok).map((c) => c.label),
    byCategory,
  };
}

export function questionsForTier(tier: EvalTier | "all"): EvalQuestion[] {
  return tier === "all" ? QUESTIONS : QUESTIONS.filter((q) => q.tier === tier);
}
