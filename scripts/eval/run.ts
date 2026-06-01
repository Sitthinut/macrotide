// Advisor eval runner (issue #59). Runs the committed question set through one
// or more models against the SYNTHETIC tool surface, and reports dead-end rate,
// latency, token cost, and deterministic answer-quality per tier — a repeatable
// benchmark to run BEFORE flipping FREE_TIER_MODEL, editing the system prompt,
// or enabling gated reasoning (#58).
//
// It mirrors the app's OpenRouter wiring (lib/ai/provider.ts) and uses the exact
// production system prompt (lib/advisor/system-prompt.ts) so the numbers reflect
// the real path. Hits the live API — costs real tokens — so it is NOT part of
// `npm test`; run it on demand:
//
//   npm run eval:advisor
//   EVAL_MODELS=google/gemini-2.5-flash-lite,google/gemini-2.5-flash npm run eval:advisor
//   EVAL_TIER=complex EVAL_REASONING=medium npm run eval:advisor   # the #58 A/B
//   EVAL_TIER=complex EVAL_REASONING=none   npm run eval:advisor   # baseline
//
// Env knobs: EVAL_MODELS (comma list), EVAL_TIER=retrieve|complex|all,
// EVAL_N (repeats/question, default 1), EVAL_REASONING (none|minimal|low|medium|
// high), EVAL_MAX_TOKENS, EVAL_OUT (json path; default eval-results/<ts>.json).

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/system-prompt";
import { buildEvalTools } from "./fixtures";
import {
  type EvalQuestion,
  type EvalTier,
  type GradeResult,
  gradeAnswer,
  questionsForTier,
  type ToolCall,
} from "./questions";
import { ci95 } from "./stats";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY not in env (run via: npm run eval:advisor).");
  process.exit(1);
}

const REASONING = process.env.EVAL_REASONING as
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | undefined;

// EVAL_SHAPING=on attaches the #60 toModelOutput shapers so the harness measures
// the SHAPED (compact) model-facing tool view; default off = the raw object.
const SHAPE = process.env.EVAL_SHAPING === "on" || process.env.EVAL_SHAPING === "1";

// Mirror of lib/ai/provider.ts openrouter(): same baseURL/headers, same
// reasoning-injection seam. Single model (no fallback list) — the eval pins an
// exact model so the served id is deterministic.
function makeModel(modelId: string) {
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: KEY as string,
    headers: { "HTTP-Referer": "https://macrotide.local", "X-Title": "Macrotide" },
    fetch: !REASONING
      ? undefined
      : async (input, init) => {
          if (init && typeof init.body === "string") {
            try {
              const body = JSON.parse(init.body);
              body.reasoning = { effort: REASONING };
              init = { ...init, body: JSON.stringify(body) };
            } catch {
              // not JSON — forward untouched
            }
          }
          return fetch(input as RequestInfo, init);
        },
  });
  return provider(modelId);
}

// USD per 1M tokens (== micro-USD/token) for an at-a-glance cost estimate. The
// app's real, authoritative table is lib/db/queries/usage.ts (MODEL_PRICES);
// keep this in rough sync. Unknown models report cost as null.
const PRICES: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5 },
  "openai/gpt-4.1-nano": { in: 0.1, out: 0.4 },
  "openai/gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "deepseek/deepseek-chat-v3.1": { in: 0.2, out: 0.8 },
};

interface RunRow {
  qid: string;
  tier: EvalTier;
  ok: boolean; // produced prose
  err: boolean;
  pass: boolean; // perfect (score === 1) AND not dead/err — the pass^k unit
  ms: number;
  inTok: number;
  outTok: number;
  steps: number; // trajectory length = model generations this turn (issue #68)
  toolNames: string[];
  toolCalls: ToolCall[]; // names + arguments (issue #68), persisted for arg-grounding analysis
  score: number;
  failures: string[];
  cat: GradeResult["byCategory"];
}

const ZERO_CAT: GradeResult["byCategory"] = {
  facts: { passed: 0, total: 0 },
  tools: { passed: 0, total: 0 },
  safety: { passed: 0, total: 0 },
};

