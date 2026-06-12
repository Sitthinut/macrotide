import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveDemoProvider,
  resolveOwnerProvider,
  resolveTierProvider,
  resolveVisionProvider,
} from "./provider";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "DEMO_OPENROUTER_API_KEY",
  "TRUSTED_TIER_MODELS",
  "DEMO_TIER_MODELS",
  "PUBLIC_TIER_MODELS",
  "VISION_CHAT_MODEL",
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
    delete process.env.TRUSTED_TIER_MODELS;
    const p = resolveOwnerProvider();
    expect(p.ready).toBe(true);
    expect(p.label).toBe("OpenRouter · openrouter/free → openrouter/auto");
  });

  it("honors TRUSTED_TIER_MODELS as comma-separated chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto,anthropic/claude-sonnet-4.5";
    const p = resolveOwnerProvider();
    expect(p.label).toBe("OpenRouter · openrouter/auto → anthropic/claude-sonnet-4.5");
  });

  it("accepts a single-model TRUSTED_TIER_MODELS value (no fallback)", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto";
    const p = resolveOwnerProvider();
    expect(p.label).toBe("OpenRouter · openrouter/auto");
  });
});

describe("resolveTierProvider (tier gating)", () => {
  it("returns not-ready when key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(resolveTierProvider("public").ready).toBe(false);
    expect(resolveTierProvider("trusted").ready).toBe(false);
  });

  it("trusted tier uses the owner TRUSTED_TIER_MODELS chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto,anthropic/claude-sonnet-4.5";
    const p = resolveTierProvider("trusted");
    expect(p.label).toBe("Trusted · openrouter/auto → anthropic/claude-sonnet-4.5");
  });

  it("trusted tier defaults to free → auto when TRUSTED_TIER_MODELS unset", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.TRUSTED_TIER_MODELS;
    expect(resolveTierProvider("trusted").label).toBe(
      "Trusted · openrouter/free → openrouter/auto",
    );
  });

  it("public tier resolves to openrouter/free only", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.TRUSTED_TIER_MODELS;
    delete process.env.PUBLIC_TIER_MODELS;
    expect(resolveTierProvider("public").label).toBe("Public · openrouter/free");
  });

  it("public tier honors PUBLIC_TIER_MODELS", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.PUBLIC_TIER_MODELS = "google/gemini-2.5-flash";
    expect(resolveTierProvider("public").label).toBe("Public · google/gemini-2.5-flash");
  });

  it("INVARIANT: public tier NEVER resolves to a paid model from TRUSTED_TIER_MODELS", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.PUBLIC_TIER_MODELS;
    // Operator misconfigures TRUSTED_TIER_MODELS with a pricey model — public
    // tier must ignore it entirely. A regression here burns the owner's budget.
    process.env.TRUSTED_TIER_MODELS = "anthropic/claude-opus-4.1,openai/gpt-5";
    const p = resolveTierProvider("public");
    expect(p.label).toBe("Public · openrouter/free");
    expect(p.label).not.toContain("anthropic");
    expect(p.label).not.toContain("openai");
  });
});

