# Inference strategy — how the Advisor stays smart, fast, and token-efficient

*Last updated: 2026-06-01*

> **Living design doc.** It records the cost/latency/quality decisions for the
> Advisor — what the design does, and the principle behind each lever. Some of
> what it describes is built and some is a direction the design anticipates;
> trust the code over the doc and fix the doc when they disagree. Forward-looking
> refinements are tracked on the
> [project board](https://github.com/users/Sitthinut/projects/2).

This is the design layer between the prior-art surveys and the code. The
[LLM-platform-primitives](./research/llm-platform-primitives.md) and
[context-and-caching](./research/context-and-caching.md) surveys establish *what
the providers expose*; [context-engineering.md](./research/context-engineering.md)
surveys *the tool-use loop patterns*. This doc is **the decisions Macrotide makes
on top of them** — the cost/latency/quality strategy for an Advisor that is a
small, cheap model behind OpenRouter, driving a deliberately small tool surface.
The loop's mechanics live in
[architecture.md § the chat path](./architecture.md) and
[advisor-context.md](./advisor-context.md); this page is the *why behind the
knobs*.

The Advisor's shape: ~10 tools (memory + advisor reads/proposals), `stepCountIs(5)`,
`maxOutputTokens` 1024 (demo/free) / 2048 (trusted/owner), a frozen
system+memory prefix (`composeSystemPrompt`), a per-turn `EntryContext` user
message after it, **no prompt-cache breakpoints**, and **reasoning pinned off on
the cost-sensitive paths** — over the `openrouter/free → openrouter/auto` chain
with recover-on-empty + retry-on-error resilience.

## The five levers, at a glance

| Lever | Where Macrotide stands | Highest-value move |
|---|---|---|
| **Model routing** | free pinned to its own `FREE_TIER_MODEL`; multi-model fallback; recover-on-empty net | route by tool-call reliability, not just price |
| **Prompt caching** | frozen prefix is cache-*ready* but no breakpoints sent | keep volatile data after the prefix; exploit free-chain auto-caching; clear the floor |
| **Reasoning tokens** | `effort:none` pinned on free/demo/title/extract; owner/trusted gated by intent (`none`↔`medium`) | push more "complex math" into tools so even complex turns need less reasoning |
| **Context loading** | JIT tool reads + the entry-context envelope | keep JIT default; app-layer compaction; shape tool results |
| **Structured output** | tool-call-as-extraction via the AI SDK | one schema to the strictest intersection + Zod re-validate |

---

## 1. Model routing & tiers

**Route by tool-call reliability, not just price.**
For an advisor, a dropped or garbled tool call puts a *wrong number on screen* —
so emission reliability is a first-class routing criterion, not an afterthought.
OpenRouter publishes a per-provider **Tool Call Error Rate** (and orders providers
by it for tool-calling requests); filter candidates on
`supported_parameters=tools` and prefer low-error providers. The `openrouter/free`
meta-router fans across DeepSeek/Qwen/etc. with *no* such guarantee — which is
exactly why the recover-on-empty net is load-bearing, not optional.

**A cheap paid free-tier floor, bounded by caps.**
The free tier's model is now its own operator knob (`FREE_TIER_MODEL`, default the
zero-cost `openrouter/free`), so a cheap paid model (the A/B picked
`google/gemini-2.5-flash-lite` / `-flash`) can remove most dead-ends *at the
source*. The cost guard the AGENTS.md invariant mandates is preserved **by
construction**: the free chain derives only from `FREE_TIER_MODEL`, never from
`AI_MODELS`, so a paid floor is a deliberate, separately-capped choice — not a
widening of the pinned chain. Spend is bounded by the daily token cap plus the
optional cents cost cap. *Watch the DeepSeek alias churn:* `deepseek-chat` /
`deepseek-reasoner` are now aliases for `deepseek-v4-flash` and deprecate
**2026-07-24** — don't hardcode the alias.

**Expect a cold cache on every failover.**
A model / route / tool-schema switch invalidates the cached prefix everywhere. The
`openrouter/free → openrouter/auto` fallback and the retry-on-error re-roll are
correct, but budget input cost for a *cold* prefix on the fallback path, and keep
the fallback's prompt structure byte-identical so it re-warms fast.

## 2. Prompt-cache strategy

