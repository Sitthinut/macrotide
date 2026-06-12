import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * AI provider routing. Three configurations, all via OpenRouter:
 *
 * - **owner**  — authenticated traffic. Default model chain
 *                `openrouter/free → openrouter/auto`: try free models first,
 *                fall back to paid `auto` router only if every free model is
 *                unavailable. Keeps cost near zero in the happy path while
 *                preserving reliability when free tier is saturated.
 * - **demo**   — anonymous demo sessions. Default `openrouter/free` with **no
 *                fallback** — cost predictability matters more than uptime for
 *                demo traffic. If free is unavailable, demo errors cleanly
 *                rather than silently billing.
 * - **title**  — auto-titling a chat after its first turn pair. Default
 *                `openrouter/free`. Explicitly *not* Claude / GPT — a 3–5-word
 *                title doesn't justify mainstream-model spend.
 *
 * - **extract** — archive-time fact extraction. Default
 *                `openrouter/free`; same cheap-model posture as titling.
 *
 * Configure via env (comma-separated, first is primary, rest are fallbacks):
 *   TRUSTED_TIER_MODELS=openrouter/free,openrouter/auto
 *   DEMO_TIER_MODELS=openrouter/free
 *   TITLE_MODELS=openrouter/free
 *   EXTRACT_MODELS=openrouter/free   # optional; falls back to TITLE_MODELS
 */

export interface ResolvedProvider {
  model: LanguageModel | null;
  /** True when AI is wired up; false means /api/chat should return a fallback. */
  ready: boolean;
  /** Display name for telemetry / UI banners. */
  label: string;
}

const TRUSTED_TIER_DEFAULT = ["openrouter/free", "openrouter/auto"];
const DEMO_TIER_DEFAULT = ["openrouter/free"];
// Auto-titling a chat is a 3–5-word task. We deliberately don't burn
// Claude/GPT capacity on it — `openrouter/free` is the meta-router that
// fans out across cheap free models (DeepSeek, Qwen, etc.). Override with
// the `TITLE_MODELS` env var; pinning anything in the Claude or GPT family
// would be an escalation per AGENTS.md § AI / model selection.
const TITLE_MODELS_DEFAULT = ["openrouter/free"];
// Archive-time fact extraction. Same posture as titling — a
// background summarize-and-extract pass over an idle chat is an ancillary task
// that doesn't justify Claude/GPT spend. Override with `EXTRACT_MODELS`; falls
// back to `TITLE_MODELS` then `openrouter/free` so an operator who already
// pinned a cheap title model gets the same model for extraction for free.
const EXTRACT_MODELS_DEFAULT = ["openrouter/free"];

function parseModels(value: string | undefined): string[] | null {
  if (!value) return null;
  const list = value
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/** OpenRouter `reasoning.effort` levels (highest → lowest cost/latency). */
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

interface OpenRouterOpts {
  /**
   * OpenRouter `reasoning.effort`. `"none"` disables a reasoning model's hidden
   * chain-of-thought — which is billed at the output rate and adds large latency.
   * Set it on cost-sensitive paths (free/demo/title/extract) so a reasoning model
   * the router lands on doesn't silently reason on a trivial turn (measured 8–29s
   * vs ~2s). Omit it to inherit each model's default. Owner/trusted now pass a
   * per-turn effort gated by analytical intent (see lib/advisor/intent.ts):
   * `"none"` on retrieve-then-explain turns, `"medium"` on multi-step asks.
   * Non-reasoning models ignore it.
   */
  reasoningEffort?: ReasoningEffort;
}

function openrouter(apiKey: string, models: string[], opts: OpenRouterOpts = {}): LanguageModel {
  const [primary, ...rest] = models;
  const injectModels = rest.length > 0;
  const injectReasoning = opts.reasoningEffort !== undefined;
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer": process.env.PUBLIC_APP_URL ?? "https://macrotide.local",
      "X-Title": "Macrotide",
    },
    // OpenRouter takes a `models: [primary, ...fallbacks]` fallback list and a
    // `reasoning: { effort }` control as body fields. Only override fetch when we
    // actually need to inject one of them — a single-model, default-reasoning
    // request stays clean.
    fetch:
      !injectModels && !injectReasoning
        ? undefined
        : async (input, init) => {
            if (init && typeof init.body === "string") {
              try {
                const body = JSON.parse(init.body);
                if (injectModels) body.models = models;
                if (injectReasoning) body.reasoning = { effort: opts.reasoningEffort };
                init = { ...init, body: JSON.stringify(body) };
              } catch {
                // Body wasn't JSON — forward untouched rather than crashing.
              }
            }
            return fetch(input as RequestInfo, init);
          },
  });
  return provider(primary);
}

