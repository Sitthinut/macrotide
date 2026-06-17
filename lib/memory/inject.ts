// Renders the active-preference block injected into the chat system prompt.
//
// Discipline (see docs/explanation/memory.md § Injection format,
// § Why "frozen for the session"):
//   - Loaded once at session start; never mutates mid-stream.
//   - Deterministic ordering: categories alphabetical, rows by id ascending.
//   - Byte-identical output for identical inputs → prefix cache hits on turn 2+.
//   - Empty active set → returns "" so callers can skip prepending entirely.
import { createHash } from "node:crypto";
import { listActive, type Preference, type PreferenceCategory } from "../db/queries/preferences";

// Headings are user-visible inside the system prompt; keep them in sync with
// the example in docs/explanation/memory.md § Injection format. Category enum
// order here is also the alphabetical render order.
const CATEGORY_HEADINGS: Record<PreferenceCategory, string> = {
  fact: "Facts",
  finance_context: "Finance context",
  profile: "Profile",
  response_style: "Response style",
};

const CATEGORY_ORDER: PreferenceCategory[] = [
  "fact",
  "finance_context",
  "profile",
  "response_style",
];

// Heading that opens the injected block. Exported so the archive-time
// extractor can strip it back out of any text it feeds to the extraction
// model (recursive-memory-pollution guard — see stripInjectedMemory).
export const MEMORY_BLOCK_HEADING = "## Your stored preferences";

// Confidence floor for *injecting* an auto-extracted preference. Explicit
// rows (source 'user_tool' / 'advisor_tool', confidence NULL) are always
// injected. Auto-extracted rows (source 'extracted') are injected only at
// confidence >= this threshold; below it they are recall-only (surfaced by
// the recall tool / Memory page, never auto-loaded). Threshold per
// docs/explanation/memory.md § open question (extracted < ~0.7 → recall-only).
export const INJECT_CONFIDENCE_THRESHOLD = 0.7;

// A preference is injectable unless it's awaiting confirmation ('pending', so
// recall-only until the user confirms) or a low-confidence auto-extracted row.
function isInjectable(row: Preference): boolean {
  if (row.status === "pending") return false;
  if (row.source === "extracted" && row.confidence != null) {
    return row.confidence >= INJECT_CONFIDENCE_THRESHOLD;
  }
  return true;
}

/**
 * Remove an injected memory block from a chunk of text. Used by the
 * archive-time extractor to strip Advisor's own stored-preferences context out
 * of the transcript before re-feeding it to the extraction model, so the model
 * doesn't "re-learn" (and re-save) facts that were only present because we
 * injected them. Idempotent and safe on text that contains no block.
 */
export function stripInjectedMemory(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === MEMORY_BLOCK_HEADING);
  if (start === -1) return text;
  // Consume the heading and the contiguous block body — blank lines, `###`
  // category subheadings, and `- ` bullets. Stop at the first line that isn't
  // part of the block (e.g. the start of the real system prompt).
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end];
    const t = l.trim();
    if (t === "" || t.startsWith("### ") || t.startsWith("- ")) {
      end++;
    } else {
      break;
    }
  }
  // Drop a single trailing blank-line separator if the block was followed by one.
  if (end < lines.length && lines[end].trim() === "") end++;
  lines.splice(start, end - start);
  return lines.join("\n").replace(/^\n+/, "").trimEnd();
}

export interface BuildMemoryBlockOptions {
  // Hook for tests: inject a fixed row set instead of querying the DB. The
  // default (undefined) loads via listActive(userId).
  rows?: Preference[];
}

export function buildMemoryBlock(
  userId: string | null,
  opts: BuildMemoryBlockOptions = {},
): string {
  // userId is carried for call-site symmetry; the query layer scopes to the
  // request user via ownedBy() context (see lib/db/queries/scope.ts).
  void userId;
  // Low-confidence auto-extracted rows are recall-only — keep them out of the
  // always-on injected block.
  const rows = (opts.rows ?? listActive()).filter(isInjectable);
  if (rows.length === 0) return "";

  // Group by category. listActive already orders by (category, id), but we
  // re-group defensively so the rendered output is stable regardless of how
  // rows arrived.
  const byCategory = new Map<PreferenceCategory, Preference[]>();
  for (const row of rows) {
    const cat = row.category as PreferenceCategory;
    const bucket = byCategory.get(cat);
    if (bucket) bucket.push(row);
    else byCategory.set(cat, [row]);
  }
  for (const bucket of byCategory.values()) {
    bucket.sort((a, b) => a.id - b.id);
  }

  const lines: string[] = ["## Your stored preferences", ""];
  for (const cat of CATEGORY_ORDER) {
    const bucket = byCategory.get(cat);
    if (!bucket || bucket.length === 0) continue;
    lines.push(`### ${CATEGORY_HEADINGS[cat]}`);
    for (const row of bucket) {
      // Inject the short index; the longer `body` is recalled on demand. Rows
      // predating progressive disclosure have no summary → fall back to content.
      lines.push(`- ${row.summary ?? row.content}`);
    }
    lines.push("");
  }
  // Trim trailing blank line so the block ends with the last bullet — keeps
  // concatenation with the rest of the system prompt clean.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

// Stable hash of the rendered block. Exposed for tests verifying the
// frozen-snapshot discipline (turn-N system prompt must be byte-identical to
// turn-1 for prefix cache to hit) and for opt-in route-level logging.
export function memoryBlockHash(block: string): string {
  return createHash("sha256").update(block, "utf8").digest("hex");
}
