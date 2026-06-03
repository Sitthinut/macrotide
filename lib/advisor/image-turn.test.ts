import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countTurnImages,
  isDemoVisionEnabled,
  turnHasImages,
  type VisionPath,
  visionDecisionFor,
  withImageMarker,
} from "./image-turn";

const uiText = (role: string, text: string) => ({ role, parts: [{ type: "text", text }] });
const uiImage = (text: string, n: number) => ({
  role: "user",
  parts: [
    { type: "text", text },
    ...Array.from({ length: n }, () => ({
      type: "file",
      mediaType: "image/png",
      url: "data:image/png;base64,AAAA",
    })),
  ],
});

describe("countTurnImages / turnHasImages", () => {
  it("counts image file parts on the latest UIMessage", () => {
    const messages = [uiText("user", "hi"), uiText("assistant", "hello"), uiImage("look", 2)];
    expect(countTurnImages(messages)).toBe(2);
    expect(turnHasImages(messages)).toBe(true);
  });

  it("ignores non-image file parts", () => {
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "doc" },
          { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,AA" },
        ],
      },
    ];
    expect(countTurnImages(messages)).toBe(0);
    expect(turnHasImages(messages)).toBe(false);
  });

  it("only inspects the LATEST message", () => {
    const messages = [uiImage("old", 3), uiText("user", "new text only")];
    expect(countTurnImages(messages)).toBe(0);
  });

  it("returns 0 for text-only ModelMessage[] (string content)", () => {
    const messages = [{ role: "user", content: "plain text" }];
    expect(countTurnImages(messages)).toBe(0);
  });

  it("detects image parts in ModelMessage content[] (defensive)", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "x" },
          { type: "image", image: "..." },
        ],
      },
    ];
    expect(countTurnImages(messages)).toBe(1);
  });

  it("handles an empty conversation", () => {
    expect(countTurnImages([])).toBe(0);
  });
});

describe("withImageMarker", () => {
  it("appends a pluralized marker to existing text", () => {
    expect(withImageMarker("here", 1)).toBe("here\n\n[1 image attached]");
    expect(withImageMarker("here", 3)).toBe("here\n\n[3 images attached]");
  });

  it("is the marker alone for an image-only turn", () => {
    expect(withImageMarker("", 2)).toBe("[2 images attached]");
  });

  it("leaves text-only turns unchanged", () => {
    expect(withImageMarker("just text", 0)).toBe("just text");
  });
});

describe("visionDecisionFor", () => {
  const paths: VisionPath[] = ["demo", "tiered", "owner"];

  it("routes text turns to 'text' on every path", () => {
    for (const p of paths) {
      expect(visionDecisionFor(p, false, { visionReady: true, demoVisionEnabled: true })).toBe(
        "text",
      );
    }
  });

  it("owner/tiered image turns: vision when ready, stub when disabled", () => {
    for (const p of ["tiered", "owner"] as VisionPath[]) {
      expect(visionDecisionFor(p, true, { visionReady: true, demoVisionEnabled: false })).toBe(
        "vision",
      );
      expect(visionDecisionFor(p, true, { visionReady: false, demoVisionEnabled: false })).toBe(
        "stub",
      );
    }
  });

  it("demo image turns stub unless DEMO_VISION is enabled AND vision is ready", () => {
    expect(visionDecisionFor("demo", true, { visionReady: true, demoVisionEnabled: false })).toBe(
      "stub",
    );
    expect(visionDecisionFor("demo", true, { visionReady: false, demoVisionEnabled: true })).toBe(
      "stub",
    );
    expect(visionDecisionFor("demo", true, { visionReady: true, demoVisionEnabled: true })).toBe(
      "vision",
    );
  });
});

describe("isDemoVisionEnabled", () => {
  const saved = process.env.DEMO_VISION;
  beforeEach(() => {
    delete process.env.DEMO_VISION;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DEMO_VISION;
    else process.env.DEMO_VISION = saved;
  });

  it("defaults to false when unset", () => {
    expect(isDemoVisionEnabled()).toBe(false);
  });

  it.each(["on", "1", "true", "YES", " On "])("is true for %j", (v) => {
    process.env.DEMO_VISION = v;
    expect(isDemoVisionEnabled()).toBe(true);
  });

  it.each(["off", "0", "false", ""])("is false for %j", (v) => {
    process.env.DEMO_VISION = v;
    expect(isDemoVisionEnabled()).toBe(false);
  });
});
