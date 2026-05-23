import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI SDK so the test never reaches OpenRouter. The mock is a
// hoisted-safe factory; per-test behavior is configured via `mockImpl`.
const mockImpl = {
  // Default impl returns an empty transcription. Each test overrides via
  // `mockImpl.text = ...` or `mockImpl.throw = ...`.
  text: "",
  throw: null as Error | null,
};

vi.mock("ai", () => ({
  generateText: vi.fn(async () => {
    if (mockImpl.throw) throw mockImpl.throw;
    return { text: mockImpl.text };
  }),
}));

// Also stub the OpenRouter provider factory so we don't import the real
// transport (which expects a real apiKey configured for fetch).
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(() => (modelId: string) => ({ modelId })),
}));

import {
  extractHoldingsFromImage,
  inferQuoteSource,
  isAllowedMimeType,
  OcrProviderUnavailableError,
} from "./ocr";

const FAKE_KEY = "sk-or-test";

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  mockImpl.text = "";
  mockImpl.throw = null;
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OCR_MODEL;
});

describe("inferQuoteSource", () => {
  it("treats Thai fund share-class shapes as thai_mutual_fund", () => {
    expect(inferQuoteSource("K-FIXED-A")).toBe("thai_mutual_fund");
    expect(inferQuoteSource("HIDIV-D")).toBe("thai_mutual_fund");
    expect(inferQuoteSource("SCBS&P500-A")).toBe("thai_mutual_fund");
    expect(inferQuoteSource("k-fixed-a")).toBe("thai_mutual_fund"); // case-insensitive
  });

  it("treats bare / dotted / caret symbols as yahoo", () => {
    expect(inferQuoteSource("AAPL")).toBe("yahoo");
    expect(inferQuoteSource("PTT.BK")).toBe("yahoo");
    expect(inferQuoteSource("^GSPC")).toBe("yahoo");
    expect(inferQuoteSource("THB=X")).toBe("yahoo");
    expect(inferQuoteSource("KFIXED")).toBe("yahoo"); // no hyphen = not Thai-fund shape
  });
});

describe("isAllowedMimeType", () => {
  it("accepts JPG, PNG, WebP only", () => {
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("image/webp")).toBe(true);
    expect(isAllowedMimeType("image/gif")).toBe(false);
    expect(isAllowedMimeType("application/pdf")).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);
  });
});

describe("extractHoldingsFromImage", () => {
  const fakeImage = { data: Buffer.from([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" };

  it("returns the model's transcription verbatim (trimmed)", async () => {
    mockImpl.text = "  K-WORLDX  12,485.6213 units  ฿261,857\n  K-FIXED-A  15,820 units\n  ";
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result.text).toBe("K-WORLDX  12,485.6213 units  ฿261,857\n  K-FIXED-A  15,820 units");
  });

  it("returns empty text when the model produces nothing readable", async () => {
    mockImpl.text = "";
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result).toEqual({ text: "" });
  });

  it("returns empty text on schema/parse failures (model ran but output was unusable)", async () => {
    // AI_NoObjectGeneratedError-style errors and other "model failed" reasons
    // are explicitly classified as NOT provider errors → empty result, no throw.
    mockImpl.throw = new Error("NoObjectGeneratedError: model returned freeform text");
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result).toEqual({ text: "" });
  });

  it("throws OcrProviderUnavailableError on AI SDK transport errors with the provider's message", async () => {
    const transportErr = Object.assign(new Error("Provider returned error"), {
      name: "AI_APICallError",
      responseBody: JSON.stringify({
        error: { message: "No endpoints available matching your guardrail restrictions." },
      }),
    });
    mockImpl.throw = transportErr;
    await expect(extractHoldingsFromImage(fakeImage)).rejects.toBeInstanceOf(
      OcrProviderUnavailableError,
    );
    await expect(extractHoldingsFromImage(fakeImage)).rejects.toThrow(/guardrail/);
  });

  it("prefers the OpenRouter metadata.raw message when wrapped in AI_RetryError → AI_APICallError", async () => {
    const transportErr = Object.assign(new Error("Failed after 3 attempts"), {
      name: "AI_RetryError",
      lastError: Object.assign(new Error("Provider returned error"), {
        name: "AI_APICallError",
        responseBody: JSON.stringify({
          error: {
            message: "Provider returned error",
            metadata: {
              raw: "google/gemma-4-31b-it:free is temporarily rate-limited upstream.",
            },
          },
        }),
      }),
    });
    mockImpl.throw = transportErr;
    await expect(extractHoldingsFromImage(fakeImage)).rejects.toThrow(/rate-limited upstream/);
  });

  it("throws when OPENROUTER_API_KEY is missing (caller decides 503 vs stub)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(extractHoldingsFromImage(fakeImage)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