async function runOne(modelId: string, q: EvalQuestion, maxTokens: number): Promise<RunRow> {
  const messages: ModelMessage[] = [{ role: "user", content: q.prompt }];
  const t0 = performance.now();
  try {
    const r = streamText({
      model: makeModel(modelId),
      system: ADVISOR_SYSTEM_PROMPT,
      messages,
      // A question can opt into the empty-holdings surface (issue #69).
      tools: buildEvalTools({ shape: SHAPE, empty: q.fixture === "empty" }),
      stopWhen: stepCountIs(5),
      maxOutputTokens: maxTokens,
    });
    const [text, steps, usage] = await Promise.all([r.text, r.steps, r.totalUsage]);
    const ms = performance.now() - t0;
    // Capture each call's NAME and ARGUMENTS (issue #68); names stay derived for
    // the existing name-level checks and the display line.
    const toolCalls: ToolCall[] = steps.flatMap((s) =>
      s.toolCalls.map((c) => ({ name: c.toolName, args: c.input })),
    );
    const toolNames = toolCalls.map((c) => c.name);
    const stepCount = steps.length;
    const ok = !!text.trim();
    const grade = gradeAnswer(q, { text, toolNames, toolCalls, steps: stepCount });
    return {
      qid: q.id,
      tier: q.tier,
      ok,
      err: false,
      pass: ok && grade.score === 1,
      ms,
      inTok: usage.inputTokens ?? 0,
      outTok: usage.outputTokens ?? 0,
      steps: stepCount,
      toolNames,
      toolCalls,
      score: ok ? grade.score : 0,
      failures: ok ? grade.failures : ["DEAD-END (no prose)"],
      cat: ok ? grade.byCategory : ZERO_CAT,
    };
  } catch (e) {
    return {
      qid: q.id,
      tier: q.tier,
      ok: false,
      err: true,
      pass: false,
      ms: performance.now() - t0,
      inTok: 0,
      outTok: 0,
      steps: 0,
      toolNames: [],
      toolCalls: [],
      score: 0,
      failures: [`ERROR: ${(e as Error).message.slice(0, 120)}`],
      cat: ZERO_CAT,
    };
  }
}

function costPerTurn(modelId: string, inTok: number, outTok: number): number | null {
  const p = PRICES[modelId];
  return p ? (inTok * p.in + outTok * p.out) / 1e6 : null;
}

// Pre-declared acceptance criteria, per tier (agent-evals research: decide with
// thresholds set BEFORE the run, not vibes). Dead-end and hallucination are hard
// reliability gates; grounded-facts is a quality floor. `EVAL_GATE=on` makes a
// breach exit non-zero (for a pre-change check); otherwise it just annotates.
const THRESHOLDS: Record<
  EvalTier,
  { deadMaxPct: number; factsMinPct: number; safetyMinPct: number }
> = {
  retrieve: { deadMaxPct: 5, factsMinPct: 80, safetyMinPct: 100 },
  complex: { deadMaxPct: 15, factsMinPct: 60, safetyMinPct: 100 },
};

const pct = (num: number, den: number): number => (den ? (num / den) * 100 : 100);

