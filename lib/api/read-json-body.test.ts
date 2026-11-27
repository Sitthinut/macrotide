import { describe, expect, it } from "vitest";
import { readJsonBody } from "./read-json-body";

function req(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers,
    body,
    ...(typeof body === "string" ? {} : { duplex: "half" }),
  } as RequestInit);
}

/** A stream with no declared length, sent in two chunks. */
function chunked(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  const mid = Math.floor(bytes.length / 2);
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, mid));
      c.enqueue(bytes.slice(mid));
      c.close();
    },
  });
}

describe("readJsonBody", () => {
  const body = JSON.stringify({ a: "x".repeat(20) });
  const size = new TextEncoder().encode(body).length;

  it("parses a body under and at the limit", async () => {
    expect(await readJsonBody(req(body), size + 1)).toEqual({ ok: true, value: JSON.parse(body) });
    expect(await readJsonBody(req(body), size)).toEqual({ ok: true, value: JSON.parse(body) });
  });

  it("refuses a body over the limit", async () => {
    expect(await readJsonBody(req(body), size - 1)).toEqual({ ok: false, reason: "too_large" });
  });

  it("counts bytes when the length isn't declared", async () => {
    expect(await readJsonBody(req(chunked(body)), size)).toMatchObject({ ok: true });
    expect(await readJsonBody(req(chunked(body)), size - 1)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("counts bytes, not characters", async () => {
    const thai = JSON.stringify("ก".repeat(10)); // 3 bytes per character
    expect(await readJsonBody(req(thai), thai.length + 5)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("accepts a leading byte-order mark, as req.json() does", async () => {
    expect(await readJsonBody(req(chunked(`﻿${body}`)), size + 3)).toEqual({
      ok: true,
      value: JSON.parse(body),
    });
  });

  it("refuses a declared length over the limit without reading", async () => {
    const r = req(chunked(body), { "content-length": String(size + 100) });
    expect(await readJsonBody(r, size)).toEqual({ ok: false, reason: "too_large" });
  });

  it("reports bad JSON and a missing body", async () => {
    expect(await readJsonBody(req("{nope"), 100)).toEqual({ ok: false, reason: "bad_json" });
    expect(await readJsonBody(new Request("http://localhost/x", { method: "POST" }), 100)).toEqual({
      ok: false,
      reason: "bad_json",
    });
  });
});
