import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * AI provider routing. Two distinct configurations, both backed by OpenRouter
 * so we only manage one provider abstraction:
 *
 * - **owner**  — authenticated users hit `OPENROUTER_API_KEY` with whichever
 *                `AI_MODEL` is configured. Default model is the OpenRouter
 *                `auto` router so OSS forks work out of the box.
 * - **demo**   — demo sessions hit a separate `DEMO_OPENROUTER_API_KEY`
 *                (can be the same key — separation lets you swap it for a
 *                free-quota key in production). Defaults to `openrouter/free`
 *                which round-robins across ~25 zero-cost models.
 *
 * Why one provider: OpenRouter already proxies every major model
 * (Anthropic / OpenAI / Google / Meta / Mistral / DeepSeek / Qwen). Adding
 * a second SDK provider would duplicate config without unlocking models.
 * Bring-your-own-provider can be wired locally without touching this file
 * (see `experiments/` patterns; nothing pushed to git).
 */

export interface ResolvedProvider {
  model: LanguageModel | null;
  /** True when AI is wired up; false means /api/chat should return a fallback. */
  ready: boolean;
  /** Display name for telemetry / UI banners. */
  label: string;
}

function openrouter(apiKey: string, modelId: string): LanguageModel {
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer": process.env.PUBLIC_APP_URL ?? "https://tidemark.local",
      "X-Title": "Tidemark",
    },
  });
  return provider(modelId);
}

export function resolveOwnerProvider(): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return { model: null, ready: false, label: "OpenRouter (no key)" };
  }
  const modelId = process.env.AI_MODEL ?? "openrouter/auto";
  return { model: openrouter(key, modelId), ready: true, label: `OpenRouter · ${modelId}` };
}

export function resolveDemoProvider(): ResolvedProvider {
  const key = process.env.DEMO_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key) {
    return { model: null, ready: false, label: "Demo (no key configured)" };
  }
  // Demo defaults to OpenRouter's free router — picks a free-tier model per
  // request, no billing impact. Override with DEMO_AI_MODEL if you want a
  // specific free model id (e.g. "meta-llama/llama-3.3-70b-instruct:free").
  const modelId = process.env.DEMO_AI_MODEL ?? "openrouter/free";
  return { model: openrouter(key, modelId), ready: true, label: `Demo · ${modelId}` };
}