async function main() {
  const models = (process.env.EVAL_MODELS ?? "google/gemini-2.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const tier = (process.env.EVAL_TIER ?? "all") as EvalTier | "all";
  const n = Number(process.env.EVAL_N ?? 1);
  // Reasoning at medium/high can eat most of max_tokens (OpenRouter allocates
  // ~80% to reasoning at high) — give the answer room so a reasoning run isn't
  // unfairly truncated vs the none baseline. Default 1024 = the free-tier cap.
  const defaultMax = REASONING && REASONING !== "none" && REASONING !== "minimal" ? 2048 : 1024;
  const maxTokens = Number(process.env.EVAL_MAX_TOKENS ?? defaultMax);
  const questions = questionsForTier(tier);

  console.log(
    `Advisor eval — ${questions.length} question(s) × ${n} run(s) × ${models.length} model(s)\n` +
      `tier=${tier} reasoning=${REASONING ?? "default"} shaping=${SHAPE ? "on" : "off"} maxTokens=${maxTokens}\n`,
  );

  const allRows: Array<RunRow & { model: string }> = [];

  for (const modelId of models) {
    console.log(`━━━ ${modelId} ━━━`);
    for (const q of questions) {
      for (let i = 0; i < n; i++) {
        const row = await runOne(modelId, q, maxTokens);
        allRows.push({ ...row, model: modelId });
        const tag = row.err
          ? "ERR "
          : !row.ok
            ? "DEAD"
            : row.score === 1
              ? "PASS"
              : `${Math.round(row.score * 100)}% `;
        const cost = costPerTurn(modelId, row.inTok, row.outTok);
        console.log(
          `  [${tag}] ${row.qid.padEnd(20)} ${Math.round(row.ms).toString().padStart(6)}ms ` +
            `in=${row.inTok.toString().padStart(5)} out=${row.outTok.toString().padStart(4)} ` +
            `steps=${row.steps} tools=[${row.toolNames.join(",") || "—"}]` +
            (cost != null ? ` ~$${cost.toFixed(5)}` : "") +
            (row.failures.length ? `  ✗ ${row.failures.join("; ")}` : ""),
        );
      }
    }
    console.log("");
  }

  // ── Aggregate per (model, tier) ──────────────────────────────────────────
  console.log("═══ SUMMARY (per model × tier) ═══");
  const groups = new Map<string, Array<RunRow & { model: string }>>();
  for (const r of allRows) {
    const key = `${r.model} ${r.tier}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let gateBreached = false;
  for (const [key, rows] of groups) {
    const [model, tier_] = key.split(" ");
    const t = tier_ as EvalTier;
    const nRows = rows.length;
    const dead = rows.filter((r) => !r.err && !r.ok).length;
    const err = rows.filter((r) => r.err).length;
    const deadPct = pct(dead, nRows);
    const avgQuality = rows.reduce((s, r) => s + r.score, 0) / nRows;
    // 95% CI on the quality mean (issue #66) — shows when a difference is noise.
    // Undefined at n=1 (no spread): printed as a bare mean.
    const qCi = ci95(rows.map((r) => r.score));
    const ciStr = Number.isNaN(qCi.margin) ? "" : ` ±${(qCi.margin * 100).toFixed(0)}%`;
    const sub = (c: keyof RunRow["cat"]) =>
      pct(
        rows.reduce((s, r) => s + r.cat[c].passed, 0),
        rows.reduce((s, r) => s + r.cat[c].total, 0),
      );
    const factsPct = sub("facts");
    const toolsPct = sub("tools");
    const safetyPct = sub("safety");

    // pass^k: group this tier's rows by question; a question passes only if ALL
    // its runs passed. Reported as passedQuestions / totalQuestions.
    const byQ = new Map<string, boolean>();
    for (const r of rows) byQ.set(r.qid, (byQ.get(r.qid) ?? true) && r.pass);
    const qPass = [...byQ.values()].filter(Boolean).length;
    const qTotal = byQ.size;

    const avgIn = Math.round(rows.reduce((s, r) => s + r.inTok, 0) / nRows);
    const avgOut = Math.round(rows.reduce((s, r) => s + r.outTok, 0) / nRows);
    const avgMs = Math.round(rows.reduce((s, r) => s + r.ms, 0) / nRows);
    const cost = costPerTurn(model, avgIn, avgOut);

    const th = THRESHOLDS[t];
    const breaches: string[] = [];
    if (deadPct > th.deadMaxPct) breaches.push(`dead ${deadPct.toFixed(0)}%>${th.deadMaxPct}%`);
    if (factsPct < th.factsMinPct)
      breaches.push(`facts ${factsPct.toFixed(0)}%<${th.factsMinPct}%`);
    if (safetyPct < th.safetyMinPct)
      breaches.push(`safety ${safetyPct.toFixed(0)}%<${th.safetyMinPct}%`);
    if (breaches.length) gateBreached = true;
    const verdict = breaches.length ? `FAIL (${breaches.join(", ")})` : "PASS";

    console.log(
      `\n${model} · ${t} (n=${nRows}, ${qTotal} questions x ${nRows / qTotal})\n` +
        `  quality(avg@N) ${(avgQuality * 100).toFixed(0)}%${ciStr}   pass^k ${qPass}/${qTotal}   ` +
        `dead ${deadPct.toFixed(0)}%${err ? ` err ${err}` : ""}\n` +
        `  facts ${factsPct.toFixed(0)}%  tools ${toolsPct.toFixed(0)}%  safety ${safetyPct.toFixed(0)}%   ` +
        `${avgMs}ms  in=${avgIn} out=${avgOut}${cost != null ? `  $${cost.toFixed(5)}/turn` : ""}\n` +
        `  -> ${verdict}`,
    );
  }

  if (process.env.EVAL_GATE === "on" && gateBreached) {
    console.log("\nEVAL_GATE=on and a pre-declared threshold was breached — exiting non-zero.");
  }

  // ── Persist (gitignored) ─────────────────────────────────────────────────
  // Tag the run with the current commit (issue #67) so a result file is traceable
  // to the code it measured and diff.ts can label before/after by SHA.
  let gitSha: string | null = null;
  try {
    gitSha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // not a git checkout — leave null
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = process.env.EVAL_OUT ?? `eval-results/${stamp}.json`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        gitSha,
        models,
        tier,
        n,
        reasoning: REASONING ?? null,
        shaping: SHAPE,
        maxTokens,
        rows: allRows,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}${gitSha ? ` (sha ${gitSha})` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
