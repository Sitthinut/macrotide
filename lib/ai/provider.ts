import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

/**
 * AI provider routing. Two configurations, both via OpenRouter:
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
 *
 * Configure via env (comma-separated, first is primary, rest are fallbacks):
 *   AI_MODELS=openrouter/free,openrouter/auto
 *   DEMO_AI_MODELS=openrouter/free
 */

export interface ResolvedProvider {
  model: LanguageModel | null;
  /** True when AI is wired up; false means /api/chat should return a fallback. */
  ready: boolean;
  /** Display name for telemetry / UI banners. */
  label: string;
}

const OWNER_DEFAULT = ["openrouter/free", "openrouter/auto"];
const DEMO_DEFAULT = ["openrouter/free"];

function parseModels(value: string | undefined): string[] | null {
  if (!value) return null;
  const list = value
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function openrouter(apiKey: string, models: string[]): LanguageModel {
  const [primary, ...rest] = models;
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer": process.env.PUBLIC_APP_URL ?? "https://macrotide.local",
      "X-Title": "Macrotide",
    },
    // OpenRouter accepts a `models: [primary, ...fallbacks]` body field; tries
    // each in order if the previous one fails. Only inject when there's an
    // actual fallback list — single-model requests stay clean.
    fetch:
      rest.length === 0
        ? undefined
        : async (input, init) => {
            if (init && typeof init.body === "string") {
              try {
                const body = JSON.parse(init.body);
                body.models = models;
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

export function resolveOwnerProvider(): ResolvedProvider {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "OpenRouter (no key)" };
  const models = parseModels(process.env.AI_MODELS) ?? OWNER_DEFAULT;
  return { model: openrouter(key, models), ready: true, label: chainLabel("OpenRouter", models) };
}

export function resolveDemoProvider(): ResolvedProvider {
  const key = process.env.DEMO_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY;
  if (!key) return { model: null, ready: false, label: "Demo (no key configured)" };
  const models = parseModels(process.env.DEMO_AI_MODELS) ?? DEMO_DEFAULT;
  return { model: openrouter(key, models), ready: true, label: chainLabel("Demo", models) };
}
