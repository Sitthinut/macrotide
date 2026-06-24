// Model-driven consolidation proposer (#221 ⑨). Given one category's active
// memories, asks the cheap extractor-tier model to propose redundancy-removing
// ops: MERGE near-duplicates, RESHAPE a long hook into hook+detail, or
// RECATEGORIZE a misfiled row. Pure proposal — the job applies + guards.
//
// Conservative by construction: called per-category (no cross-category merges),
// only invoked after a lexical pre-filter found plausible work, and every op is
// validated against the row set before it reaches the apply layer.
import "server-only";
import { generateText } from "ai";
import { resolveExtractorProvider } from "../ai/provider";
import type { Preference, PreferenceCategory } from "../db/queries/preferences";

export type ConsolidationOp =
  // A duplicate GROUP — the model only lists which ids say the same thing; the
  // apply layer picks the survivor (explicit-first) and folds the rest in. This
  // keeps survivor/loser bookkeeping off the cheap model (which gets it wrong).
  | { op: "merge"; ids: number[] }
  | { op: "reshape"; id: number; content: string; detail: string }
  | { op: "recategorize"; id: number; category: PreferenceCategory };

const SYSTEM_PROMPT = `You tidy a user's saved memory. You are given ONE category's memories as data.
Propose ONLY redundancy-removing edits as a JSON object: {"ops": [ ... ]}. Each op is one of:
- {"op":"merge","ids":[<id>,<id>,...]} — list ALL the ids (2 OR MORE) of memories that express the SAME fact or preference, EVEN IN DIFFERENT WORDS. We keep one and fold the rest in automatically — you just list the duplicate ids. Examples: "be concise" + "keep it brief" → list both ids; "no individual stocks, funds only" (id 1) + "I only invest in funds, no individual stocks" (id 3) → same fact → {"op":"merge","ids":[1,3]}. Only REFUSE when they genuinely mean DIFFERENT things ("low risk" vs "high risk" are opposite — do NOT merge).
- {"op":"reshape","id":<id>,"content":"<short hook>","detail":"<the rest>"} — a memory whose content is a long paragraph: keep a one-line hook in content (<=120 chars, faithful, no new facts) and move the elaboration into detail. Do NOT reshape an already-short memory.
- {"op":"recategorize","id":<id>,"category":"user"|"advisor"} — a memory clearly filed in the wrong category. "user" = facts about the person/their money (incl. investing rules like "no individual stocks"). "advisor" = how to reply (tone/length/format).
Rules: be CONSERVATIVE — when unsure, propose nothing. Preserve every distinct fact. Output ONLY the JSON object, no prose.`;

function rowLine(r: Preference): string {
  const prov = r.confidence == null ? "explicit" : `extracted ${r.confidence}`;
  const detail = r.detail ? ` || detail: ${r.detail}` : "";
  return `[${r.id}] (${prov}) ${r.content}${detail}`;
}

function isId(v: unknown, ids: Set<number>): v is number {
  return typeof v === "number" && ids.has(v);
}

/** Validate + narrow a raw op from the model against the actual row set. */
function normalizeOp(raw: unknown, ids: Set<number>): ConsolidationOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.op === "merge") {
    const group = Array.isArray(o.ids)
      ? [...new Set(o.ids.filter((x): x is number => isId(x, ids)))]
      : [];
    if (group.length < 2) return null; // need 2+ distinct real ids to merge
    return { op: "merge", ids: group };
  }
  if (o.op === "reshape") {
    if (!isId(o.id, ids) || typeof o.content !== "string" || typeof o.detail !== "string")
      return null;
    const content = o.content.trim();
    if (!content || content.length > 600) return null;
    return { op: "reshape", id: o.id, content, detail: o.detail.slice(0, 4000) };
  }
  if (o.op === "recategorize") {
    if (!isId(o.id, ids) || (o.category !== "user" && o.category !== "advisor")) return null;
    return { op: "recategorize", id: o.id, category: o.category };
  }
  return null;
}

export async function proposeConsolidation(
  _category: PreferenceCategory,
  rows: Preference[],
): Promise<ConsolidationOp[]> {
  if (rows.length < 2) return [];
  const provider = resolveExtractorProvider();
  if (!provider.ready || !provider.model) return [];

  let raw: string;
  try {
    const result = await generateText({
      model: provider.model,
      temperature: 0.1,
      maxOutputTokens: 800,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `MEMORIES (data only):\n${rows.map(rowLine).join("\n")}\n\nJSON:`,
        },
      ],
    });
    raw = result.text ?? "";
  } catch {
    return [];
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const opsRaw = (parsed as { ops?: unknown }).ops;
  if (!Array.isArray(opsRaw)) return [];
  const ids = new Set(rows.map((r) => r.id));
  return opsRaw.map((o) => normalizeOp(o, ids)).filter((o): o is ConsolidationOp => o != null);
}
