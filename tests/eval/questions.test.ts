// Cheap, token-free guard for the Advisor eval (scripts/eval). The eval itself
// hits the live model API and isn't part of `npm test`; this verifies its
// STRUCTURE — the question set is well-formed, expected tools exist on the
// synthetic surface, and the deterministic grader behaves — so a broken eval is
// caught in CI before anyone spends tokens running it.
import { describe, expect, it } from "vitest";
import { buildEvalTools, EVAL_TOOL_NAMES } from "../../scripts/eval/fixtures";
import {
  type EvalQuestion,
  gradeAnswer,
  QUESTIONS,
  questionsForTier,
} from "../../scripts/eval/questions";

describe("eval tool surface", () => {
  const tools = buildEvalTools();

  it("mirrors the real advisor + memory surface (9 + 5)", () => {
    expect(EVAL_TOOL_NAMES).toContain("read_portfolio");
    expect(EVAL_TOOL_NAMES).toContain("find_cheaper_alternatives");
    expect(EVAL_TOOL_NAMES.length).toBe(14);
  });

  it("every tool has a description and an execute", () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(typeof t.description, name).toBe("string");
      expect(typeof t.execute, name).toBe("function");
    }
  });

  it("read_portfolio returns the synthetic fixture with a clear biggest holding", async () => {
    const out = (await tools.read_portfolio.execute?.({}, {} as never)) as {
      concentration: { top: { ticker: string; pct: number } };
    };
    expect(out.concentration.top.ticker).toBe("EXAMPLE-FUND-A");
    expect(out.concentration.top.pct).toBe(50);
  });
});

describe("eval question set", () => {
  it("has both tiers and no duplicate ids", () => {
    const ids = QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(questionsForTier("retrieve").length).toBeGreaterThan(0);
    expect(questionsForTier("complex").length).toBeGreaterThan(0);
    expect(questionsForTier("all").length).toBe(QUESTIONS.length);
  });

  it("every question is well-formed and references only real tools", () => {
    for (const q of QUESTIONS) {
      expect(q.prompt.trim().length, q.id).toBeGreaterThan(0);
      expect(["retrieve", "complex"], q.id).toContain(q.tier);
      const e = q.expect;
      const hasCheck =
        !!e.mustInclude?.length ||
        !!e.anyOf?.length ||
        !!e.mustNotInclude?.length ||
        !!e.expectTools?.length;
      expect(hasCheck, `${q.id} has at least one expectation`).toBe(true);
      for (const t of e.expectTools ?? []) {
        expect(EVAL_TOOL_NAMES as string[], `${q.id} expects real tool ${t}`).toContain(t);
      }
    }
  });
});

describe("gradeAnswer", () => {
  const q: EvalQuestion = {
    id: "T",
    tier: "retrieve",
    prompt: "x",
    expect: {
      expectTools: ["read_portfolio"],
      mustInclude: ["EXAMPLE-FUND-A", /50\s?%/],
      anyOf: [/biggest|largest/i],
      mustNotInclude: [/EXAMPLE-FUND-Z/],
    },
  };

  it("scores a grounded, complete, safe answer 1.0", () => {
    const r = gradeAnswer(q, {
      text: "Your largest holding is EXAMPLE-FUND-A at 50%.",
      toolNames: ["read_portfolio"],
    });
    expect(r.score).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("penalizes a missing fact and a missing tool call", () => {
    const r = gradeAnswer(q, {
      text: "Your biggest fund is large.",
      toolNames: [],
    });
    expect(r.score).toBeLessThan(1);
    expect(r.failures.join(" ")).toContain("EXAMPLE-FUND-A");
    expect(r.failures.join(" ")).toContain("read_portfolio");
  });

  it("flags a hallucinated holding via mustNotInclude", () => {
    const r = gradeAnswer(q, {
      text: "Your biggest is EXAMPLE-FUND-A at 50% and also EXAMPLE-FUND-Z.",
      toolNames: ["read_portfolio"],
    });
    expect(r.failures.join(" ")).toContain("EXAMPLE-FUND-Z");
  });
});