describe("resolveDemoProvider", () => {
  it("defaults to openrouter/free with no fallback", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.DEMO_TIER_MODELS;
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

describe("resolveVisionProvider", () => {
  it("returns not-ready when key is missing", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.DEMO_OPENROUTER_API_KEY;
    const p = resolveVisionProvider();
    expect(p.ready).toBe(false);
    expect(p.model).toBeNull();
  });

  it("defaults to google/gemini-2.5-flash", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.VISION_CHAT_MODEL;
    const p = resolveVisionProvider();
    expect(p.ready).toBe(true);
    expect(p.label).toBe("Vision · google/gemini-2.5-flash");
  });

  it("honors VISION_CHAT_MODEL as a comma-separated chain", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.VISION_CHAT_MODEL = "google/gemini-2.5-flash,google/gemini-2.0-flash-001";
    const p = resolveVisionProvider();
    expect(p.label).toBe("Vision · google/gemini-2.5-flash → google/gemini-2.0-flash-001");
  });

  it.each([
    "off",
    "OFF",
    "none",
    "false",
    "0",
    "  off  ",
  ])("treats VISION_CHAT_MODEL=%j as disabled (not-ready)", (value) => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.VISION_CHAT_MODEL = value;
    const p = resolveVisionProvider();
    expect(p.ready).toBe(false);
    expect(p.model).toBeNull();
    expect(p.label).toBe("Vision (disabled)");
  });

  it("INVARIANT: vision model derives from VISION_CHAT_MODEL, never TRUSTED_TIER_MODELS", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "anthropic/claude-opus-4.1";
    delete process.env.VISION_CHAT_MODEL;
    const p = resolveVisionProvider();
    expect(p.label).toBe("Vision · google/gemini-2.5-flash");
    expect(p.label).not.toContain("anthropic");
  });

  describe("demo flavor", () => {
    it("uses DEMO_OPENROUTER_API_KEY when demo:true", () => {
      delete process.env.OPENROUTER_API_KEY;
      process.env.DEMO_OPENROUTER_API_KEY = "sk-demo";
      const p = resolveVisionProvider({ demo: true });
      expect(p.ready).toBe(true);
      expect(p.label).toBe("Vision (demo) · google/gemini-2.5-flash");
    });

    it("falls back to the owner key when DEMO_OPENROUTER_API_KEY unset", () => {
      process.env.OPENROUTER_API_KEY = "sk-owner";
      delete process.env.DEMO_OPENROUTER_API_KEY;
      const p = resolveVisionProvider({ demo: true });
      expect(p.ready).toBe(true);
    });

    it("is not-ready when neither demo nor owner key is set", () => {
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.DEMO_OPENROUTER_API_KEY;
      expect(resolveVisionProvider({ demo: true }).ready).toBe(false);
    });
  });
});

describe("openrouter fetch wrapper", () => {
  it("does not inject `models` field for single-model chain", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto";

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
    process.env.TRUSTED_TIER_MODELS = "openrouter/free,openrouter/auto";

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

  it("public tier injects reasoning:{effort:'none'} to disable reasoning", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.PUBLIC_TIER_MODELS;

    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const p = resolveTierProvider("public");
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

  // Helper: capture the request body for one doGenerate call.
  async function captureBody(resolve: () => { model: unknown }): Promise<Record<string, unknown>> {
    let capturedBody: string | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const p = resolve() as {
      model: { doGenerate: (a: unknown) => Promise<unknown> } | null | string;
    };
    if (!p.model || typeof p.model === "string") throw new Error("expected model object");
    try {
      await p.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      });
    } catch {
      // forward
    }
    return JSON.parse(capturedBody as string);
  }

  it("owner path injects the intent-gated effort when given one (#58)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto";
    const body = await captureBody(() => resolveOwnerProvider({ reasoningEffort: "medium" }));
    expect(body.reasoning).toEqual({ effort: "medium" });
  });

  it("trusted path injects the intent-gated effort when given one (#58)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto";
    const body = await captureBody(() =>
      resolveTierProvider("trusted", { reasoningEffort: "medium" }),
    );
    expect(body.reasoning).toEqual({ effort: "medium" });
  });

  it("INVARIANT: public tier IGNORES a gated effort and stays pinned to none (#58)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.PUBLIC_TIER_MODELS;
    // Even if the route passed `medium`, public must never reason (cost-protected).
    const body = await captureBody(() =>
      resolveTierProvider("public", { reasoningEffort: "medium" }),
    );
    expect(body.reasoning).toEqual({ effort: "none" });
  });

  it("owner path does NOT pin reasoning (keeps model default for the owner)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.TRUSTED_TIER_MODELS = "openrouter/auto"; // single model → no models[] override either

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
