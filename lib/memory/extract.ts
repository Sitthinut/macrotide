// Session-close fact extraction.
//
// On session close (lib/memory/session-close.ts — primary, real-time; or the
// lib/jobs/close-stale-sessions.ts backstop) this summarizes the new turns and
// pulls durable facts about the user into `user_preferences` with
// `source = 'extracted'` + a confidence score. Provenance (sourceSessionId,
// sourceTurnIds) is recorded so the Memory page can show which chat a note
// came from and the user can correct false extractions.
//
// Two guards from docs/explanation/memory.md:
//   - Recursive-memory-pollution: strip Advisor's own injected memory block
//     out of the transcript before extracting, so we don't re-learn facts that
//     were only present because we injected them (Supermemory's pattern).
//   - Inject-vs-recall: low-confidence rows are saved but recall-only (the
//     injection layer filters them via INJECT_CONFIDENCE_THRESHOLD).
import "server-only";
import { generateText } from "ai";
import { resolveExtractorProvider } from "../ai/provider";
import { type ChatMessage, listMessages } from "../db/queries/chat";
import { isCategory, type PreferenceCategory, save } from "../db/queries/preferences";
import { INJECT_CONFIDENCE_THRESHOLD, stripInjectedMemory } from "./inject";

// Below this confidence we drop the candidate entirely — too noisy even for
// recall. Between this and INJECT_CONFIDENCE_THRESHOLD: saved but recall-only.
export const MIN_SAVE_CONFIDENCE = 0.3;

// Cap how much transcript we send to the cheap model — extraction is
// best-effort and we don't want to balloon token cost on a huge session.
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_SUMMARY_CHARS = 600;

const EXTRACTION_SYSTEM_PROMPT = `You extract durable, long-term facts about a user from a chat transcript with a financial advisor assistant.

Return STRICT JSON only — no prose, no code fences — matching exactly:
{"summary": string, "facts": [{"category": string, "content": string, "confidence": number}]}

- "summary": 1-2 sentences describing what the conversation was about. Plain English.
- "facts": durable preferences/facts worth remembering for FUTURE chats. Extract ONLY things the user themselves stated or clearly implied about their own situation, preferences, or constraints. Do NOT extract: transient questions, market data, the assistant's suggestions, or anything the user did not actually assert.
- "category" must be one of: "profile" (stable personal facts: risk tolerance, time horizon, age, timezone), "finance_context" (accounts, tax situation, holdings, constraints), "response_style" (how they want the advisor to communicate), "fact" (other durable one-off facts).
- "content": a short declarative phrase, e.g. "risk tolerance: moderate", "no individual stocks, funds only".
- "confidence": 0..1, how certain you are this is a durable, user-asserted fact. Use < 0.5 when it's a guess or weakly implied.
- If there are no durable facts, return an empty "facts" array. Never invent facts.`;

export interface ExtractedFact {
  category: PreferenceCategory;
  content: string;
  confidence: number;
}

export interface SavedExtraction extends ExtractedFact {
  id: number;
  /** True if confidence cleared the injection threshold (vs recall-only). */
  injected: boolean;
}

export interface ExtractionResult {
  threadId: string;
  /** Short session summary from the model (empty when extraction was skipped). */
  summary: string;
  /** Rows persisted to user_preferences this run. */
  saved: SavedExtraction[];
  /** Why we didn't run, when applicable: "no_provider" | "no_messages" | "model_error" | "no_facts". */
  skipped?: "no_provider" | "no_messages" | "model_error" | "no_facts";
  /** Provider label for telemetry. */
  provider: string;
  /**
   * Highest chat_messages.id covered by this pass (the new extraction
   * watermark). Present whenever there were turns to process — the caller
   * advances `chat_threads.extracted_through_id` to it. Undefined when there
   * were no new turns / no provider.
   */
  lastTurnId?: number;
}

