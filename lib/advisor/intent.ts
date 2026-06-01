// Reasoning-intent gate (#58). Most Advisor turns are retrieve-then-explain — a
// tool returns the number and the model reports it — where reasoning tokens are
// pure cost (slow + billed at the output rate, no quality gain). A minority are
// genuine multi-step JUDGMENT the tools didn't pre-compute: a step-by-step
// rebalance, an SSF-vs-RMF weighing, a plan-anchored "should I tilt to gold
// given THB weakness". Those benefit from reasoning.
//
// This is the cheap, deterministic classifier the route consults to decide the
// per-turn `reasoning.effort` for the owner/trusted paths: `"medium"` on an
// analytical turn, `"none"` otherwise. It deliberately does NOT call a model —
// the whole point is to avoid paying reasoning rates (or an extra round-trip) to
// decide whether to pay reasoning rates. Pure (no server-only / no env) so it's
// unit-testable and client-importable.
//
// The decision table + rationale live in docs/explanation/inference-strategy.md
// §3. Errs toward "none": a false "none" on a complex turn costs a slightly
// shallower answer, while a false "medium" on every borderline turn would erode
// the latency/cost win the gate exists to protect — so only STRONG signals of
// multi-step judgment flip it on.
import type { EntryContext } from "./entry-context";

export interface ReasoningDecision {
  /** True when the turn is genuine multi-step judgment (raise effort). */
  analytical: boolean;
  /** The effort the owner/trusted paths should use for this turn. */
  effort: "none" | "medium";
  /** Why — the matched intent/phrase tags (for logging/observability). */
  signals: string[];
}

// EntryContext.intent values (set by the Ask-Advisor buttons) that are
// inherently multi-step. The retrieve-then-explain intents — health_review,
// score_review, fund_lookup, fee_switch, strategy_explain — are deliberately
// absent: a tool returns their answer. `fee_switch` is a lookup
// (find_cheaper_alternatives computes the delta), not a deduction.
const ANALYTICAL_INTENTS = new Set(["rebalance", "tax", "tilt", "tradeoff", "compare_funds"]);

// Phrase patterns signalling multi-step deduction. Each is a STRONG signal — a
// turn that combines several facts into a judgment, not a single retrieval.
const ANALYTICAL_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /\brebalanc/i, tag: "rebalance" },
  { re: /step[-\s]?by[-\s]?step/i, tag: "step-by-step" },
  // SSF and RMF named together = the canonical tax-wrapper tradeoff.
  { re: /\bssf\b[\s\S]*\brmf\b|\brmf\b[\s\S]*\bssf\b/i, tag: "ssf-vs-rmf" },
  { re: /\bvs\.?\b|\bversus\b|trade[-\s]?off/i, tag: "comparison" },
  {
    re: /should i (tilt|shift|move|rotate|switch|overweight|underweight|lean)/i,
    tag: "should-i-shift",
  },
  { re: /\btilt(ing)?\b/i, tag: "tilt" },
  { re: /\bhedg(e|ing)\b|tracking error|currency risk/i, tag: "multi-factor" },
  // "given X, should I Y" — an explicit conditional weighing.
  { re: /given [\s\S]{0,80}?\b(should|would|do you think|is it worth)\b/i, tag: "conditional" },
];

/**
 * Classify a turn's reasoning need from the user's latest message plus any
 * Ask-Advisor entry context. Returns the effort the owner/trusted paths should
 * apply. Free/demo never consult this (they stay pinned to `none`).
 */
export function classifyReasoningIntent(
  text: string | null | undefined,
  entryContext?: EntryContext | null,
): ReasoningDecision {
  const signals: string[] = [];

  const intent = entryContext?.intent?.toLowerCase();
  if (intent && ANALYTICAL_INTENTS.has(intent)) signals.push(`intent:${intent}`);

  const t = text ?? "";
  for (const { re, tag } of ANALYTICAL_PATTERNS) {
    if (re.test(t)) signals.push(tag);
  }

  const analytical = signals.length > 0;
  return { analytical, effort: analytical ? "medium" : "none", signals };
}
