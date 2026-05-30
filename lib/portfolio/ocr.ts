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
 * (the advisor-assist OCR follow-up in ROADMAP).
 *
 * **Why pure transcription instead of structured JSON.** Earlier iterations
 * asked the model to return a Zod-validated `{ rows: ProposedRow[] }`. Free
 * and OCR-specialized vision models routinely failed at the structured-output
 * contract:
 *   - Some OCR-specialized vision models don't support OpenRouter's structured-output flag.
 *   - Smaller Gemma / Llama free models return "Invalid JSON response".
 *   - Even capable models silently returned empty rows when their schema-
 *     following confidence was low (no signal back to the user about WHY).
 * Pure-text transcription compiles to a single `generateText` call that works
 * across every image-capable model. The reasoning that used to happen inside
 * the OCR call (which line is a ticker? which number is units vs. total
 * value?) is deferred to either the user (read the transcription, fill rows
 * manually) or a future advisor flow.
 *
 * Defaults to `google/gemini-2.0-flash-001`. Override with `OCR_MODEL` — see
 * `.env.example`. Must be a vision-capable OpenRouter model.
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
 * A single holding the vision model read off a broker screenshot, BEFORE any
 * NAV-derivation. Thai broker apps vary in what they show on the summary
 * screen — some list units + NAV + avg cost (the fund DETAIL view), most list
 * only market value + allocation % + gain/loss (the portfolio summary view).
 * So every numeric field is optional: the extractor reports only what it
 * actually saw, and the route fills the gaps (see `deriveRow`).
 */
export interface ExtractedRow {
  /** Fund code / ticker exactly as printed (e.g. "K-USA-A(A)", "SCBSP500-A"). */
  ticker: string;
  /** English fund name if shown (often a small subtitle under the code). */
  englishName?: string;
  /** Units held, if the screen shows them. */
  units?: number;
  /** NAV / price per unit, if shown. */
  nav?: number;
  /** Average cost per unit, if shown (the DETAIL view has this directly). */
  avgCost?: number;
  /** Market value of the position, if shown (most summary views lead with this). */
  value?: number;
  /** Unrealised profit/loss in THB, if shown (negative for a loss). */
  pl?: number;
}

/**
 * A holding row after NAV-derivation, ready for the editable confirmation
 * table. Carries provenance so the UI can mark estimated fields and prompt
 * the user to make them exact.
 */
export interface DerivedRow extends ExtractedRow {
  quoteSource: QuoteSource;
  /** True when `units`/`avgCost` were computed (value÷NAV), not read from the image. */
  estimated: boolean;
  /** True when we couldn't derive units (no NAV on file) — UI asks the user to type them. */
  needsUnits: boolean;
}

/** @deprecated use {@link ExtractedRow} — kept until callers migrate. */
export interface ProposedRow {
  ticker: string;
  englishName?: string;
  units?: number;
  avgCost?: number;
  quoteSource: QuoteSource;
}

// Default model chain: a primary vision model, with a cheaper one as the
// automatic fallback when the primary rate-limits or errors. Both are Google
// Gemini Flash variants on OpenRouter — strong at reading text from
// document/table screenshots and inexpensive (~$0.0001–0.001 per image).
//
// History: the previous default `baidu/qianfan-ocr-fast(:free)` was removed
// from OpenRouter ("No endpoints found", observed 2026-05) which silently
// broke this endpoint; both the free and paid variants 404'd. The
// replacement is a maintained, no-train-by-default provider. This OCR utility
// is intentionally NOT tier-gated — it's a bounded, rate-limited one-shot
// (unlike the open-ended chat advisor, which the free-tier invariant guards),
// so it uses the same model for every user for identical UX.
//
// On primary failure (HTTP 429 / provider error) the route catches
// OcrProviderUnavailableError, retries once against OCR_FALLBACK_MODEL,
// and only surfaces the error if both fail.
const DEFAULT_OCR_MODEL = "google/gemini-2.5-flash";
const DEFAULT_OCR_FALLBACK_MODEL = "google/gemini-2.0-flash-001";

const SYSTEM_PROMPT = `You are an OCR transcription engine. Read the image and return EVERY line of visible text, in reading order. Preserve numbers, currency symbols, percent signs, and column structure exactly as they appear. Use newlines between rows of a table. Do not summarize, interpret, or add commentary — just transcribe.

If the image contains no readable text at all, return an empty string.`;

