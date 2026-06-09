import { describe, expect, it } from "vitest";
import { extractCards, joinStepText } from "./turn-persist";

describe("turn-persist — joinStepText", () => {
  it("concatenates every step's text (not just the last)", () => {
    const steps = [
      { text: "Looking at the screenshot…" },
      { text: "" },
      { text: "Drafted below." },
    ];
    expect(joinStepText(steps)).toBe("Looking at the screenshot…\n\nDrafted below.");
  });

  it("returns empty string when no step has text", () => {
    expect(joinStepText([{ text: "" }, {}])).toBe("");
    expect(joinStepText([])).toBe("");
  });
});

describe("turn-persist — extractCards", () => {
  const result = (output: unknown) => [{ toolResults: [{ output }] }];

  it("captures a transactions import payload", () => {
    const payload = { rows: [{ ticker: "VOO" }], source: null, note: "x" };
    expect(extractCards(result({ ok: true, transactionsImport: payload }))).toEqual({
      transactionsImport: payload,
    });
  });

  it("captures a holdings import payload (incl. propose_holding's value-only branch)", () => {
    const payload = { rows: [{ ticker: "K-USA-A", estimated: true }], source: null, note: null };
    expect(extractCards(result({ ok: true, holdingsImport: payload }))).toEqual({
      holdingsImport: payload,
    });
  });

  it("accumulates multiple single-holding proposals into holdings[]", () => {
    const steps = [
      { toolResults: [{ output: { ok: true, holding: { ticker: "VOO" } } }] },
      { toolResults: [{ output: { ok: true, holding: { ticker: "QQQ" } } }] },
    ];
    expect(extractCards(steps)).toEqual({ holdings: [{ ticker: "VOO" }, { ticker: "QQQ" }] });
  });

  it("captures a plan proposal", () => {
    const proposal = { section: "Principles", add: "- x", rm: null, rationale: "y" };
    expect(extractCards(result({ ok: true, proposal }))).toEqual({ proposal });
  });

  it("reads the legacy `result` field when `output` is absent", () => {
    const payload = { rows: [], source: null, note: null };
    expect(extractCards([{ toolResults: [{ result: { holdingsImport: payload } }] }])).toEqual({
      holdingsImport: payload,
    });
  });

  it("returns null when the turn produced no cards", () => {
    expect(extractCards([{ text: "just prose" }])).toBeNull();
    expect(extractCards(result({ ok: true, message: "read the portfolio" }))).toBeNull();
    expect(extractCards([])).toBeNull();
  });
});
