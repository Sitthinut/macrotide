# In-chat vision

The Advisor can see images a user attaches in chat. Two jobs, one capability:

1. **Holdings from screenshots.** A user drops a portfolio summary, a transaction
   history, and/or per-holding detail screens; the Advisor reads and reconciles
   them into one set of positions, derives missing units / average cost where the
   data supports it, and asks for anything it can't read.
2. **Visual Q&A.** A user attaches a chart, graph, or factsheet and asks about it;
   the Advisor answers in prose with nothing to extract.

This is distinct from the **Add-holdings image importer** (the *Image* tab of the
Add-holdings sheet), which sends one screenshot to a pinned, tier-agnostic
extractor. In-chat vision puts the image in front of the *chat model itself* so it
can reason across several images and hold a conversation about the gaps — which a
single-shot extractor can't.

## How an image turn flows

The image rides the message, not a side channel. The stack carries it natively:

```
composer (downscaled image → UIMessage file part, data URL)
  → POST /api/chat
  → convertToModelMessages  (file part → ModelMessage image part)
  → @ai-sdk/openai-compatible  (→ OpenAI-style image_url)
  → OpenRouter → vision model
```

The client sends the **whole conversation as UIMessage `parts`** only when the
current turn has images; text-only turns keep the compact `{role, content}` string
shape byte-for-byte, so the model prefix cache stays warm. The route detects an
image turn on the raw body (`countTurnImages`, [lib/advisor/image-turn.ts](../../lib/advisor/image-turn.ts))
before model-message conversion.

## Model routing — a dedicated vision model

The trusted/public chat chains (`TRUSTED_TIER_MODELS` / `PUBLIC_TIER_MODELS`) may resolve to
text-only models, so an image turn routes to its own `VISION_CHAT_MODEL`
(default `google/gemini-2.5-flash`, the family the OCR importer already proves
out) via `resolveVisionProvider` ([lib/ai/provider.ts](../../lib/ai/provider.ts)).

This is the same shape as the `PUBLIC_TIER_MODELS` invariant, and for the same
reason: **public-tier vision derives from its own var, never from `TRUSTED_TIER_MODELS`** — so
enabling vision can't widen the text model chains. The decision per turn
(`visionDecisionFor`) is:

| Path | Image turn |
| --- | --- |
| owner / trusted | vision model (trusted keeps the intent-gated reasoning effort) |
| public | vision model, **bounded by the daily token + optional cents caps** (reasoning pinned `none`) |
| demo | **stub unless `DEMO_VISION` is set**; when on, uses the demo key, bounded by the 10-turn cap |
| any, `VISION_CHAT_MODEL=off` | stub pointing at the Add-holdings importer |

The chat route is the source of truth (it stubs unavailable image turns);
`GET /api/chat/capabilities` exposes the same decision so the composer can hide
the attach button when image upload isn't available for the session.

## Output: table for many, card for one

When the Advisor extracts **two or more** holdings it calls
`propose_holdings_import` ([lib/advisor/tools.ts](../../lib/advisor/tools.ts)),
which derives rows via the shared `deriveRowsWithNav`
([lib/portfolio/derive-rows.ts](../../lib/portfolio/derive-rows.ts), also used by
the import route) and emits a compact in-chat table. "Review & import" opens the
full importer pre-seeded (through [lib/stores/import-seed.ts](../../lib/stores/import-seed.ts))
for bulk edit and save. A **single** position uses the existing one-tap
`propose_holding` card. Both only propose — nothing is written until the user
accepts.

## Persistence: ephemeral on the server, browser-only for the session

Attached images are **never stored server-side.** The user message persists as
its text plus a `[N image(s) attached]` marker (`withImageMarker`). The durable
artifacts of an image turn are the *accepted holdings* and the *Advisor's reply* —
not the raw screenshots, which are sensitive broker data.

For continuity within a session, the client caches downscaled copies in
localStorage ([lib/stores/chat-images.ts](../../lib/stores/chat-images.ts)),
keyed by `threadId:seq` (the user message's index in the thread — deterministic on
both the send and reload paths, so they re-attach without a server image id),
size-bounded with oldest-first eviction. A muted disclaimer states images stay in
the browser and are sent to the Advisor to answer, not stored on the server. See
[SECURITY.md](../../SECURITY.md).

## Cross-turn context: carry the transcript, not the bytes

An image is only sent to the model on the turn it is attached. Re-sending the
bytes on every follow-up would re-run the unreliable vision path each time and
bust the prompt cache — so instead, on attach the image is transcribed ONCE to
plain text (`POST /api/chat/transcribe` → `extractHoldingsFromImage`, the same
model). That transcript rides on the `ChatImage` (persisted, unlike the bytes),
and on later turns `imageText()` folds it into that turn's text as a
`[Attached image, transcribed …]` block. Follow-ups therefore read the image as
cheap, cache-stable text on the recoverable text path; the vision call happens
exactly once. The system prompt tells the model to read that block and not ask
the user to re-upload — only re-sharing for genuine visual detail a transcript
can't capture (a chart's shape). Grounded in
[context-engineering](./research/context-engineering.md) /
[inference-strategy](./inference-strategy.md) (high-signal tokens, run the flaky
path once, keep the prefix warm).

## Related

- [Advisor context model](./advisor-context.md) — what the Advisor knows per turn.
- [Inference strategy](./inference-strategy.md) — model routing, tiers, cost.
- [auth-and-providers.md § In-chat vision](../reference/auth-and-providers.md) —
  the env vars and spend bounds.
