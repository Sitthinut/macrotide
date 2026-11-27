// Read a request's JSON body with a size cap. Route handlers have no default
// body limit, so a large body would otherwise be buffered and parsed whole.

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "bad_json" };

export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: false, reason: "bad_json" };

  // The declared length can be absent or wrong, so count the bytes as they arrive.
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, reason: "bad_json" };
  }
}