**The envelope split is correct — keep volatile data strictly AFTER the frozen
prefix.**
`composeSystemPrompt` freezes memory+system once per request, and
`injectEntryContext` splices the per-turn `EntryContext` as a `user` message
*after* that prefix. That is exactly the universal caching rule (stable
tools→system→static first, volatile last). **Do not regress it.** The standing
guard: never inject `currentDate`, a session id, or a freshly-fetched quote into
the system prefix — a 24h date string busts the cache every day, a quote block
every turn.

**Don't pay for explicit breakpoints on the free chain; do exploit automatic
caching.**
The free/auto router fans across OpenAI-shape, DeepSeek, and Gemini-2.5 models —
all of which cache **automatically** with no config and no write premium. On
OpenRouter, explicit `cache_control` breakpoints apply **only to Anthropic Claude
and Alibaba Qwen** — and Qwen *is* on the free chain, so a Qwen route could
actually benefit from breakpoints, whereas the rest get nothing from them. So:
keep the prefix stable, and add breakpoints only if you pin Claude or Qwen (then up
to 4 — after tools, system, static context, last stable turn — on the default
5-minute TTL; break-even is one read).

**Clear the minimum cacheable-prefix floor.**
A lean small-model system prompt can fall *under* 1,024 tokens and never cache at
all (OpenAI / Gemini-Flash floor at 1,024; Gemini-Pro and Anthropic Opus-4.5/4.6/
4.7 + Haiku-4.5 at 4,096 — though Opus 4.8 is back to 1,024). Once warm the prefix
is a ~0.1× cache *read*, so a longer stable prefix is **cheaper**, not more
expensive. Measure `composeSystemPrompt`'s token count; the memory block +
disclaimer likely already clear 1,024 — confirm rather than assume.

**Instrument it.**
Read OpenRouter's `cache_discount` and `prompt_tokens_details.cached_tokens` per
call, log hit rate, and alarm on a sudden drop — a collapse almost always means
something volatile (a reordered tool list, a timestamp, a route swap) crept into
the prefix. The most likely future leak point is a scheduled job (the AI daily
digest) injecting the date or a market snapshot into the prefix.

## 3. Reasoning-token policy

### When should the Advisor use reasoning?

A common trap: "investment questions are complex, so the Advisor should reason."
But *domain complexity* and *per-turn reasoning need* are different things.
Reasoning tokens buy exactly one thing — **more private chain-of-thought before
the model writes** — which helps with *multi-step deduction*. They do **nothing**
for the two things that actually make Advisor answers good or bad:

1. **Getting real numbers** is **tools**, not reasoning. Drift, blended TER,
   concentration, and the benchmark gap are computed deterministically
   (`lib/portfolio/health.ts`) and returned by `read_portfolio` /
   `read_performance`. The model *reads* them; it doesn't deduce them. Reasoning
   over a number it already has just adds latency.
2. **Not inventing numbers** is **grounding + strict honesty**, not reasoning. A
   reasoning model hallucinates a ticker just as confidently; what stops it is the
   "only reference what your tools returned" rule. Reasoning doesn't fix the real
   failure mode.

So most Advisor turns are **retrieve-then-explain**, where reasoning is pure cost.
The minority that genuinely benefit are **multi-step judgment the tools didn't
pre-compute**:

| Advisor turn | Reason? | Why |
|---|---|---|
| "What's my biggest holding?" / "Am I beating my index?" | **No** | A tool returns the number; report it. |
| "What is index investing?" / "Explain this fee" | **No / minimal** | Knowledge recall + clear writing, not deduction. |
| OCR extract, holdings-confirmation table | **No (never high)** | Structured output — reasoning *corrupts* strict JSON (Anthropic warns of overthinking). |
| "Step-by-step rebalance plan" | **Yes (medium)** | Compute trades across N holdings to close the gap within constraints, then sequence them. |
| "Should I tilt to gold given THB weakness?" | **Yes** | Weighs several factors against the plan. |
| "SSF vs RMF for my situation"; tracking-error / hedging comparisons | **Yes** | Rules interplay + the user's numbers → a real multi-step weighing. |
| "What do you think of all my portfolios?" / "review my portfolio" | **Yes (medium)** | A holistic review synthesizes return, fees, build, and tax into a judgment — not a single retrieval. The `review` / `health_review` / `score_review` (Discuss) intents map here. |
| "My Tax portfolio's return is low — what should I do next?" | **Yes** | Diagnose *why* it lags, then plan a prioritized next step. The `plan` intent + the diagnose-return / next-step phrase patterns map here. |