/** Build a clean transcript string from user/assistant turns, memory stripped. */
function buildTranscript(
  messages: ChatMessage[],
  opts: { sinceTurnId?: number; priorSummary?: string } = {},
): { text: string; turnIds: number[]; lastTurnId: number } {
  const since = opts.sinceTurnId ?? 0;
  const turnIds: number[] = [];
  const parts: string[] = [];
  for (const m of messages) {
    if (m.id <= since) continue; // incremental: only turns newer than the watermark
    if (m.role !== "user" && m.role !== "assistant") continue; // skip tool/summary turns
    const cleaned = stripInjectedMemory(m.content).trim();
    if (!cleaned) continue;
    turnIds.push(m.id);
    const speaker = m.role === "user" ? "User" : "Advisor";
    parts.push(`${speaker}: ${cleaned}`);
  }
  const lastTurnId = turnIds.length > 0 ? Math.max(...turnIds) : since;
  let text = parts.join("\n\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the tail — most recent turns carry the freshest durable facts.
    text = text.slice(text.length - MAX_TRANSCRIPT_CHARS);
  }
  // Prepend the running summary as compressed context for the new turns, so the
  // extractor understands them without re-reading the whole prior transcript.
  const summary = opts.priorSummary?.trim();
  if (text && summary) {
    text = `Conversation so far (summary of earlier turns):\n${summary}\n\n--- New turns ---\n\n${text}`;
  }
  return { text, turnIds, lastTurnId };
}

/** Tolerantly pull the first JSON object out of a model response. */
function parseExtraction(raw: string): { summary: string; facts: unknown[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!parsed || typeof parsed !== "object") return null;
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    return { summary, facts };
  } catch {
    return null;
  }
}

/** Validate + normalize a raw fact object from the model. */
function normalizeFact(raw: unknown): ExtractedFact | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const category = typeof r.category === "string" ? r.category : "";
  const content = typeof r.content === "string" ? r.content.trim() : "";
  let confidence = typeof r.confidence === "number" ? r.confidence : Number(r.confidence);
  if (!isCategory(category) || !content) return null;
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  return { category, content: content.slice(0, 500), confidence };
}

export interface ExtractSessionOptions {
  userId?: string | null;
  /**
   * Incremental watermark: only extract turns with id greater than this.
   * Defaults to 0 (the whole thread). The caller passes the thread's
   * `extracted_through_id` so a resumed chat re-extracts only its new turns.
   */
  sinceTurnId?: number;
  /**
   * The running session summary, prepended as compressed context for the new
   * turns so the extractor understands them without re-reading old transcript.
   */
  priorSummary?: string;
}

/**
 * Summarize a session's new turns and persist durable facts to
 * user_preferences. Incremental: with `sinceTurnId`, processes only turns newer
 * than the watermark (plus `priorSummary` as context). Best-effort and
 * side-effect-tolerant: any failure (no API key, model error, unparseable
 * output) returns a `skipped` result rather than throwing.
 */
export async function extractSessionPreferences(
  threadId: string,
  opts: ExtractSessionOptions = {},
): Promise<ExtractionResult> {
  // Row scoping is by ownedBy() context — set by the close route's withDb or
  // the backstop job's runWithUserScope; the threaded userId is not re-read.
  void opts.userId;
  const provider = resolveExtractorProvider();
  const base: ExtractionResult = { threadId, summary: "", saved: [], provider: provider.label };

  if (!provider.ready || !provider.model) return { ...base, skipped: "no_provider" };

  const { text, turnIds, lastTurnId } = buildTranscript(listMessages(threadId), {
    sinceTurnId: opts.sinceTurnId,
    priorSummary: opts.priorSummary,
  });
  if (!text) return { ...base, skipped: "no_messages" };

  let rawText: string;
  try {
    const result = await generateText({
      model: provider.model,
      temperature: 0.1,
      maxOutputTokens: 700,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Transcript:\n\n${text}\n\nJSON:` }],
    });
    rawText = result.text ?? "";
  } catch {
    return { ...base, skipped: "model_error" };
  }

  const parsed = parseExtraction(rawText);
  if (!parsed) return { ...base, skipped: "model_error" };

  const summary = parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS);

  // Normalize, drop sub-threshold noise, and de-dupe on (category, content).
  const seen = new Set<string>();
  const facts: ExtractedFact[] = [];
  for (const raw of parsed.facts) {
    const fact = normalizeFact(raw);
    if (!fact || fact.confidence < MIN_SAVE_CONFIDENCE) continue;
    const key = `${fact.category}::${fact.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(fact);
  }

  // `no_facts` still advances the watermark — we processed these turns and
  // found nothing durable; no reason to re-read them next close.
  if (facts.length === 0) return { ...base, summary, skipped: "no_facts", lastTurnId };

  const saved: SavedExtraction[] = facts.map((fact) => {
    const row = save({
      category: fact.category,
      content: fact.content,
      source: "extracted",
      confidence: fact.confidence,
      sourceSessionId: threadId,
      sourceTurnIds: turnIds,
    });
    return {
      ...fact,
      id: row.id,
      injected: fact.confidence >= INJECT_CONFIDENCE_THRESHOLD,
    };
  });

  return { ...base, summary, saved, lastTurnId };
}
