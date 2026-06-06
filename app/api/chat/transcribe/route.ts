import { NextResponse } from "next/server";
import { clientIp, type RateLimitConfig, rateLimit } from "@/lib/api/rate-limit";
import {
  extractHoldingsFromImage,
  isAllowedMimeType,
  OcrProviderUnavailableError,
} from "@/lib/portfolio/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — same guard as the import routes

// Same OpenRouter free-tier budget defense as the import OCR.
const TRANSCRIBE_RATE_LIMIT: RateLimitConfig = {
  scope: "chat-transcribe",
  limit: 10,
  windowMs: 60_000,
};

// POST an attached chat image → a plain-text transcription of everything visible
// in it. The Advisor uses this for CONTEXT-AWARE image handling: transcribe an
// attachment ONCE, then carry the cheap text in the conversation so follow-up
// turns can reference it without re-sending image bytes (re-running the flaky
// vision path / busting the prompt cache every turn). The image is never
// persisted. No DB access — pure OCR — so no withDb wrapper.
export async function POST(req: Request) {
  const rl = rateLimit(clientIp(req), TRANSCRIBE_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.resetMs },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.resetMs / 1000).toString() } },
    );
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json({ error: "ocr_unavailable", text: "" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_request", text: "" }, { status: 400 });
  }
  const file = formData.get("image");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "bad_request", text: "" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", text: "" }, { status: 400 });
  }
  const mimeType = file.type || "application/octet-stream";
  if (!isAllowedMimeType(mimeType)) {
    return NextResponse.json({ error: "unsupported_type", text: "" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const { text } = await extractHoldingsFromImage({ data: buffer, mimeType });
    return NextResponse.json({ text }, { status: 200 });
  } catch (err) {
    if (err instanceof OcrProviderUnavailableError) {
      // Non-fatal for the caller — it just falls back to no transcript.
      return NextResponse.json({ error: "provider_unavailable", text: "" }, { status: 502 });
    }
    throw err;
  }
}
