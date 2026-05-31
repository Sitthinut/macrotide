# Advisor context model

*Last updated: 2026-05-31*

> **Status: living doc, mixed maturity.** The [turn-reliability](#turn-reliability-the-empty-turn)
> recovery is **shipped** (issue #21); the structured
> [context envelope](#proposed-the-context-envelope) and the per-entry-point
> contract are still a **design target** the entry-point audit is steering toward.
> Each section says which it is. Trust the code over the doc and fix the doc when
> they disagree. The external best-practice survey behind these choices is
> [research/context-engineering.md](./research/context-engineering.md).

How does the Advisor know what you're looking at when you tap **Ask advisor**?
This page is the single answer to that question: one coherent notion of *what
the Advisor knows about your current screen and portfolio*, and the contract
each entry point honours when it hands off. It's the foundation the
context-aware chatbar suggestions build on, so the model is written to be
explicit and reusable rather than implicit in each button.

For the voice rules behind the persona, see
[design-principles.md § The AI is "Advisor"](./design-principles.md#the-ai-is-advisor).
For what the Advisor remembers *across* chats (durable preferences, notes), see
[memory.md](./memory.md) — this page is about the *current turn's* context, not
long-term memory.

## The three context channels

Everything the Advisor knows on a given turn arrives through exactly three
channels. Keeping them distinct is what stops "context" from becoming a vague
catch-all.

| Channel | What it carries | Where it lives | Lifetime |
|---|---|---|---|
| **Memory block** | Durable user facts — goals, risk tolerance, response preferences | Prepended to the system prompt (`composeSystemPrompt`, `app/api/chat/route.ts`) | Frozen for the session |
| **Tool reads** | The user's *real* live data — holdings, drift, fees, performance, plan, journal, fund catalog | Pulled on demand by the model via `lib/advisor/tools.ts` | Fetched per call |
| **Entry-point context** | *Why this chat started* — the screen, the holding/fund/finding in focus, the figures already on screen | The user message text (today) | This turn only |

The first two are well-modelled. The memory block is bounded and visible
([memory.md](./memory.md)); the tool reads return deterministic structured data
(`read_portfolio` returns allocation, drift, blended TER, concentration, cash
drag — see `lib/advisor/tools.ts`). **The third channel is the weak one**, and
it's what the entry-point contract below exists to fix.

## How entry-point context flows today

Every "Ask advisor" surface in the UI funnels through a single seam: a
`window` `CustomEvent("ai-prompt", { detail })` (dispatched from the screens),
caught in `components/App.tsx`, which sets `pendingPrompt` and routes to the
chat. `ChatScreen` consumes it as a **`SeedPrompt`**:

```ts
// components/screens/ChatScreen.tsx
export type SeedPrompt = string | { display: string; send: string };
```

A bare string is shown verbatim as the user's bubble and sent as-is. The
`{ display, send }` split lets a short visible bubble ride alongside a larger
hidden payload (used today only by the image-OCR handoff, where the raw
transcription goes in `send` but stays out of the visible body).

The seed is then sent to `POST /api/chat` as part of an ordinary chat request
whose body is **only `{ messages, threadId }`** (`ChatScreen.tsx`, the `askLive`
fetch). There is no structured side-channel: **all entry-point context is
smuggled inside the prose of the user message.** That single fact explains every
thin-context symptom below.

### What "thin" means

A thin entry point hands the Advisor a sentence that *names* a subject but
withholds the structured facts the screen already had in hand. The Advisor then
has to (1) parse the subject back out of the prose, (2) decide to call the right
tool to re-fetch what the screen already knew, and (3) write a final answer.
Each of those is a step that can fail — see the [turn-reliability](#turn-reliability-the-empty-turn)
section. Rich-but-prose entry points avoid step 2 for the headline figure but
still pay for steps 1 and 3.

## The per-entry-point contract

The contract is the same for every surface: **pass the structured subject and
the figures already on screen, not just a sentence that mentions them.** Until a
structured side-channel exists (see [the proposed context envelope](#proposed-the-context-envelope)),
the interim contract is "put every figure the screen knows into the seed so the
Advisor never has to re-derive it." The target contract is "pass an
`entryContext` object so the Advisor *and* the suggestion engine read the same
structured facts."

### Audit of current entry points

| Entry point | File | Trigger | Context passed today | Verdict |
|---|---|---|---|---|
| Fund-row shortcut | `components/FundSelect.tsx` (`handleAskAdvisor`) | Tap the chat icon on a fund row | Fund **abbreviation only**, templated into a sentence | **Thin** — no projId, asset class, TER, index flag, or "do I hold this?" |
| Portfolio headline ("Discuss") | `components/screens/PortfolioScreen.tsx`; mirrored in `components/AppPanels.tsx`; prompt built in `lib/portfolio/health.ts` (`summarizeHealth`) | Tap **Discuss** on the "Top thing to know" card | The headline figure as prose (e.g. drift pp, target name) | **Rich-but-prose** — figures are there but flattened; no structured handle, no "which finding" |
| Suggested rebalance | `components/screens/PortfolioScreen.tsx` (rebalance card) | Tap **Plan the rebalance** | Tracking gap pp + target model name, as prose | **Rich-but-prose** — trim/add tickers shown on screen are *not* in the seed |
| Fee-creep finding | `components/screens/PortfolioScreen.tsx` (fee-creep card) | Tap **Ask advisor** on a fee finding | Held ticker, held TER, one alternative + its TER, asset class — as prose | **Rich-but-prose** — the richest entry point; still no projIds for a clean tool lookup |
| Journal suggested question | `components/screens/JournalScreen.tsx` | Tap a parsed question chip | The bare question string (editorial content) | **Thin by design** — generic, but carries zero portfolio handle |
| Model-portfolio explainer | `components/screens/ModelPortfoliosScreen.tsx` | "Ask the advisor about this" on a model | Model name, as prose | **Thin** — model id and its mix/TER are on screen, not in the seed |
| Custom-allocation kickoff | `components/screens/ModelPortfoliosScreen.tsx` (`startChat`) | "Help me design an allocation" | Fixed generic sentence | **Intentionally open** — kicks off a Q&A; no subject to pass |
| Free-typed chat | `components/screens/ChatScreen.tsx` (chat input) | User types directly | Whatever the user wrote | N/A — the user *is* the context |
| OCR / image handoff | image-import flow → `SeedPrompt.send` | Hand off a transcribed statement | `display` bubble + raw transcription in `send` | **Modelled** — the only entry point already using the split payload deliberately |

The pattern: the catalog (`FundSelect`, model explainer) entry points are thin;
the dashboard (`PortfolioScreen`) entry points are rich-but-prose. None of them
pass a *structured* handle, so even the rich ones force the Advisor to re-fetch
via tools to act (e.g. `find_cheaper_alternatives` needs a projId or abbr it has
to parse back out of the sentence).

> **Note — the catalog tools already exist.** `find_funds`,
> `find_cheaper_alternatives`, and `getFundsByAbbr` (all in `lib/advisor/tools.ts`)
> let the Advisor *recover* a fund from an abbreviation. So a thin `FundSelect`
> seed is recoverable — but only if the small free-tier model reliably parses the
> abbr, calls the tool, and then writes prose. The contract removes that gamble
> by handing the structured subject over directly.

## Proposed: the context envelope

The target model adds a fourth, structured field to the chat request so
entry-point context stops travelling as prose:

```ts
// Shape sketch — the structured entry-point context channel.
interface EntryContext {
  screen: "portfolio" | "funds" | "markets" | "journal" | "models" | "chat";
  // The subject in focus, if any. Discriminated by `kind`.
  subject?:
    | { kind: "fund"; projId: string; abbr: string; assetClass?: string; ter?: number; indexOnly?: boolean; held?: boolean }
    | { kind: "holding"; ticker: string; pct?: number; ter?: number }
    | { kind: "finding"; type: "rebalance" | "fee_creep" | "concentration" | "cash_drag"; figures: Record<string, number | string> }
    | { kind: "model"; modelId: string; name: string };
}
```

The seed `display` string stays for the visible bubble (so the user sees a
natural sentence), but the structured `EntryContext` rides alongside it and is
sent to `/api/chat` as a typed field next to `messages` and `threadId`. The
server renders it into a compact, deterministic context preamble for the model —
the same way the memory block is prepended — so the figures arrive as *facts*,
not as a sentence the model has to trust and re-derive.

Two properties make this reusable beyond the buttons:

1. **One subject vocabulary.** `fund` / `holding` / `finding` / `model` is the
   same set the context-aware chatbar suggestions need to answer "what should I
   ask about *this* screen?" Both features read the same `EntryContext` rather
   than each re-deriving "what's in focus."
2. **No personal data leaks into the seam.** `EntryContext` carries handles
   (projId, ticker, modelId) and on-screen figures — never cost basis or account
   identifiers beyond what the screen already shows. The Advisor still reads
   *live* private data through the per-user-scoped tool layer, never through this
   envelope.

This is a design target, not shipped wiring. The request body is `{ messages,
threadId }` today; adding the envelope is the implementation step that the
entry-point audit motivates.

## Turn reliability: the empty turn

The context model and the "I didn't have a reply" dead-end are the same problem
from two directions — what reaches the model isn't enough to *finish* a turn — so
the diagnosis and the fix live here. **This part is shipped** (issue #21); the
structured envelope above is still a target.

An **empty turn** is when the model runs a read tool (e.g. `read_portfolio`) and
then *stops without emitting a final prose step*. The client
(`components/screens/ChatScreen.tsx`) sees no accumulated text; before the fix it
surfaced as *"I didn't have a reply for that."*

### What actually causes it (investigated 2026-05)

The cause is **free-tier model/provider reliability**, confirmed by local
reproduction with per-turn logging. `logEmptyTurn` (`app/api/chat/route.ts`)
records, on any empty turn, the model OpenRouter actually routed to, the
`finishReason`, each step's reason, and which tools ran. It shows three flavours:

- **Read-then-stall** — the model calls a read tool and ends with no prose
  (`finishReason=stop`/`tool-calls`, empty text). The dominant flavour.
- **Tool looping** — the model keeps calling tools without answering.
- **Provider error** — the free router errors mid-generation (`finishReason=error`,
  or a hard error where the turn produces nothing).

Three tempting explanations were **tested and ruled out**:

- *Not a DB-context bug.* The advisor tools run with the correct request context
  (a demo turn's tools see the session's in-memory DB, `isDemo=true`) —
  AsyncLocalStorage propagates into tool execution; only `onFinish` runs outside
  it, which is why it re-enters via `runWithDbContext`. The tools return cleanly;
  they don't throw.
- *Not one weak model.* The dead-end hits several distinct `…:free` models and
  the `openrouter/free` router, so pinning a single "stronger" free model does
  **not** fix it.
- *Not the tool surface.* A faithful standalone harness — same model, system
  prompt, and full 14-tool surface — answers reliably when the tools' results
  come back cleanly. The trigger is real free-tier generation/routing flakiness,
  not tool count.

The trusted/owner chain (`openrouter/free → openrouter/auto`) barely sees this
because it has the paid `auto` fallback the free tier deliberately lacks.

### The fix: recover, don't depend on the model

Because no single free model is reliable, the fix is **model-agnostic
resilience** rather than model selection. `streamAdvisorResponse()`
(`app/api/chat/route.ts`) wraps every tier (demo/tiered/owner) with two safety
nets, composed into one response stream via `createUIMessageStream`:

1. **Recover-on-empty.** When a turn produces no prose but a tool ran, issue one
   follow-up generation seeded with the gathered tool results and **no tools** —
   so the model can only write the answer. This is the documented production fix
   for read-then-stall (see
   [research § the agentic tool-use loop](./research/context-engineering.md)); it
   works regardless of which free model stalled.
2. **Retry-on-error.** A provider error gathers nothing to recover from, so the
   turn is re-rolled once (the router picks a fresh model).

Local demo-path testing took the dead-end rate from roughly a fifth-to-half of
tool-using turns down to ~4%. The residual is a *double* provider failure (the
retry also failed), which only a more reliable model removes. The custom
`ChatScreen` reader concatenates all text-deltas into a single bubble and ignores
stream-envelope chunks, so the recovered/retried generation renders as one
coherent message.

### Still open

- **A cheaper, more reliable model for the free tier.** A cheap *paid* model
  (Gemini-Flash / GPT-4o-mini / Haiku class) would remove most dead-ends at the
  source — but it changes the pinned-free cost invariant (`FREE_TIER_MODELS` in
  `lib/ai/provider.ts`) and needs usage limits first. Tracked on the board; the
  recovery above stays as the belt-and-suspenders either way.
- **Tool-result shaping.** Returning a compact, model-legible subset instead of
  the full rich object lifts small-model reliability further
  ([research § tool design for reliability](./research/context-engineering.md)).
  `read_portfolio` returns a large structured object today; a trimmed
  model-facing view is a clean follow-up.
- **Reducing the tool hops.** The structured
  [context envelope](#proposed-the-context-envelope) removes the "re-fetch what
  the screen already knew" step for common entry-point flows — fewer multi-step
  hops means fewer chances to stall in the first place.

## Related

- [Memory](./memory.md) — what the Advisor knows *across* chats (the memory
  channel above).
- [Architecture § request lifecycle](./architecture.md) — how a chat request
  flows server-side, demo/owner DB routing, the `onFinish` re-entry pattern.
- [Design principles](./design-principles.md) — the "Advisor" voice and
  secure-by-default posture.
- `lib/advisor/tools.ts` — the tool-read channel (the second context channel).
