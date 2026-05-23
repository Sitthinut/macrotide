// Renders the active-preference block injected into the chat system prompt.
//
// Discipline (see docs/features/memory.md § Injection format,
// § Why "frozen for the session"):
//   - Loaded once at session start; never mutates mid-stream.
//   - Deterministic ordering: categories alphabetical, rows by id ascending.
//   - Byte-identical output for identical inputs → prefix cache hits on turn 2+.
//   - Empty active set → returns "" so callers can skip prepending entirely.
import { createHash } from "node:crypto";
import { listActive, type Preference, type PreferenceCategory } from "../db/queries/preferences";

// Headings are user-visible inside the system prompt; keep them in sync with
// the example in docs/features/memory.md § Injection format. Category enum
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

export interface BuildMemoryBlockOptions {
  // Hook for tests: inject a fixed row set instead of querying the DB. The
  // default (undefined) loads via listActive(userId).
  rows?: Preference[];
}

export function buildMemoryBlock(
  userId: string | null,
  opts: BuildMemoryBlockOptions = {},
): string {
  const rows = opts.rows ?? listActive(userId);
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
      lines.push(`- ${row.content}`);
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