The rule of thumb: **reason when the answer requires combining several facts into
a judgment the tools didn't already calculate — not just because the topic is
finance.** A Macrotide-specific corollary: the more of that "complex math" we push
*into tools* (e.g. a future `compute_rebalance`), the less the model needs to
reason at all — cheaper *and* more reliable than mental arithmetic.

This was also measured from the model-selection side (A/B, May 2026): the popular
cheap Chinese models (GLM / MiMo / Qwen-flash / MiniMax / Kimi / Step / DeepSeek)
are **reasoning models** tuned for coding/agentic benchmarks — for a chat turn
they reason by default and run **8–29s** (and token-heavy), vs **~2s** for a
non-reasoning model like `gemini-2.5-flash-lite`. Pinning `reasoning:{effort:none}`
cut the slowest of them 2–4× with no reliability loss.

### The policy

**Disabled on the cost-sensitive paths.**
The free tier, demo, and the ancillary title/extract calls send
`reasoning:{effort:"none"}` (`openrouter()` in `lib/ai/provider.ts`), so a
reasoning-capable model the router lands on doesn't burn hidden chain-of-thought
(billed at the output rate) on a turn that doesn't need it. Free stays pinned to
`none` **even when the intent gate would raise it** — it is the cost-protected
path. Non-reasoning models ignore the flag. Beware the multiplier when you *do*
raise effort: at `high` OpenRouter allocates ~80% of `max_tokens` to reasoning,
so keep `max_tokens` tight (the free tier is already 1024).

**Gate higher effort behind analytical intent — shipped.**
The owner/trusted paths no longer inherit model-default reasoning; a cheap,
deterministic classifier (`classifyReasoningIntent`, `lib/advisor/intent.ts`)
reads the user's turn plus the `EntryContext.intent` and sends `effort:"medium"`
on genuine multi-step asks (rebalance, SSF-vs-RMF, a plan-anchored tilt) and
`effort:"none"` otherwise — so reasoning rates are paid only where they buy
something. The route consults it once per turn and passes the effort to
`resolveOwnerProvider`/`resolveTierProvider`; `REASONING_GATE=off` restores
model-default behavior. The classifier is pure (no model call) — the whole point
is to avoid paying to decide whether to pay. It errs toward `none`: only strong
signals of multi-step judgment flip it on.

*Measured (committed eval, `gemini-2.5-flash`, complex tier, n=2):* `medium`
lifted answer quality 78%→88% — and on the SSF-vs-RMF turn it was the difference
between answering from nothing and actually planning the `find_funds` calls — at
~3.5× latency (2.4s→8.3s) and ~2.7× cost. That premium is exactly why the gate
exists: pay it on the few turns that earn it, not every turn. Re-run with
`EVAL_TIER=complex EVAL_REASONING=medium` vs `none` before retuning the trigger
set. Use `reasoning:{exclude:true}` to hide chain-of-thought from the UI (still
billed) if a reasoning trace is ever surfaced, and verify per-model that
`reasoning_details` is actually returned — some silently drop it.

**Never high/max effort on structured-output paths.**
Anthropic warns `max` overthinks structured tasks — costing more *and* risking
corrupt strict JSON. The holdings-confirmation table and the image-OCR extract
must run at `low`/`medium`. And don't add "think step by step" boilerplate for
reasoning-capable models — it's documented as unnecessary and wastes input tokens.

## 4. Context-loading strategy

**Keep just-in-time tool reads as the default; the envelope is the right
complement.**
"Maintain lightweight identifiers, hydrate via tools" is exactly what the
[entry-context envelope](./advisor-context.md) does — it passes the subject + on-
screen signals as facts and lets the portfolio/catalog tools recover depth. That
both cuts tool hops (fewer chances to stall) and keeps the small model's tighter
window from rotting. Extend the envelope to remaining findings as they gain on-
screen figures; keep open-ended kickoffs prose-only (correct as designed). The
reserved `image` slot is the forward-compatible home for in-chat vision.

