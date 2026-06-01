import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDemoProvider, resolveOwnerProvider, resolveTierProvider } from "./provider";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "DEMO_OPENROUTER_API_KEY",
  "AI_MODELS",
  "DEMO_AI_MODELS",
  "FREE_TIER_MODEL",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("resolveOwnerProvider", () => {
  it("returns not-ready when key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    const p = resolveOwnerProvider();
    expect(p.ready).toBe(false);
    expect(p.model).toBeNull();
  });

  it("defaults to free → auto fallback chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.AI_MODELS;
    const p = resolveOwnerProvider();
    expect(p.ready).toBe(true);
    expect(p.label).toBe("OpenRouter · openrouter/free → openrouter/auto");
  });

  it("honors AI_MODELS as comma-separated chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/auto,anthropic/claude-sonnet-4.5";
    const p = resolveOwnerProvider();
    expect(p.label).toBe("OpenRouter · openrouter/auto → anthropic/claude-sonnet-4.5");
  });

  it("accepts a single-model AI_MODELS value (no fallback)", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/auto";
    const p = resolveOwnerProvider();
    expect(p.label).toBe("OpenRouter · openrouter/auto");
  });
});

describe("resolveTierProvider (tier gating)", () => {
  it("returns not-ready when key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(resolveTierProvider("free").ready).toBe(false);
    expect(resolveTierProvider("trusted").ready).toBe(false);
  });

  it("trusted tier uses the owner AI_MODELS chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/auto,anthropic/claude-sonnet-4.5";
    const p = resolveTierProvider("trusted");
    expect(p.label).toBe("Trusted · openrouter/auto → anthropic/claude-sonnet-4.5");
  });

  it("trusted tier defaults to free → auto when AI_MODELS unset", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.AI_MODELS;
    expect(resolveTierProvider("trusted").label).toBe(
      "Trusted · openrouter/free → openrouter/auto",
    );
  });

  it("free tier resolves to openrouter/free only", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.AI_MODELS;
    expect(resolveTierProvider("free").label).toBe("Free · openrouter/free");
  });

  it("INVARIANT: free tier NEVER resolves to a paid model, regardless of AI_MODELS", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    // Operator misconfigures AI_MODELS with a pricey model — free tier must
    // ignore it entirely. A regression here burns the owner's budget.
    process.env.AI_MODELS = "anthropic/claude-opus-4.1,openai/gpt-5";
    const p = resolveTierProvider("free");
    expect(p.label).toBe("Free · openrouter/free");
    expect(p.label).not.toContain("anthropic");
    expect(p.label).not.toContain("openai");
  });
});

describe("resolveDemoProvider", () => {
  it("defaults to openrouter/free with no fallback", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.DEMO_AI_MODELS;
    const p = resolveDemoProvider();
    expect(p.label).toBe("Demo · openrouter/free");
  });

  it("falls back to owner key when DEMO_OPENROUTER_API_KEY unset", () => {
    process.env.OPENROUTER_API_KEY = "sk-owner";
    delete process.env.DEMO_OPENROUTER_API_KEY;
    const p = resolveDemoProvider();
    expect(p.ready).toBe(true);
  });
});

describe("openrouter fetch wrapper", () => {
  it("does not inject `models` field for single-model chain", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/auto";

    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const p = resolveOwnerProvider();
    if (!p.model || typeof p.model === "string") throw new Error("expected model object");
    try {
      await p.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } catch {
      // ai-sdk may post-validate the stub response; we only care about the body
    }

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody as string);
    expect(body.model).toBe("openrouter/auto");
    expect(body.models).toBeUndefined();
  });

  it("injects `models` array when chain has fallbacks", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/free,openrouter/auto";

    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const p = resolveOwnerProvider();
    if (!p.model || typeof p.model === "string") throw new Error("expected model object");
    try {
      await p.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } catch {
      // forward
    }

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody as string);
    expect(body.model).toBe("openrouter/free");
    expect(body.models).toEqual(["openrouter/free", "openrouter/auto"]);
  });

  it("free tier injects reasoning:{effort:'none'} to disable reasoning", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.FREE_TIER_MODEL;

    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const p = resolveTierProvider("free");
    if (!p.model || typeof p.model === "string") throw new Error("expected model object");
    try {
      await p.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } catch {
      // forward
    }

    const body = JSON.parse(capturedBody as string);
    expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("owner path does NOT pin reasoning (keeps model default for the owner)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.AI_MODELS = "openrouter/auto"; // single model → no models[] override either

    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const p = resolveOwnerProvider();
    if (!p.model || typeof p.model === "string") throw new Error("expected model object");
    try {
      await p.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } catch {
      // forward
    }

    const body = JSON.parse(capturedBody as string);
    expect(body.reasoning).toBeUndefined();
  });
});