// Structured-extraction prompt. The hard-won detail (validated against real
// Thai broker screenshots) is the digit/glyph fidelity instruction: general
// vision models otherwise merge the ฿ glyph into the adjacent number
// ("฿18.45" → "818.45") and strip/garble decimals — fatal for holdings.
// We ask for prompt-driven JSON (NOT OpenRouter's structured-output flag,
// which several capable models silently fail — see the note above).
const EXTRACT_PROMPT = `You are reading a screenshot of a Thai mutual-fund / brokerage portfolio. Extract EVERY fund holding as a JSON array — output ONLY the array, no prose, no markdown code fences.

Each element has these keys (include a key ONLY if that value is actually visible for that row; omit keys you cannot read — never guess):
- "ticker": the fund code exactly as printed (e.g. "K-USA-A(A)", "SCBSP500-A", "TLFVMR-ASIAX")
- "englishName": the English fund name if shown as a subtitle
- "units": number of units held
- "nav": price or NAV per unit
- "avgCost": average cost per unit
- "value": market value of the position (the large baht amount)
- "pl": unrealised profit/loss in baht (negative if it is red or has a minus sign)

CRITICAL number rules — read every digit and decimal EXACTLY as printed:
- The ฿ symbol is a CURRENCY MARKER, never a digit. "฿18.4521" is 18.4521, NOT 818.4521. Strip it.
- Remove thousands-separator commas: "719,193.85" → 719193.85.
- Never round, pad, or normalise. Output plain JSON numbers (no quotes, no ฿, no commas, no % sign).
- Do NOT include portfolio totals, headers, "cash", or summary rows as holdings.

If the image shows no portfolio at all, return [].`;

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
 * Tries `OCR_MODEL` (defaults to qianfan free) first. If that fails with a
 * provider-unavailable error (rate limit, quota exhausted, no endpoint), and
 * `OCR_FALLBACK_MODEL` is set (defaults to paid qianfan), retries once on
 * the fallback. Only throws if both fail.
 *
 * Returns `{ text: "" }` (not an error) when a model runs successfully but
 * can't extract anything from the image — the route handler treats an empty
 * string as "nothing recognized" so the UI can show a friendly empty state.
 *
 * Throws `OcrProviderUnavailableError` only on transport / auth / guardrail
 * errors that ALL attempts hit, so the route can surface a 502 with the
 * last provider's actual message.
 */
export async function extractHoldingsFromImage(input: OcrInput): Promise<OcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const primary = process.env.OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
  const fallbackEnv = process.env.OCR_FALLBACK_MODEL?.trim();
  // Only apply the default fallback when the user hasn't pinned an override
  // primary — if they explicitly chose a model, don't surprise them by
  // falling back to qianfan-paid. They can opt back in via OCR_FALLBACK_MODEL.
  const fallback = fallbackEnv ?? (process.env.OCR_MODEL ? null : DEFAULT_OCR_FALLBACK_MODEL);

  try {
    return await transcribe(apiKey, primary, input);
  } catch (err) {
    if (err instanceof OcrProviderUnavailableError && fallback && fallback !== primary) {
      try {
        return await transcribe(apiKey, fallback, input);
      } catch (fallbackErr) {
        // Surface the FALLBACK's error — the operator already knew the primary
        // was free/quota-bound; they need to see why their no-train safety net
        // also failed.
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function transcribe(apiKey: string, modelId: string, input: OcrInput): Promise<OcrResult> {
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

/**
 * Read a broker screenshot into structured holding rows.
 *
 * Same provider + fallback policy as {@link extractHoldingsFromImage}: tries
 * `OCR_MODEL` (default gemini-2.5-flash), retries once on `OCR_FALLBACK_MODEL`
 * for provider-unavailable errors. Returns `[]` (not an error) when a model
 * runs but reads no holdings, so the route can show a friendly empty state.
 *
 * Returns raw extracted rows — NAV-derivation (units/avgCost from market data)
 * happens in the route, which has DB access.
 */
export async function extractStructuredHoldings(input: OcrInput): Promise<ExtractedRow[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const primary = process.env.OCR_MODEL?.trim() || DEFAULT_OCR_MODEL;
  const fallbackEnv = process.env.OCR_FALLBACK_MODEL?.trim();
  const fallback = fallbackEnv ?? (process.env.OCR_MODEL ? null : DEFAULT_OCR_FALLBACK_MODEL);

  try {
    return await extractWith(apiKey, primary, input);
  } catch (err) {
    if (err instanceof OcrProviderUnavailableError && fallback && fallback !== primary) {
      return await extractWith(apiKey, fallback, input);
    }
    throw err;
  }
}

async function extractWith(
  apiKey: string,
  modelId: string,
  input: OcrInput,
): Promise<ExtractedRow[]> {
  const model = openrouterVisionModel(apiKey, modelId);
  try {
    const result = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image", image: input.data, mediaType: input.mimeType },
          ],
        },
      ],
    });
    return parseExtractedRows(result.text ?? "");
  } catch (err) {
    if (isProviderError(err)) {
      throw new OcrProviderUnavailableError(extractProviderMessage(err));
    }
    // A non-provider error here is almost always a malformed/blocked response;
    // treat as "nothing read" rather than a hard 502.
    return [];
  }
}

