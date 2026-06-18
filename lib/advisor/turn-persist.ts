// Pure helpers for persisting an Advisor turn FAITHFULLY — no DB, network, or AI
// SDK imports, so they're unit-testable without mocking the chat route. Consumed
// by app/api/chat/route.ts at persist time.
//
// Two gaps these close (see the chat route):
//   • the UI streams every step's text, but only the FINAL step's text used to be
//     persisted → joinStepText() keeps the whole reply.
//   • tool-generated cards lived only in the browser → extractCards() lifts the
//     propose_* payloads off the turn so the route can persist them on the row.

// Minimal structural shapes — we read only the few fields we need from the AI SDK
// step objects (which carry much more). Kept loose so tests pass plain fixtures.
interface StepLike {
  text?: string;
  finishReason?: string;
  toolCalls?: ReadonlyArray<{ toolName?: string; input?: unknown; args?: unknown }>;
  toolResults?: ReadonlyArray<{ output?: unknown; result?: unknown }>;
}

/**
 * The propose_* tool payloads captured from a turn, persisted as JSON on the
 * assistant message so the in-chat cards survive reload / other devices. Shape
 * mirrors the client `Message` card fields (ChatScreen).
 */
export interface TurnCards {
  holdingsImport?: unknown;
  transactionsImport?: unknown;
  holdings?: unknown[];
  proposal?: unknown;
  // Memory writes (save/update/forget/confirm) the Advisor made this turn, so
  // the in-chat status chip survives reload AND crosses devices (the durable
  // record is Journal → Memory). Mirrors the client `Message.memoryEvents`.
  memoryEvents?: unknown[];
}

/**
 * Concatenate every step's assistant text. The UI shows text from all steps
 * (e.g. prose before a tool call + the closing line), so the persisted record
 * must too — not just the final step. Returns "" when there's nothing.
 */
export function joinStepText(steps: ReadonlyArray<StepLike>): string {
  return steps
    .map((s) => (typeof s.text === "string" ? s.text : ""))
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}

const outputOf = (tr: { output?: unknown; result?: unknown }): unknown =>
  tr.output !== undefined ? tr.output : tr.result;

/**
 * Collect a turn's propose_* tool outputs into one payload, or null when the turn
 * produced no cards. Keyed by OUTPUT SHAPE (not tool name) so propose_holding's
 * value-only branch — which emits a `holdingsImport` rather than a `holding` —
 * is captured the same way. Multiple single-holding proposals accumulate into
 * `holdings[]` to match the client's `Message.holdings`.
 */
export function extractCards(steps: ReadonlyArray<StepLike>): TurnCards | null {
  const cards: TurnCards = {};
  for (const step of steps) {
    for (const tr of step.toolResults ?? []) {
      const out = outputOf(tr);
      if (!out || typeof out !== "object") continue;
      const o = out as Record<string, unknown>;
      if (o.holdingsImport) cards.holdingsImport = o.holdingsImport;
      if (o.transactionsImport) cards.transactionsImport = o.transactionsImport;
      if (o.proposal) cards.proposal = o.proposal;
      if (o.holding) {
        cards.holdings ??= [];
        cards.holdings.push(o.holding);
      }
      if (o.memoryEvent) {
        cards.memoryEvents ??= [];
        cards.memoryEvents.push(o.memoryEvent);
      }
    }
  }
  return Object.keys(cards).length > 0 ? cards : null;
}

/**
 * One structured diagnostic line per turn, gated by DEBUG_ADVISOR=1 — the served
 * model, the step/finish-reason chain (with tool names), and each tool call's
 * full input (the extracted rows). Local-dev convenience for `npm run dev`; the
 * durable record is the persisted `cards` column. No-op unless the flag is set.
 */
export function debugLogTurn(
  path: string,
  modelId: string | null,
  steps: ReadonlyArray<StepLike>,
): void {
  if (process.env.DEBUG_ADVISOR !== "1") return;
  const chain = steps
    .map((s) => {
      const tools = (s.toolCalls ?? []).map((t) => t.toolName ?? "?").join("+");
      const reason = s.finishReason ?? "?";
      return tools ? `${reason}(${tools})` : reason;
    })
    .join(">");
  console.info(`[advisor] turn (${path}) model=${modelId ?? "unknown"} steps=[${chain}]`);
  for (const step of steps) {
    for (const t of step.toolCalls ?? []) {
      const input = t.input !== undefined ? t.input : t.args;
      console.info(`[advisor]   tool ${t.toolName ?? "?"} in=${JSON.stringify(input)}`);
    }
  }
}