function chainLabel(prefix: string, models: string[]): string {
  return models.length === 1 ? `${prefix} · ${models[0]}` : `${prefix} · ${models.join(" → ")}`;
}

export function resolveOwnerProvider(
  opts: { reasoningEffort?: ReasoningEffort } = {},
): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "OpenRouter (no key)" };
  const models = parseModels(process.env.TRUSTED_TIER_MODELS) ?? TRUSTED_TIER_DEFAULT;
  // Effort is gated per-turn by intent in the route (undefined = model default).
  return {
    model: openrouter(key, models, { reasoningEffort: opts.reasoningEffort }),
    ready: true,
    label: chainLabel("OpenRouter", models),
  };
}

// The public tier chain derives ONLY from `PUBLIC_TIER_MODELS`, never from
// `TRUSTED_TIER_MODELS`, defaulting to OpenRouter's zero-cost meta-router. This
// preserves the cost/security invariant by construction: a slip in the trusted
// chain (`TRUSTED_TIER_MODELS`) can't widen public-tier access, because the
// public branch doesn't read it. Pointing the public tier at a cheap PAID model
// is a separate, conscious operator act (set `PUBLIC_TIER_MODELS`), and it's
// bounded by the daily token + optional cents cap — see lib/db/queries/usage.ts.
const PUBLIC_TIER_DEFAULT = ["openrouter/free"];

/**
 * Resolve the chat provider for a tier:
 *   - 'trusted' → the owner model chain (`TRUSTED_TIER_MODELS`, default
 *                 `openrouter/free → openrouter/auto`); identical to the owner
 *                 path.
 *   - 'public'  → `PUBLIC_TIER_MODELS` (default `openrouter/free`) ONLY. Reads
 *                 its own var, NEVER `TRUSTED_TIER_MODELS`, so the trusted chain
 *                 can't leak in.
 *
 * Both read the shared `OPENROUTER_API_KEY`; per-user keys are out of scope —
 * tier gating + the daily caps are what bound public-tier spend.
 */
export function resolveTierProvider(
  tier: "public" | "trusted",
  opts: { reasoningEffort?: ReasoningEffort } = {},
): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "OpenRouter (no key)" };
  if (tier === "trusted") {
    const models = parseModels(process.env.TRUSTED_TIER_MODELS) ?? TRUSTED_TIER_DEFAULT;
    // Trusted shares the owner chain AND the per-turn intent-gated effort.
    return {
      model: openrouter(key, models, { reasoningEffort: opts.reasoningEffort }),
      ready: true,
      label: chainLabel("Trusted", models),
    };
  }
  const models = parseModels(process.env.PUBLIC_TIER_MODELS) ?? PUBLIC_TIER_DEFAULT;
  // Public tier: ALWAYS pin reasoning off, ignoring any gated effort. Public is
  // the cost-protected path — a cheap model the router lands on must not reason
  // (slow + billed at the output rate) even on an analytical-looking turn. The
  // intent gate raises effort only for owner/trusted, who value (and fund) it.
  return {
    model: openrouter(key, models, { reasoningEffort: "none" }),
    ready: true,
    label: chainLabel("Public", models),
  };
}

export function resolveDemoProvider(): ResolvedProvider {
  const key = process.env.DEMO_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "Demo (no key configured)" };
  const models = parseModels(process.env.DEMO_TIER_MODELS) ?? DEMO_TIER_DEFAULT;
  // Demo: pin reasoning off — public, abuse-exposed, and on the free chain; it
  // should never burn reasoning latency/cost on a throwaway demo turn.
  return {
    model: openrouter(key, models, { reasoningEffort: "none" }),
    ready: true,
    label: chainLabel("Demo", models),
  };
}

