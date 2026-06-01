# Advisor eval harness

A committed, repeatable benchmark for the Advisor chat loop. Run it **before**
flipping `FREE_TIER_MODEL`, editing the system prompt, or enabling gated
reasoning (#58) so model/prompt changes are measured, not guessed.

It runs a fixed question set through one or more models against a **synthetic**
tool surface (no real fund codes — `EXAMPLE-FUND-*` only) that mirrors the real
advisor + memory tools, using the **exact production system prompt**
(`lib/advisor/system-prompt.ts`) and OpenRouter wiring. For each turn it records, and aggregates per `(model, tier)`:

- **dead-end rate** — turns that produced no prose (the issue #21 failure mode),
  reported as its own % (a distinct reliability failure, not a zero in quality)
- **quality (avg@N) ± 95% CI** — mean deterministic score across runs, with a
  confidence interval (shown when `EVAL_N ≥ 2`) so a gap that's just run-variance
  rather than a real difference is visible at a glance
- **pass^k** — the fraction of QUESTIONS where *all* `EVAL_N` runs passed: the
  load-bearing reliability number a single-run mean hides (75%/run ≈ 42% at k=3)
- **three sub-signals**, reported separately rather than collapsed —
  **facts** (grounded completeness), **tools** (right tools called, with the right
  arguments, no over-calling), **safety** (no invented holdings)
- **latency / tokens / cost** — wall-clock, in/out tokens, USD estimate
- a **PASS/FAIL verdict** against pre-declared per-tier thresholds (dead-end,
  grounded-facts floor, hallucination=0). Set `EVAL_GATE=on` to exit non-zero on
  a breach (a pre-change gate). See `questions.ts` for per-question expectations
  and `run.ts` `THRESHOLDS` for the acceptance criteria.

The grading is **deterministic** (no LLM judge) — the floor that survives model
swaps. An LLM-as-judge layer is deliberately deferred (see the research survey
and inference-strategy.md § Evaluation).

Two tiers (`questions.ts`):

- **retrieve** — the common path: read a tool, report the number. Reasoning is
  pure cost here.
- **complex** — multi-step judgment the tools didn't pre-compute (rebalance
  sequencing, SSF-vs-RMF, a plan-anchored tilt). Where reasoning may earn its
  cost — the tier that lets us measure that.

## Run

```bash
npm run eval:advisor                                            # default model, all tiers
EVAL_MODELS=google/gemini-2.5-flash-lite,google/gemini-2.5-flash npm run eval:advisor
EVAL_TIER=complex EVAL_REASONING=medium npm run eval:advisor    # the #58 A/B …
EVAL_TIER=complex EVAL_REASONING=none   npm run eval:advisor    # … vs the baseline
```

It hits the live OpenRouter API and **spends real tokens** (`OPENROUTER_API_KEY`
from `.env.local`), so it is intentionally NOT part of `npm test`. The structure
of the question set, grader, statistics, and diff is guarded for free in
`tests/eval/*.test.ts`.

Each run writes its results to `eval-results/<timestamp>.json` (gitignored),
tagged with the current commit SHA, every per-turn row, and the tool calls *with
arguments* — enough to re-grade or audit a run after the fact.

## Compare two runs

```bash
npm run eval:diff -- eval-results/<before>.json eval-results/<after>.json
```

Pairs questions by `(model, qid)` across the two files and reports the score
delta, which questions newly **fail** or got **fixed** (pass^k flips), and a
**paired McNemar test** over the shared set — so a before/after comparison is
mechanical, and a "winner" is only declared significant when the flips lean one
way beyond chance. The first file is the baseline; a positive delta means the
second (candidate) scored higher.

### Env knobs

| Var | Default | Meaning |
|---|---|---|
| `EVAL_MODELS` | `google/gemini-2.5-flash-lite` | comma list of OpenRouter model ids |
| `EVAL_TIER` | `all` | `retrieve` \| `complex` \| `all` |
| `EVAL_N` | `1` | repeats per question |
| `EVAL_REASONING` | _unset_ | `none`\|`minimal`\|`low`\|`medium`\|`high` (injected as `reasoning.effort`) |
| `EVAL_MAX_TOKENS` | 1024 (2048 when reasoning ≥ low) | output cap per turn |
| `EVAL_OUT` | `eval-results/<timestamp>.json` | raw per-turn results (gitignored) |
| `EVAL_GATE` | _off_ | `on` → exit non-zero when a pre-declared threshold is breached |

Use `EVAL_N≥3` for any comparison (a single run conflates model variance with
capability).

## Changing the question set

The questions are a small **golden set**. To keep it honest (and avoid
Goodharting a score by editing the test): treat the current set as **frozen** —
fix only genuine grader bugs (e.g. a regex missing a number format), and **add**
new questions rather than loosening existing ones. Prefer growing the complex
tier, which is where reasoning and harder grounding live.

A question can opt into a different data surface with `fixture: "empty"`, which
routes the portfolio reads to a **no-holdings** fixture — used by the
`N2-empty-holdings` *negative control*, where the only correct answer is "you
have no holdings yet" and naming a fund or an allocation % is a hallucination.
Negative controls (the right move is to *refuse*, not answer) are as important as
the positive ones. Beyond names, a question can assert a tool was called with the
right **arguments** via `expectToolArgs` (e.g. `find_cheaper_alternatives` was
asked about the fund the user actually holds), which a name-only check misses.

## Out of scope

Fine-tuning. For a hosted-model app fronted by OpenRouter the levers are context
engineering + tool design + model selection — see
`docs/explanation/inference-strategy.md`.