/**
 * Tolerant parser for the model's JSON-array reply. Handles markdown fences,
 * leading prose, and stray ฿/comma residue the prompt should have removed but
 * a weaker model might leave in. Drops rows without a usable ticker.
 */
export function parseExtractedRows(text: string): ExtractedRow[] {
  if (!text) return [];
  let s = text.trim();
  // Strip ```json … ``` fences if present.
  s = s
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  // Narrow to the outermost array.
  const a = s.indexOf("[");
  const b = s.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  s = s.slice(a, b + 1);

  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const rows: ExtractedRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ticker = typeof o.ticker === "string" ? o.ticker.trim() : "";
    if (!ticker) continue;
    const row: ExtractedRow = { ticker };
    if (typeof o.englishName === "string" && o.englishName.trim()) {
      row.englishName = o.englishName.trim();
    }
    const units = coerceNumber(o.units);
    const nav = coerceNumber(o.nav);
    const avgCost = coerceNumber(o.avgCost);
    const value = coerceNumber(o.value);
    const pl = coerceNumber(o.pl);
    if (units !== null) row.units = units;
    if (nav !== null) row.nav = nav;
    if (avgCost !== null) row.avgCost = avgCost;
    if (value !== null) row.value = value;
    if (pl !== null) row.pl = pl;
    rows.push(row);
  }
  return rows;
}

/**
 * Fill in `units`/`avgCost` for a row that only had market value, using a NAV
 * from market data. Pure + synchronous so it's unit-testable; the route looks
 * up `nav` (via `listFundQuotes`) and passes it in.
 *
 * Precedence: trust what the image showed. Only derive a missing field.
 *  - units   = value ÷ nav           (when units absent but value + nav present)
 *  - avgCost = (value − pl) ÷ units   (cost basis = current value minus gain)
 *
 * `estimated` flags any derived field so the UI can mark it and invite the
 * user to make it exact. `needsUnits` means we still have no units (no NAV on
 * file and none on the image) — the confirmation table asks the user to type
 * them, ideally from the fund's detail screen.
 */
export function deriveRow(row: ExtractedRow, nav: number | undefined): DerivedRow {
  const quoteSource = inferQuoteSource(row.ticker);
  const out: DerivedRow = { ...row, quoteSource, estimated: false, needsUnits: false };

  // Prefer the NAV printed on the image; fall back to market-data NAV.
  const effNav = out.nav ?? (nav && nav > 0 ? nav : undefined);
  if (out.nav === undefined && effNav !== undefined) {
    out.nav = effNav;
    out.estimated = true;
  }

  if (out.units === undefined && out.value !== undefined && effNav) {
    out.units = out.value / effNav;
    out.estimated = true;
  }

  if (
    out.avgCost === undefined &&
    out.units !== undefined &&
    out.units > 0 &&
    out.value !== undefined
  ) {
    const costBasis = out.value - (out.pl ?? 0);
    if (costBasis > 0) {
      out.avgCost = costBasis / out.units;
      out.estimated = true;
    }
  }

  out.needsUnits = out.units === undefined || out.units <= 0;
  return out;
}

/** Parse a model-emitted number that may still carry ฿, commas, %, or a +/- sign. */
function coerceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[฿$,%\s]/g, "").replace(/^\+/, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
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