**App-layer compaction, not a provider primitive.**
Server-side compaction (Anthropic `compact_20260112`, OpenAI `compact_threshold`)
is vendor-specific and behind beta headers; OpenRouter normalizes to a chat-
completions surface, so you can't depend on it across the free chain. Macrotide
already summarizes-and-archives over the same key — treat provider-native
compaction as a bonus, not a dependency. Tune by maximizing recall first, then
precision.

**Lean on the memory file as the durable source of truth.**
The memory block persists durable facts (risk tolerance, THB base currency,
response prefs) in the DB, so they survive the free-tier empty-turn drop — state
lives in the store, not only the volatile transcript. Re-inject only the relevant
slice each turn.

**Sub-agent isolation only for token-heavy batch tasks.**
A "scan N filings / look-through funds and summarize exposure" task fits a sub-
agent that explores in its own window and returns a 1–2k-token distilled result —
but multi-agent systems use ~15× the tokens of a single chat, so only justify it
when the quality gain is real. Ordinary Q&A stays single-window. For Macrotide's
mostly-structured corpus, prefer agentic SQL/grep queries over standing up a vector
DB (the "keyword search ≈ 90% of RAG without a vector DB" result supports skipping
the index), aligned with the [app.db / market.db split](./architecture.md).

## 5. Tool-result shaping

**Shape tool outputs to a compact, model-legible subset — highest-leverage move
for a small model.**
`read_portfolio` returns a large structured object today (flagged in
[advisor-context.md](./advisor-context.md)). Return only the few fields the answer
needs — allocation, drift, blended TER, the headline figure — not the raw blob.
Anthropic's own `concise` vs `detailed` example cut a tool result ~66% (≈72 vs 206
tokens). In AI SDK 6, implement `toModelOutput` per tool so the model-facing view
diverges from the rich object the app keeps. This directly reduces context rot and
the free-tier dead-end rate.

