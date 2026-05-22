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
  units: number;
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

Rules:
- Return ONLY rows you can read with high confidence from the image.
- Never invent a ticker. If a ticker is unreadable, omit the whole row.
- Prefer leaving englishName undefined over guessing the official fund name.
- Units is the share / unit count (a positive number). avgCost is the average
  cost per unit (NOT the total market value). If only the total value is
  shown, leave avgCost undefined — the user can fix it in the confirmation
  table.
- If the image is not a portfolio / holdings list, return { "rows": [] }.
- If you are unsure, return { "rows": [] } rather than a noisy best-effort.`;

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
  units: z.number().positive().describe("Unit / share count, positive number."),
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
  } catch {
    // generateObject throws on schema-validation failure, on
    // NoObjectGeneratedError, and on provider transport errors. For all of
    // these, the safest user-facing outcome is "no rows extracted" — the user
    // can retry, try a different screenshot, or fall back to manual entry.
    // We intentionally don't surface the raw provider error to the client.
    return { rows: [] };
  }
}

function normalizeRows(rows: Array<z.infer<typeof RowSchema>>): OcrResult {
  const out: ProposedRow[] = [];
  for (const raw of rows) {
    const ticker = raw.ticker.trim().toUpperCase();
    if (!ticker) continue;
    if (!Number.isFinite(raw.units) || raw.units <= 0) continue;
    const row: ProposedRow = {
      ticker,
      units: raw.units,
      quoteSource: inferQuoteSource(ticker),
    };
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
