import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject } from "ai";
import { z } from "zod";
import type { QuoteSource } from "@/lib/market/sources";

/**
 * Image OCR for the "Add holdings" flow. The user uploads a broker-app
 * screenshot; we ask an OpenRouter vision model to extract holdings rows
 * in a strict JSON shape, then surface those rows in a confirmation table
 * (the user reviews and edits before any DB write happens).
 *
 * Defaults to a **free-tier** OpenRouter vision model — the operator
 * explicitly does not want this path to burn paid credits.
 *
 * Override the model with `OCR_MODEL=<provider/model:free>` when a better
 * free vision option lands. See https://openrouter.ai/models for the
 * current free + multimodal list.
 */

export interface ProposedRow {
  ticker: string;
  englishName?: string;
  units?: number;
  avgCost?: number;
  quoteSource: QuoteSource;
}

export interface OcrInput {
  data: Buffer;
  mimeType: string;
}

export interface OcrResult {
  rows: ProposedRow[];
}

// OpenRouter's free-models router. Picks a free vision-capable backend per
// call, so this path never burns paid credits and survives any single
// model's deprecation. Mirrors the chat path's default. Override via
// `OCR_MODEL` to pin a specific model if quality varies.
const DEFAULT_OCR_MODEL = "openrouter/free";

const SYSTEM_PROMPT = `You extract Thai mutual fund and stock holdings from a broker / fund-house screenshot.

Goal: surface every holding you can identify, even if some fields are missing.
The user will review and complete the rows in a confirmation table, so partial
data is useful — don't drop a row just because one field is unreadable.

Rules:
- Ticker is the only required field. If you can't read the ticker, omit the row.
- Never invent a ticker. Copy it exactly as printed.
- englishName, units, avgCost are all optional — leave any field undefined when
  it's not clearly visible. Never guess.
- units is the share / unit count (positive number). avgCost is the average
  cost PER UNIT — not the total market value. If only a total/market value is
  shown, leave avgCost undefined.
- If the image is not a portfolio / holdings list at all, return { "rows": [] }.`;

const RowSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(40)
    .describe("Ticker exactly as printed on the screen (e.g. K-FIXED-A, AAPL)."),
  englishName: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Fund's official English name if clearly visible. Omit if unsure."),
  units: z
    .number()
    .positive()
    .optional()
    .describe("Unit / share count, positive number. Omit if not clearly visible."),
  avgCost: z
    .number()
    .positive()
    .optional()
    .describe("Average cost PER UNIT (not total value). Omit if not shown."),
});

const SchemaShape = z.object({
  rows: z.array(RowSchema),
});

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mimeType: string): mimeType is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);
}

// Thai mutual fund share-class shape: at least one hyphen group of A-Z/0-9
// (e.g. K-FIXED-A, HIDIV-D, SCBS&P500-A). Single-token tickers like AAPL or
// dotted symbols like PTT.BK fall through to "yahoo".
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
 * Extract holdings rows from a broker screenshot.
 *
 * Returns `{ rows: [] }` (not an error) when the model can't read the image,
 * returns invalid data, or is uncertain — the route handler treats an empty
 * result as a successful "nothing recognized" so the UI can show a friendly
 * empty state.
 *
 * Throws only on missing API key or transport-level failures; callers should
 * check for OPENROUTER_API_KEY before calling.
 */
export async function extractHoldingsFromImage(input: OcrInput): Promise<OcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const modelId = process.env.OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
  const model = openrouterVisionModel(apiKey, modelId);

  try {
    const result = await generateObject({
      model,
      schema: SchemaShape,
      temperature: 0,
      maxOutputTokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract holdings rows from this screenshot. Follow the rules in the system prompt — if you are unsure, return an empty rows array.",
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

    return normalizeRows(result.object.rows);
  } catch (err) {
    // Distinguish "model ran but produced unusable output" (schema/parse —
    // return empty rows, user retries) from "we couldn't reach a working
    // vision model" (API/auth/guardrail — surface to UI so user can act).
    if (isProviderError(err)) {
      const message = extractProviderMessage(err);
      throw new OcrProviderUnavailableError(message);
    }
    return { rows: [] };
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
  // AI SDK error class names: AI_APICallError, AI_RetryError, etc.
  return name.startsWith("AI_") && name !== "AI_NoObjectGeneratedError";
}

function extractProviderMessage(err: unknown): string {
  // Walk the error chain — AI_RetryError typically wraps the last AI_APICallError.
  const visited = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !visited.has(cur)) {
    visited.add(cur);
    const c = cur as { responseBody?: unknown; cause?: unknown; message?: string };
    if (typeof c.responseBody === "string") {
      try {
        const parsed = JSON.parse(c.responseBody) as { error?: { message?: string } };
        if (parsed?.error?.message) return parsed.error.message;
      } catch {
        /* fall through */
      }
    }
    if (c.cause) {
      cur = c.cause;
      continue;
    }
    if (c.message) return c.message;
    break;
  }
  return "Vision model provider is unavailable. Try again later.";
}

function normalizeRows(rows: Array<z.infer<typeof RowSchema>>): OcrResult {
  const out: ProposedRow[] = [];
  for (const raw of rows) {
    const ticker = raw.ticker.trim().toUpperCase();
    if (!ticker) continue;
    const row: ProposedRow = {
      ticker,
      quoteSource: inferQuoteSource(ticker),
    };
    if (typeof raw.units === "number" && Number.isFinite(raw.units) && raw.units > 0) {
      row.units = raw.units;
    }
    if (raw.englishName && raw.englishName.trim()) {
      row.englishName = raw.englishName.trim();
    }
    if (typeof raw.avgCost === "number" && Number.isFinite(raw.avgCost) && raw.avgCost > 0) {
      row.avgCost = raw.avgCost;
    }
    out.push(row);
  }
  return { rows: out };
}
