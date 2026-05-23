import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import type { QuoteSource } from "@/lib/market/sources";

/**
 * Image OCR for the "Add holdings" flow. The user uploads a broker-app
 * screenshot; we ask an OpenRouter vision model to transcribe what it sees
 * into plain text and return that string for downstream use — currently the
 * UI surfaces the transcription to the user, and in the future the advisor
 * agent will turn it into structured holdings rows via chat tool calls
 * ([[advisor-assist OCR — Phase 6 follow-up]] in ROADMAP).
 *
 * **Why pure transcription instead of structured JSON.** Earlier iterations
 * asked the model to return a Zod-validated `{ rows: ProposedRow[] }`. Free
 * and OCR-specialized vision models routinely failed at the structured-output
 * contract:
 *   - `qianfan-ocr-fast` doesn't support OpenRouter's structured-output flag.
 *   - Smaller Gemma / Llama free models return "Invalid JSON response".
 *   - Even capable models silently returned empty rows when their schema-
 *     following confidence was low (no signal back to the user about WHY).
 * Pure-text transcription compiles to a single `generateText` call that works
 * across every image-capable model. The reasoning that used to happen inside
 * the OCR call (which line is a ticker? which number is units vs. total
 * value?) is deferred to either the user (read the transcription, fill rows
 * manually) or a future advisor flow.
 *
 * Defaults to `openrouter/free`. Override with `OCR_MODEL` — see
 * `.env.example` for verified-working alternatives and the production
 * no-train guidance.
 */

export interface OcrInput {
  data: Buffer;
  mimeType: string;
}

export interface OcrResult {
  /**
   * Plain-text transcription of everything the model read from the image, in
   * reading order. Empty string when the model produced nothing usable —
   * the route still returns 200 in that case; the UI shows a "couldn't read"
   * empty state.
   */
  text: string;
}

/**
 * Shape of a holding row proposed to the user, kept here as the contract for
 * the future advisor-assist flow that will turn `text` into rows via chat
 * tool calls. Not produced by the OCR endpoint today — the route returns
 * `text` only.
 */
export interface ProposedRow {
  ticker: string;
  englishName?: string;
  units?: number;
  avgCost?: number;
  quoteSource: QuoteSource;
}

// Default to `baidu/qianfan-ocr-fast` — verified-working purpose-built OCR
// model on OpenRouter. ~$0.004 per call, no-train (suitable for production).
// Chose this over `openrouter/free` because OpenRouter's free vision pool
// repeatedly fast-fails with "No endpoints found that support image input"
// and the few free vision models that DO route (Gemma 4) hit upstream rate
// limits. A few mills per call is the right tradeoff for "actually works".
//
// To stay strictly free at the cost of reliability, set `OCR_MODEL=openrouter/free`
// (requires OpenRouter privacy setting to allow training-enabled providers).
const DEFAULT_OCR_MODEL = "baidu/qianfan-ocr-fast";

const SYSTEM_PROMPT = `You are an OCR transcription engine. Read the image and return EVERY line of visible text, in reading order. Preserve numbers, currency symbols, percent signs, and column structure exactly as they appear. Use newlines between rows of a table. Do not summarize, interpret, or add commentary — just transcribe.

If the image contains no readable text at all, return an empty string.`;

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

// Thai mutual fund share-class shape: at least one hyphen group of A-Z/0-9
// (e.g. K-FIXED-A, HIDIV-D, SCBS&P500-A). Single-token tickers like AAPL or
// dotted symbols like PTT.BK fall through to "yahoo". Kept here as the
// canonical heuristic for the future advisor-assist flow that turns
// transcribed text into structured holding rows.
const THAI_FUND_RE = /^[A-Z0-9&]+(?:-[A-Z0-9&]+)+$/;

export function inferQuoteSource(ticker: string): QuoteSource {
  return THAI_FUND_RE.test(ticker.trim().toUpperCase()) ? "thai_mutual_fund" : "yahoo";
}

function openrouterVisionModel(apiKey: string, modelId: string) {
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: {
      "HTTP-Referer": process.env.PUBLIC_APP_URL ?? "https://macrotide.local",
      "X-Title": "Macrotide OCR",
    },
  });
  return provider(modelId);
}

/**
 * Transcribe a broker screenshot to plain text.
 *
 * Returns `{ text: "" }` (not an error) when the model can't read the image —
 * the route handler treats an empty string as a successful "nothing recognized"
 * so the UI can show a friendly empty state.
 *
 * Throws `OcrProviderUnavailableError` on transport / auth / guardrail errors
 * so the route can surface a 502 with the provider's actual message.
 */
export async function extractHoldingsFromImage(input: OcrInput): Promise<OcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const modelId = process.env.OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
  const model = openrouterVisionModel(apiKey, modelId);

  try {
    const result = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe every line of text visible in this image, in reading order. Output the transcription only — no commentary.",
            },
            {
              type: "image",
              image: input.data,
              mediaType: input.mimeType,
            },
          ],
        },
      ],
    });

    return { text: (result.text ?? "").trim() };
  } catch (err) {
    if (isProviderError(err)) {
      throw new OcrProviderUnavailableError(extractProviderMessage(err));
    }
    return { text: "" };
  }
}

export class OcrProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrProviderUnavailableError";
  }
}

function isProviderError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? "";
  if (!name.startsWith("AI_")) return false;
  if (name === "AI_NoObjectGeneratedError") return false;
  const msg = (err as { message?: string }).message ?? "";
  if (/invalid json|schema validation|no object generated|parse/i.test(msg)) {
    return false;
  }
  return true;
}

function extractProviderMessage(err: unknown): string {
  // Walk top → lastError → cause looking for OpenRouter's structured error body.
  // The most informative field is error.metadata.raw (e.g. "google/gemma-4-31b-it:free
  // is temporarily rate-limited upstream..."); fall back to error.message.
  const candidates: unknown[] = [];
  const visited = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !visited.has(cur)) {
    visited.add(cur);
    candidates.push(cur);
    const c = cur as { lastError?: unknown; cause?: unknown };
    if (c.lastError && !visited.has(c.lastError)) {
      candidates.push(c.lastError);
      visited.add(c.lastError);
    }
    cur = c.cause;
  }
  for (const node of candidates) {
    const n = node as { responseBody?: unknown };
    if (typeof n.responseBody === "string") {
      try {
        const parsed = JSON.parse(n.responseBody) as {
          error?: { message?: string; metadata?: { raw?: string } };
        };
        const raw = parsed?.error?.metadata?.raw;
        if (raw) return raw;
        const msg = parsed?.error?.message;
        if (msg) return msg;
      } catch {
        /* fall through */
      }
    }
  }
  for (const node of candidates) {
    const m = (node as { message?: string }).message;
    if (m) return m;
  }
  return "Vision model provider is unavailable. Try again later.";
}
