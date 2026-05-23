import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the AI SDK so the test never reaches OpenRouter. The mock is a
// hoisted-safe factory; per-test behavior is configured via `mockImpl`.
const mockImpl = {
  // Default impl returns a clean empty object. Each test overrides via
  // `mockImpl.value = ...` or `mockImpl.throw = ...`.
  value: { rows: [] as unknown[] } as { rows: unknown[] },
  throw: null as Error | null,
};

vi.mock("ai", () => ({
  generateObject: vi.fn(async () => {
    if (mockImpl.throw) throw mockImpl.throw;
    return { object: mockImpl.value };
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
  mockImpl.value = { rows: [] };
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

  it("maps a clean model response into ProposedRow shape", async () => {
    mockImpl.value = {
      rows: [
        {
          ticker: "k-fixed-a",
          englishName: "K Fixed Income",
          units: 14820.3,
          avgCost: 12.04,
        },
        { ticker: "AAPL", units: 10, avgCost: 195.5 },
      ],
    };
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result.rows).toEqual([
      {
        ticker: "K-FIXED-A",
        englishName: "K Fixed Income",
        units: 14820.3,
        avgCost: 12.04,
        quoteSource: "thai_mutual_fund",
      },
      {
        ticker: "AAPL",
        units: 10,
        avgCost: 195.5,
        quoteSource: "yahoo",
      },
    ]);
  });

  it("keeps rows even when units is missing or non-positive (user fills in later)", async () => {
    mockImpl.value = {
      rows: [
        { ticker: "K-FIXED-A" }, // no units at all
        { ticker: "K-USA-A", units: 0 }, // non-positive → treat as missing
        { ticker: "K-WORLDX", units: -3 }, // non-positive → treat as missing
        { ticker: "AAPL", units: 5 }, // valid
      ],
    };
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0].units).toBeUndefined();
    expect(result.rows[1].units).toBeUndefined();
    expect(result.rows[2].units).toBeUndefined();
    expect(result.rows[3].units).toBe(5);
  });

  it("omits avgCost when model returns nothing or non-positive", async () => {
    mockImpl.value = {
      rows: [
        { ticker: "AAPL", units: 5 }, // no avgCost
        { ticker: "MSFT", units: 5, avgCost: 0 }, // zero — drop
      ],
    };
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result.rows[0].avgCost).toBeUndefined();
    expect(result.rows[1].avgCost).toBeUndefined();
  });

  it("returns { rows: [] } cleanly on schema/parse failures (model ran but output was unusable)", async () => {
    mockImpl.throw = new Error("NoObjectGeneratedError: model returned freeform text");
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result).toEqual({ rows: [] });
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

  it("returns { rows: [] } when the model returns an empty array", async () => {
    mockImpl.value = { rows: [] };
    const result = await extractHoldingsFromImage(fakeImage);
    expect(result).toEqual({ rows: [] });
  });

  it("throws when OPENROUTER_API_KEY is missing (caller decides 503 vs stub)", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(extractHoldingsFromImage(fakeImage)).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});
