import { NextResponse } from "next/server";
import { clientIp, type RateLimitConfig, rateLimit } from "@/lib/api/rate-limit";
import { withDb } from "@/lib/api/with-db";
import { listFundQuotes } from "@/lib/db/queries/quotes";
import {
  type DerivedRow,
  deriveRow,
  extractStructuredHoldings,
  isAllowedMimeType,
  OcrProviderUnavailableError,
} from "@/lib/portfolio/ocr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const IMAGE_OCR_RATE_LIMIT: RateLimitConfig = {
  scope: "import-image",
  // OCR calls hit the OpenRouter free tier — keep it modest per IP / minute.
  // 10/min still gives a real person ample retry budget.
  limit: 10,
  windowMs: 60_000,
};

interface ErrorBody {
  error: string;
  message?: string;
}

function badRequest(message: string): NextResponse<ErrorBody> {
  return NextResponse.json({ error: "bad_request", message }, { status: 400 });
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rl = rateLimit(ip, IMAGE_OCR_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.resetMs },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.resetMs / 1000).toString() },
      },
    );
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return NextResponse.json(
      {
        error: "ocr_unavailable",
        message:
          "Image OCR requires OPENROUTER_API_KEY. Set it in .env.local — see docs/reference/auth-and-providers.md.",
      },
      { status: 503 },
    );
  }

  // We use multipart/form-data so the browser can stream the file directly.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return badRequest("Expected multipart/form-data with an 'image' field.");
  }

  const file = formData.get("image");
  if (!file || !(file instanceof File)) {
    return badRequest("Missing 'image' field — upload a JPG, PNG, or WebP file.");
  }

  if (file.size === 0) {
    return badRequest("Uploaded file is empty.");
  }

  if (file.size > MAX_BYTES) {
    return badRequest(
      `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const mimeType = file.type || "application/octet-stream";
  if (!isAllowedMimeType(mimeType)) {
    return badRequest(`Unsupported file type "${mimeType}". Use JPG, PNG, or WebP.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Structured-extraction endpoint: returns { rows } the UI renders as an
  // editable confirmation table. The vision model reads whatever the broker
  // screen shows (often market value + % but no units); we derive units /
  // avgCost from the latest NAV (fund_quotes) where we can, and flag the rest
  // for the user to fill in. The image is never persisted.
  return withDb(async () => {
    try {
      const extracted = await extractStructuredHoldings({ data: buffer, mimeType });

      // One NAV lookup for all tickers, then derive per row.
      const tickers = extracted.map((r) => r.ticker.trim().toUpperCase());
      const navByTicker = new Map<string, number>();
      if (tickers.length) {
        for (const q of listFundQuotes(tickers)) {
          if (q.nav > 0) navByTicker.set(q.ticker.toUpperCase(), q.nav);
        }
      }

      const rows: DerivedRow[] = extracted.map((r) =>
        deriveRow(r, navByTicker.get(r.ticker.trim().toUpperCase())),
      );

      return NextResponse.json({ rows }, { status: 200 });
    } catch (err) {
      if (err instanceof OcrProviderUnavailableError) {
        return NextResponse.json(
          { error: "provider_unavailable", message: err.message },
          { status: 502 },
        );
      }
      throw err;
    }
  });
}
