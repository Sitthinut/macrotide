// Helpers for image-bearing chat turns, kept out of the streaming route handler
// so the policy is unit-testable. The chat route (app/api/chat/route.ts) detects
// whether the latest turn carries attached images, decides how to route it, and
// records a marker in the persisted user message (images are never stored
// server-side — only this text marker; see SECURITY.md).

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isImageFilePart(part: unknown): boolean {
  if (!isObj(part)) return false;
  // AI SDK v6 UIMessage file part: { type:'file', mediaType:'image/...', url }.
  const mediaType = part.mediaType;
  return part.type === "file" && typeof mediaType === "string" && mediaType.startsWith("image/");
}

/**
 * Count image attachments on the LATEST message of an incoming chat payload.
 * Handles both shapes the client may send: UIMessages with `parts[]` (the image
 * path) and ModelMessages with `content[]` (defensive — a server-built image
 * part is `{ type:'image' }`). Text-only turns return 0.
 */
export function countTurnImages(messages: readonly unknown[]): number {
  const last = messages[messages.length - 1];
  if (!isObj(last)) return 0;
  if (Array.isArray(last.parts)) return last.parts.filter(isImageFilePart).length;
  if (Array.isArray(last.content)) {
    return last.content.filter((p) => isObj(p) && p.type === "image").length;
  }
  return 0;
}

/** True when the latest turn carries at least one attached image. */
export function turnHasImages(messages: readonly unknown[]): boolean {
  return countTurnImages(messages) > 0;
}

/**
 * Persisted content for an image turn. Images aren't stored on the server, so we
 * keep the user's text plus a `[N image(s) attached]` marker so a reloaded thread
 * reads coherently. Text-only turns (count 0) are returned unchanged.
 */
export function withImageMarker(text: string, imageCount: number): string {
  if (imageCount <= 0) return text;
  const marker = `[${imageCount} image${imageCount === 1 ? "" : "s"} attached]`;
  return text ? `${text}\n\n${marker}` : marker;
}

export type VisionPath = "demo" | "tiered" | "owner";
export type VisionDecision = "text" | "vision" | "stub";

/**
 * Decide how to handle a turn:
 *   - no images → `text` (the existing text chat paths, unchanged).
 *   - images, but vision unavailable for this path → `stub` (the route serves a
 *     friendly message pointing at the Add-holdings image importer).
 *   - images + available → `vision`.
 *
 * `visionReady` is the path-appropriate vision provider's readiness (demo uses
 * the demo-flavored provider). `demoVisionEnabled` reflects the `DEMO_VISION`
 * opt-in flag and only gates the demo path.
 */
export function visionDecisionFor(
  path: VisionPath,
  hasImages: boolean,
  opts: { visionReady: boolean; demoVisionEnabled: boolean },
): VisionDecision {
  if (!hasImages) return "text";
  if (path === "demo" && !opts.demoVisionEnabled) return "stub";
  return opts.visionReady ? "vision" : "stub";
}

/** Read the `DEMO_VISION` opt-in flag (default off). */
export function isDemoVisionEnabled(): boolean {
  const v = process.env.DEMO_VISION?.trim().toLowerCase();
  return v === "on" || v === "1" || v === "true" || v === "yes";
}
