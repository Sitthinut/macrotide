# Advisor eval harness

A committed, repeatable benchmark for the Advisor chat loop. Run it **before**
flipping `FREE_TIER_MODEL`, editing the system prompt, or enabling gated
reasoning (#58) so model/prompt changes are measured, not guessed.

It runs a fixed question set through one or more models against a **synthetic**
tool surface (no real fund codes — `EXAMPLE-FUND-*` only) that mirrors the real
advisor + memory tools, using the **exact production system prompt**
(`lib/advisor/system-prompt.ts`) and OpenRouter wiring. For each turn it records:

- **dead-end rate** — turns that produced no prose (the issue #21 failure mode)
- **latency** — wall-clock per turn
- **token cost** — input/output tokens + an at-a-glance USD estimate
- **answer quality** — deterministic grading: did the answer carry the grounded
  facts (it read the synthetic data), call the right tools, and avoid inventing
  holdings? Score is the fraction of those checks that passed. See
  `questions.ts` for the per-question expectations.

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
of the question set + grader is guarded for free in `tests/eval/questions.test.ts`.

### Env knobs

| Var | Default | Meaning |
|---|---|---|
| `EVAL_MODELS` | `google/gemini-2.5-flash-lite` | comma list of OpenRouter model ids |
| `EVAL_TIER` | `all` | `retrieve` \| `complex` \| `all` |
| `EVAL_N` | `1` | repeats per question |
| `EVAL_REASONING` | _unset_ | `none`\|`minimal`\|`low`\|`medium`\|`high` (injected as `reasoning.effort`) |
| `EVAL_MAX_TOKENS` | 1024 (2048 when reasoning ≥ low) | output cap per turn |
| `EVAL_OUT` | `eval-results/<timestamp>.json` | raw per-turn results (gitignored) |

## Out of scope

Fine-tuning. For a hosted-model app fronted by OpenRouter the levers are context
engineering + tool design + model selection — see
`docs/explanation/inference-strategy.md`.