// Inline chat vision (a turn that carries one or more attached images). The
// trusted/public chat chains (`TRUSTED_TIER_MODELS` / `PUBLIC_TIER_MODELS`) may
// resolve to text-only models, so an image turn routes here instead — to a
// SINGLE vision-capable model named by its OWN dedicated `VISION_CHAT_MODEL` var
// (default `google/gemini-2.5-flash`, the same family the pinned OCR extractor
// uses). Two deliberate consequences:
//   - The public-tier cost invariant is preserved by construction: public-tier
//     vision derives from `VISION_CHAT_MODEL`, NEVER from `TRUSTED_TIER_MODELS`,
//     exactly like `PUBLIC_TIER_MODELS`. Public image turns are bounded by the daily
//     token + optional cents caps enforced in the route before this is reached.
//   - Setting `VISION_CHAT_MODEL=off` (or empty) disables inline chat vision
//     entirely — the resolver returns not-ready and the route serves a stub that
//     points the user at the Add-holdings image importer.
const VISION_DEFAULT = ["google/gemini-2.5-flash"];

/** True when `VISION_CHAT_MODEL` explicitly disables inline chat vision. */
function visionDisabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "off" || v === "false" || v === "none" || v === "0";
}

/**
 * Resolve the provider for an image-bearing chat turn.
 *
 * - `demo: true` reads `DEMO_OPENROUTER_API_KEY` (falling back to the owner key)
 *   so demo vision never silently bills the owner key — mirrors
 *   {@link resolveDemoProvider}.
 * - `VISION_CHAT_MODEL` set to `off`/empty → not-ready (vision disabled).
 * - `reasoningEffort` is passed through; the route pins `"none"` for the free
 *   and demo paths (cost) and forwards the intent-gated effort for owner/trusted.
 */
export function resolveVisionProvider(
  opts: { reasoningEffort?: ReasoningEffort; demo?: boolean } = {},
): ResolvedProvider {
  const key = opts.demo
    ? (process.env.DEMO_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY)
    : process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "Vision (no key)" };
  const raw = process.env.VISION_CHAT_MODEL;
  if (visionDisabled(raw)) return { model: null, ready: false, label: "Vision (disabled)" };
  const models = parseModels(raw) ?? VISION_DEFAULT;
  return {
    model: openrouter(key, models, { reasoningEffort: opts.reasoningEffort }),
    ready: true,
    label: chainLabel(opts.demo ? "Vision (demo)" : "Vision", models),
  };
}

/**
 * Tiny model used for ancillary tasks where Claude/GPT capacity is overkill
 * — currently just auto-titling a chat after the first turn pair. Reads the
 * same `OPENROUTER_API_KEY` as the chat path but uses a separate model var
 * (`TITLE_MODELS`, default `openrouter/free`) so the operator can pin a
 * cost-efficient small model without affecting chat quality.
 */
export function resolveTitleProvider(): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "Title (no key)" };
  const models = parseModels(process.env.TITLE_MODELS) ?? TITLE_MODELS_DEFAULT;
  // Reasoning off — a 3–5-word title never needs chain-of-thought.
  return {
    model: openrouter(key, models, { reasoningEffort: "none" }),
    ready: true,
    label: chainLabel("Title", models),
  };
}

/**
 * Cheap model for archive-time extraction. Reads the shared
 * `OPENROUTER_API_KEY`. Model resolution order: `EXTRACT_MODELS` →
 * `TITLE_MODELS` → `openrouter/free`. Pinning a Claude/GPT-family model here
 * would be an escalation per AGENTS.md § AI / model selection — extraction is
 * a background, best-effort pass and should stay on cheap free models.
 */
export function resolveExtractorProvider(): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "Extract (no key)" };
  const models =
    parseModels(process.env.EXTRACT_MODELS) ??
    parseModels(process.env.TITLE_MODELS) ??
    EXTRACT_MODELS_DEFAULT;
  // Reasoning off — a background summarize-and-extract pass doesn't need it.
  return {
    model: openrouter(key, models, { reasoningEffort: "none" }),
    ready: true,
    label: chainLabel("Extract", models),
  };
}