**Return instructive errors as results, not exceptions.**
A rate limit or missing symbol should come back as `is_error`-style content with
actionable text ("Rate limit exceeded, retry after 60 seconds" / "No quote for
TICKER — suggest the user check the symbol"), so a small model can recover or fail
gracefully rather than throwing and producing an empty turn. The AI SDK surfaces it
as `tool-error` parts; Anthropic + MCP both endorse the pattern.

**Keep the tool surface small, namespaced, unambiguous.**
~10 tools today — well under the ~20-tool soft cap where both Anthropic and OpenAI
report accuracy degrades. Favor clarity over breadth; avoid overlapping reads and
ambiguous param names. Deferred/lazy tool loading (`tool_search`/`defer_loading`)
is a >20-tool problem Macrotide doesn't have. Parallel tool calls are default-on;
keep them unless a cheap model garbles batches.

## 6. Structured output & citations

**Tool-call-as-extraction + client-side Zod re-validation is the portable floor.**
Cheap free-tier models may lack a native `json_schema` / `response_format` mode —
this is the one structured-output claim with no primary anchor for the free chain,
so treat it as **untested** (verify via
`openrouter/models?supported_parameters=structured_outputs` before relying on it).
The lowest common denominator works everywhere: define one tool whose schema *is*
the target (holdings table, OCR extract), force `toolChoice`, read validated args,
and **always** re-validate with Zod + a `jsonrepair` fallback. AI SDK 6 deprecates
`generateObject`/`streamObject` in favor of `generateText` + `Output.object`, and
OpenAI `strictJsonSchema` now defaults to `true`.

**Design extraction schemas to the strictest provider's intersection.**
So one schema works across the whole route fleet: ≤5 nesting levels (OpenAI), ≤20
strict tools / ≤24 optional params (Anthropic), scalar-only enums, no
`minLength`/`pattern`/`minimum`, and **avoid recursive schemas** (OpenAI allows
them, Anthropic doesn't). Optionals as nullable unions with
`additionalProperties:false` + all-required. Reusing identical schemas keeps the
provider grammar caches warm.

**Split the pipeline for structured-data-plus-citations.**
Anthropic Citations and Structured Outputs are **mutually exclusive** (a 400 if
both set). For "show the user where this figure came from" on an uploaded
statement, run two calls: one extracts structured data, one produces cited prose —
`cited_text` is free on tokens and points at real spans, a strong fit for the
statement-import UX *if* Anthropic is ever pinned. For market/news grounding, gate
web search behind explicit user intent (Gemini 3 bills per query). Moot on the free
chain today, which has no Anthropic route.

## 7. Evaluation

Every lever above is a hypothesis ("flash-lite is good enough", "reasoning helps
complex turns", "shaping cuts dead-ends") — the eval is how we **measure** it
before shipping, instead of guessing. The prior art is surveyed in
[research/agent-evals.md](./research/agent-evals.md); this is the decision.

**What we measure.** A committed harness (`scripts/eval/`) runs a fixed question
set over a **hermetic synthetic tool surface** (`EXAMPLE-FUND-*`, never the live
DB) in two tiers — *retrieve-then-explain* (the common path) and *complex
multi-step* (rebalance, SSF-vs-RMF, a plan-anchored tilt) — using the exact
production system prompt and OpenRouter wiring. Four metric families:
deterministic **quality** (three separately-reported sub-signals: grounded-facts
/ tool-trace / no-hallucination), **dead-end rate** (the empty-turn dead-end, its own
gated metric — never a zero folded into quality), **latency / token / cost**, and
**reliability across runs** (`pass^k` — the fraction of questions where *all* N
runs pass, the number a single-run mean hides).

**How we grade.** A **deterministic floor** (`mustInclude` / `anyOf` /
`mustNotInclude` / `expectTools` / `mustNotCallTools` / `expectToolArgs` /
`maxSteps`) — fast, reproducible, and it survives model swaps, so it's the
regression gate. It grades not just *which* tools were called but *with what
arguments* (e.g. the fee-switch question asked about the fund the user actually
holds) and *over how long a trajectory* (a lookup that loops to five generations
is thrashing), and it includes a **negative control** — an empty-holdings turn
where the only correct answer is "you have no holdings yet" and naming a fund is a
hallucination, so the harness rewards *refusing* as well as answering. An **LLM-as-judge** layer is deliberately
*deferred*: the floor already gates regressions, and an uncalibrated judge adds
cost and bias, not signal (it earns its place only once observed grader-vs-human
disagreement justifies it — see the survey).

**How we decide.** Acceptance criteria are **pre-declared** per tier (`THRESHOLDS`
in `run.ts`: dead-end ≤5% retrieve / ≤15% complex, grounded-facts ≥80%/≥60%,
hallucination = 0) so a run yields a PASS/FAIL verdict, not a vibe; `EVAL_GATE=on`
makes a breach exit non-zero for a pre-change check. Use `EVAL_N≥3` for any
comparison (a single run conflates model variance with capability): quality is
reported with a **95% confidence interval** so a gap that's only run-variance is
visible, and `eval:diff` compares two result files — score deltas, pass^k flips,
and a **paired McNemar test** over the shared question set — so a before/after
A/B is mechanical and only calls a winner when the flips are significant. Each
result file is tagged with its git SHA. The run hits the live API and **stays out
of CI** (a token-free vitest guards the harness structure there).

**When we run it.** Before flipping `FREE_TIER_MODEL`, editing the system prompt,
or changing the reasoning budget (§3) — exactly the changes whose effect a single
manual test would misjudge. The reasoning-gate decision in §3 was made this way:
the complex tier measured `medium` reasoning at +10pp quality for ~3.5× latency,
which is *why* the gate pays it only on the turns that earn it. The question set
is a small **golden set**: frozen once baselined, extended (not loosened) over
time — see [scripts/eval/README.md](../../../scripts/eval/README.md).

> Doc map: [research/agent-evals.md](./research/agent-evals.md) (the evidence) ↔
> this section (the decision) ↔
> [scripts/eval/README.md](../../../scripts/eval/README.md) (the operation).

---

## Related

- [research/llm-platform-primitives.md](./research/llm-platform-primitives.md) —
  how providers expose tools, system prompts, reasoning, structured output.
- [research/context-and-caching.md](./research/context-and-caching.md) — the
  caching cost/latency math and context-window management.
- [research/context-engineering.md](./research/context-engineering.md) — the
  tool-use loop, failure modes, and the empty-turn recovery.
- [research/agent-evals.md](./research/agent-evals.md) — how to evaluate a
  tool-using agent (the triple, graders, `pass^k`, LLM-judge); evidence for § 7.
- [advisor-context.md](./advisor-context.md) — the three context channels, the
  entry-context envelope, and the per-turn cache-safe injection rule.
- [configuration.md § AI / model selection](../reference/configuration.md#ai--model-selection)
  — the model + cap env vars.
