import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from "ai";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  type EntryContext,
  injectEntryContext,
  parseEntryContext,
} from "@/lib/advisor/entry-context";
import {
  attachmentLimitMessage,
  countTurnImages,
  isDemoVisionEnabled,
  MAX_CHAT_ATTACHMENTS,
  visionDecisionFor,
  withImageMarker,
} from "@/lib/advisor/image-turn";
import { classifyReasoningIntent } from "@/lib/advisor/intent";
import { ADVISOR_SYSTEM_PROMPT } from "@/lib/advisor/system-prompt";
import { createAdvisorTools } from "@/lib/advisor/tools";
import {
  resolveDemoProvider,
  resolveOwnerProvider,
  resolveTierProvider,
  resolveVisionProvider,
} from "@/lib/ai/provider";
import { compressContext, estimateTokens } from "@/lib/ai/summarize";
import { CHAT_RATE_LIMIT, clientIp, rateLimit } from "@/lib/api/rate-limit";
import { DEMO_COOKIE, withDb } from "@/lib/api/with-db";
import { type DbContext, getUserId, runWithDbContext } from "@/lib/db/context";
import { DEMO_CHAT_TURN_CAP, getDemoSession, incrementChatTurn } from "@/lib/db/demo";
import {
  appendMessage,
  createThread,
  getThread,
  reactivateThread,
  upsertSummary,
} from "@/lib/db/queries/chat";
import {
  dailyTokenBudget,
  estimateCostMicros,
  getTier,
  isOverDailyCap,
  isOverDailyCostCap,
  recordUsage,
} from "@/lib/db/queries/usage";
import { buildMemoryBlock } from "@/lib/memory/inject";
import { createMemoryTools } from "@/lib/memory/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IncomingPayload {
  messages: UIMessage[] | ModelMessage[];
  threadId?: string;
  /** Structured context from an Ask-Advisor entry point (untrusted; parsed). */
  entryContext?: EntryContext;
}

async function toModelMessagesAsync(
  messages: UIMessage[] | ModelMessage[],
): Promise<ModelMessage[]> {
  const first = messages[0] as { parts?: unknown };
  if (first && Array.isArray(first.parts)) {
    return await convertToModelMessages(messages as UIMessage[]);
  }
  return messages as ModelMessage[];
}

function extractText(msg: UIMessage | ModelMessage | undefined): string {
  if (!msg) return "";
  // ModelMessage shape: { role, content: string | parts }.
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (p): p is { type: "text"; text: string } =>
          !!p && typeof p === "object" && (p as { type?: string }).type === "text",
      )
      .map((p) => p.text)
      .join("");
  }
  // UIMessage shape: { role, parts: [{ type, text? }] }.
  const parts = (msg as { parts?: unknown }).parts;
  if (Array.isArray(parts)) {
    return parts
      .filter(
        (p): p is { type: string; text: string } =>
          !!p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string",
      )
      .map((p) => p.text)
      .join("");
  }
  return "";
}

function deriveTitle(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

// The base instruction layer lives in lib/advisor/system-prompt.ts so the
// committed eval (scripts/eval) measures the exact same prompt the route sends.
const SYSTEM_PROMPT = ADVISOR_SYSTEM_PROMPT;

// Compose the system prompt with the user's active-preference block prepended.
// The block is computed once per request (frozen-for-the-session discipline;
// see docs/explanation/memory.md § Why "frozen for the session") so the prefix
// cache hits across turns of the same session. Writes from memory tools
// during this request land in the DB but do not retroactively change this
// snapshot — they take effect on the next chat.
function composeSystemPrompt(userId: string | null): string {
  const memory = buildMemoryBlock(userId);
  return memory ? `${memory}\n\n${SYSTEM_PROMPT}` : SYSTEM_PROMPT;
}

function stubResponse(message: string, threadId?: string): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  };
  if (threadId) headers["x-thread-id"] = threadId;
  return new Response(
    `data: ${JSON.stringify({ type: "text", text: message })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers },
  );
}

// Observability for the "empty turn" failure mode (issue #21). When a turn ends
// with no assistant prose the row is otherwise dropped — losing which model
// OpenRouter routed to and whether a tool ran. Logging it lets us tell a genuine
// dead-end (no tool; the model just stopped) from a tool-only turn (a read ran
// but the closing prose never came), and pin the responsible free-tier model.
// No behaviour change — diagnostic only; see docs/explanation/advisor-context.md.
function logEmptyTurn(
  path: "demo" | "tiered" | "owner",
  text: string,
  modelId: string | null | undefined,
  finishReason: string,
  steps: readonly { finishReason: string; toolCalls: readonly { toolName: string }[] }[],
): void {
  if (text) return;
  const toolNames = steps.flatMap((s) => s.toolCalls.map((t) => t.toolName));
  const stepReasons = steps.map((s) => s.finishReason).join(">");
  console.warn(
    `[advisor] empty turn (${path}): model=${modelId ?? "unknown"} ` +
      `finishReason=${finishReason} steps=[${stepReasons}] tools=[${toolNames.join(",") || "none"}]`,
  );
}

// One forced follow-up answer when a turn reads a tool but stops before writing
// prose (issue #21). Free-tier models frequently end a turn on a tool call with
// no closing text — the "I didn't have a reply" dead-end. The data is already
// gathered; this directive just makes the model speak. Tools are omitted from
// the follow-up call so it physically cannot stall on another tool call.
const RECOVER_DIRECTIVE =
  "You looked up the data above but didn't reply. Using ONLY those tool results, " +
  "answer my previous question now, in plain language. Do not call any tools.";

// Served when a turn carries images but inline vision isn't available for it.
// Both point the user at the always-on Add-holdings image importer so they're
// never stuck — the chat just can't look at the image on this path.
const VISION_DEMO_STUB =
  "Reading images in chat isn't available in the demo. Sign in with a passkey to chat about " +
  "screenshots — or use Add holdings → Image to import holdings from one.";
const VISION_DISABLED_STUB =
  "Reading images in chat isn't enabled on this deployment yet. Use Add holdings → Image to " +
  "import holdings from a screenshot.";

interface AdvisorStreamOptions {
  ctx: DbContext;
  path: "demo" | "tiered" | "owner";
  model: LanguageModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  maxOutputTokens: number;
  threadId: string;
  setContextHeader: (res: Response) => void;
  /** Persist the final assistant text. Runs inside the captured DB context. */
  persist: (text: string, modelId: string | null) => void;
  /**
   * Record token usage (and cost) even on an empty turn (free tier). Runs inside
   * ctx. Gets the served `modelId` so the caller can price the turn.
   */
  recordUsageFor?: (usage: {
    inputTokens: number;
    outputTokens: number;
    modelId: string | null;
  }) => void;
}

// Stream an advisor turn with a recover-on-empty safety net. When the first
// generation produces no prose but a tool DID run, issue one more generation
// seeded with the gathered tool results and NO tools, and append it to the same
// response stream. Model-agnostic: it doesn't depend on any free model behaving.
// See docs/explanation/advisor-context.md.
function streamAdvisorResponse(opts: AdvisorStreamOptions): Response {
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      // Run one generation, merge it into the response stream, and collect its
      // outputs. A provider error (free tier) rejects the await chain — we catch
      // it here so the turn can be retried instead of dead-ending. `useTools`
      // is off for the recover-on-empty follow-up so it can't stall again.
      const run = async (messages: ModelMessage[], useTools: boolean) => {
        const gen = streamText({
          model: opts.model,
          system: opts.system,
          messages,
          tools: useTools ? opts.tools : undefined,
          // Multi-step so the model can call a read tool then answer using the
          // result (or explain a proposal after propose_plan_edit).
          stopWhen: stepCountIs(5),
          maxOutputTokens: opts.maxOutputTokens,
        });
        writer.merge(gen.toUIMessageStream());
        try {
          const [text, steps, finishReason, response, usage] = await Promise.all([
            gen.text,
            gen.steps,
            gen.finishReason,
            gen.response,
            gen.totalUsage,
          ]);
          return { ok: true as const, text, steps, finishReason, response, usage };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[advisor] generation error (${opts.path}): ${msg}`);
          return { ok: false as const };
        }
      };

      // First attempt, with tools.
      let a = await run(opts.messages, true);
      // Retry-on-error (#21): a free-tier provider error gathered nothing to
      // recover from — re-roll the turn once (the router picks a fresh model).
      if (!a.ok) {
        console.warn(`[advisor] retrying turn after error (${opts.path})`);
        a = await run(opts.messages, true);
      }

      let text = "";
      let modelId: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;

      if (a.ok) {
        text = a.text;
        modelId = a.response.modelId ?? null;
        inputTokens = a.usage.inputTokens ?? 0;
        outputTokens = a.usage.outputTokens ?? 0;
        logEmptyTurn(opts.path, text, modelId, a.finishReason, a.steps);

        // Recover-on-empty (#21): a read tool ran but no prose came back. Re-ask
        // with the gathered tool results and NO tools so the model can only
        // write the answer.
        const ranTool = a.steps.some((s) => s.toolCalls.length > 0);
        if (!text.trim() && ranTool) {
          const followUp = [
            ...opts.messages,
            ...a.response.messages,
            { role: "user" as const, content: RECOVER_DIRECTIVE },
          ];
          const rec = await run(followUp, false);
          if (rec.ok && rec.text.trim()) {
            text = rec.text;
            modelId = rec.response.modelId ?? modelId;
            inputTokens += rec.usage.inputTokens ?? 0;
            outputTokens += rec.usage.outputTokens ?? 0;
            console.warn(`[advisor] recovered empty turn (${opts.path}) via follow-up`);
          }
        }
      }

      runWithDbContext(opts.ctx, () => {
        if (text.trim()) opts.persist(text, modelId);
        opts.recordUsageFor?.({ inputTokens, outputTokens, modelId });
      });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[advisor] stream error (${opts.path}): ${msg}`);
      return "Something interrupted that reply — your dashboard and notes are unaffected. Please try again.";
    },
  });

  const response = createUIMessageStreamResponse({ stream });
  response.headers.set("x-thread-id", opts.threadId);
  opts.setContextHeader(response);
  return response;
}

export async function POST(req: Request) {
  // IP-keyed rate limit — separate from the per-session demo turn cap; this
  // catches noisy clients regardless of whether they're owner or demo.
  const ip = clientIp(req);
  const rl = rateLimit(ip, CHAT_RATE_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: rl.resetMs },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.resetMs / 1000).toString() },
      },
    );
  }

  const store = await cookies();
  const demoId = store.get(DEMO_COOKIE)?.value;

  const body = (await req.json().catch(() => ({}))) as IncomingPayload;
  if (!body.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "expected_messages" }, { status: 400 });
  }

  // Demo turn-cap check happens before we open a DB context — the cap is
  // independent of any thread state.
  if (demoId) {
    const session = getDemoSession(demoId);
    if (!session) {
      return NextResponse.json({ error: "demo_session_expired" }, { status: 401 });
    }
    if (session.chatTurnsUsed >= DEMO_CHAT_TURN_CAP) {
      return stubResponse(
        `You've used all ${DEMO_CHAT_TURN_CAP} demo chat turns. Sign in with a passkey to keep chatting — your demo data won't carry over.`,
      );
    }
  }

  return await withDb(async (ctx) => {
    // Resolve or create a thread. A client that hasn't loaded an existing
    // thread sends no threadId — we create one here and surface it in the
    // response headers so the client can attach to it for follow-up turns.
    const lastUserText = extractText(body.messages[body.messages.length - 1]);
    let threadId = body.threadId;
    if (threadId) {
      const existing = getThread(threadId);
      if (!existing) {
        // Client referenced a thread that doesn't exist in this DB context
        // (e.g. demo session restarted). Fall through to creating a new one.
        threadId = undefined;
      }
    }
    if (!threadId) {
      const created = createThread({ title: deriveTitle(lastUserText) });
      threadId = created.id;
    }

    // Does this turn carry attached images? Detected on the RAW body (before
    // model-message conversion) so the UIMessage `file` parts are still visible.
    const imageCount = countTurnImages(body.messages);
    const hasImages = imageCount > 0;

    // Backstop the composer's per-message image cap. The UI truncates to the
    // limit, so this fires only for a caller that bypasses it — refuse with the
    // same guidance rather than feeding an unbounded image batch to the model.
    // Checked before persisting so an over-limit turn leaves no misleading marker.
    if (imageCount > MAX_CHAT_ATTACHMENTS) {
      return stubResponse(attachmentLimitMessage(imageCount), threadId);
    }

    // Persist the latest user message before streaming. Tool-call follow-ups
    // (assistant role at the end) are server-driven and shouldn't double-write.
    // Images are never stored server-side — we keep the user's text plus a
    // `[N image(s) attached]` marker so a reloaded thread reads coherently
    // (see SECURITY.md). An image-only turn (no text) still persists the marker.
    const lastMsg = body.messages[body.messages.length - 1];
    const lastRole = (lastMsg as { role?: string } | undefined)?.role;
    if (lastRole === "user" && (lastUserText || hasImages)) {
      appendMessage({ threadId, role: "user", content: withImageMarker(lastUserText, imageCount) });
      // Resume: a new user turn on an idle/archived thread flips it back to
      // active so it's eligible to close + extract again (no-op if active).
      reactivateThread(threadId);
    }

    // The authenticated user id (or `null` in single-owner / pre-auth
    // mode, plumbed by withDb → AsyncLocalStorage). Demo sessions stay `null`:
    // they share the owner's null-namespace inside their isolated per-session
    // in-memory DB (their own preference set without threading session ids
    // through the memory layer), and they're metered by the demo turn cap, not
    // the per-user token budget.
    const userId = demoId ? null : getUserId();
    const system = composeSystemPrompt(userId);
    const modelMessages = await toModelMessagesAsync(body.messages);

    // Context-budget compression. When the assembled input crosses
    // ~80% of the model's context budget, fold older turns into a summary and
    // send that in their place — the model INPUT VIEW shrinks, the persisted
    // history is untouched. Best-effort: a summarizer failure leaves the input
    // uncompressed. We surface a banner via the `x-context-summarized` header
    // (suggest/notify, not silent). See lib/ai/summarize.ts.
    const compression = await compressContext(modelMessages, {
      systemTokens: estimateTokens(system),
    });
    if (compression.compressed && compression.summary) {
      // Migration-free persistence: one SUMMARY_ROLE row per thread, excluded
      // from display + search. Never deletes user/assistant rows.
      upsertSummary(threadId, compression.summary);
    }
    const setContextHeader = (res: Response): void => {
      if (compression.thresholdCrossed) {
        res.headers.set("x-context-summarized", compression.compressed ? "1" : "over");
      }
    };

    // Structured entry context from an Ask-Advisor button (defensively parsed —
    // it's client-controlled). Rendered as a per-turn message spliced before the
    // user's question so the model can answer from the carried facts (the fee
    // comparison, the tracking gap) instead of forcing a tool round-trip. Absent
    // for ordinary turns → `messages` is exactly `compression.messages`.
    const entryCtx = parseEntryContext(body.entryContext);
    const messages = injectEntryContext(compression.messages, entryCtx);

    // Reasoning-intent gate (#58): cheaply classify whether THIS turn is genuine
    // multi-step judgment (rebalance/SSF-vs-RMF/tilt) and raise reasoning effort
    // for it, keeping the fast non-reasoning path for the common retrieve-then-
    // explain turn. Applied to owner/trusted only — free/demo stay pinned `none`
    // (cost). `undefined` when the gate is disabled → model-default reasoning.
    // Set REASONING_GATE=off to restore model-default behavior.
    const gateOn = process.env.REASONING_GATE !== "off";
    const reasoningDecision = classifyReasoningIntent(lastUserText, entryCtx);
    const reasoningEffort = gateOn ? reasoningDecision.effort : undefined;
    if (gateOn && reasoningDecision.analytical) {
      console.info(`[advisor] reasoning gate → medium (${reasoningDecision.signals.join(",")})`);
    }

    if (demoId) {
      // Image turn → demo-flavored vision provider (DEMO_OPENROUTER_API_KEY),
      // gated behind the DEMO_VISION opt-in flag; reasoning pinned off (cost).
      // Text turn → the usual demo chat provider.
      let model: LanguageModel | null;
      if (hasImages) {
        const demoVisionEnabled = isDemoVisionEnabled();
        const vision = demoVisionEnabled
          ? resolveVisionProvider({ reasoningEffort: "none", demo: true })
          : { model: null, ready: false, label: "Vision (demo off)" };
        const decision = visionDecisionFor("demo", true, {
          visionReady: vision.ready && !!vision.model,
          demoVisionEnabled,
        });
        if (decision === "stub") return stubResponse(VISION_DEMO_STUB, threadId);
        model = vision.model;
      } else {
        const provider = resolveDemoProvider();
        if (!provider.ready || !provider.model) {
          return stubResponse(
            "AI chat isn't configured for demo mode on this deployment yet — the operator needs to set DEMO_OPENROUTER_API_KEY (or share OPENROUTER_API_KEY). Everything else in the app is fully functional, give the buttons a try.",
            threadId,
          );
        }
        model = provider.model;
      }
      if (!model) return stubResponse(VISION_DISABLED_STUB, threadId);
      incrementChatTurn(demoId);
      const finalThreadId = threadId;
      const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
      return streamAdvisorResponse({
        ctx,
        path: "demo",
        model,
        system,
        messages,
        tools,
        maxOutputTokens: 1024,
        threadId: finalThreadId,
        setContextHeader,
        persist: (text, modelId) =>
          appendMessage({
            threadId: finalThreadId,
            role: "assistant",
            content: text,
            model: modelId,
          }),
      });
    }

    const finalThreadId = threadId;

    // ── Authenticated multi-user path ──────────────────────────────────────
    // A real user means tier gating + a daily token cap. Single-owner /
    // pre-auth mode (userId === null) falls through to the legacy owner path
    // below, which is uncapped and uses the owner model chain — identical to
    // single-owner behavior.
    if (userId !== null) {
      const tier = getTier(userId);

      // Hard gate BEFORE forwarding to OpenRouter: a user already at/over EITHER
      // the token cap or the optional cents cost cap never starts a (possibly
      // paid) request. Both reset at UTC midnight as the usage date key rolls
      // over. The token figure is only surfaced when the token cap is the one
      // that tripped — a cents figure is operator-internal, so a cost-cap stop
      // stays generic.
      const overTokens = isOverDailyCap(userId, tier);
      if (overTokens || isOverDailyCostCap(userId, tier)) {
        const reset =
          "It resets at midnight UTC. Your dashboard and saved notes still work — " +
          "come back tomorrow to keep chatting.";
        const message = overTokens
          ? `You've reached today's usage limit (${dailyTokenBudget(tier).toLocaleString()} tokens). ${reset}`
          : `You've reached today's usage limit. ${reset}`;
        const limit = stubResponse(message, finalThreadId);
        limit.headers.set("x-daily-limit", "reached");
        return limit;
      }

      // Image turn → the shared vision model (bounded by the daily token/cents
      // caps already checked above). Free tier pins reasoning off; trusted keeps
      // the intent-gated effort. The free-tier cost invariant holds: vision
      // derives from VISION_CHAT_MODEL, never AI_MODELS. Text turn → tier chain.
      let model: LanguageModel | null;
      if (hasImages) {
        const vision = resolveVisionProvider({
          reasoningEffort: tier === "free" ? "none" : reasoningEffort,
        });
        const decision = visionDecisionFor("tiered", true, {
          visionReady: vision.ready && !!vision.model,
          demoVisionEnabled: false,
        });
        if (decision === "stub") return stubResponse(VISION_DISABLED_STUB, finalThreadId);
        model = vision.model;
      } else {
        const provider = resolveTierProvider(tier, { reasoningEffort });
        if (!provider.ready || !provider.model) {
          return stubResponse(
            `AI chat isn't configured yet (${provider.label}). Set OPENROUTER_API_KEY in .env.local — see docs/reference/auth-and-providers.md.`,
            finalThreadId,
          );
        }
        model = provider.model;
      }
      if (!model) return stubResponse(VISION_DISABLED_STUB, finalThreadId);

      const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
      return streamAdvisorResponse({
        ctx,
        path: "tiered",
        model,
        system,
        messages,
        tools,
        maxOutputTokens: tier === "trusted" ? 2048 : 1024,
        threadId: finalThreadId,
        setContextHeader,
        persist: (text, modelId) =>
          appendMessage({
            threadId: finalThreadId,
            role: "assistant",
            content: text,
            model: modelId,
          }),
        // Log tokens (and estimated cost) regardless of whether prose came back
        // — a tool-only turn still consumes budget. Cost is 0 for free/unpriced
        // models, so this is additive and only bites a priced paid model.
        recordUsageFor: ({ inputTokens, outputTokens, modelId }) =>
          recordUsage(
            userId,
            inputTokens,
            outputTokens,
            undefined,
            estimateCostMicros(modelId, inputTokens, outputTokens),
          ),
      });
    }

    // Owner path — full chat, no cap (single-owner / pre-auth mode). Image turn
    // → the shared vision model with the intent-gated effort; text turn → the
    // owner chain.
    let model: LanguageModel | null;
    if (hasImages) {
      const vision = resolveVisionProvider({ reasoningEffort });
      const decision = visionDecisionFor("owner", true, {
        visionReady: vision.ready && !!vision.model,
        demoVisionEnabled: false,
      });
      if (decision === "stub") return stubResponse(VISION_DISABLED_STUB, finalThreadId);
      model = vision.model;
    } else {
      const provider = resolveOwnerProvider({ reasoningEffort });
      if (!provider.ready || !provider.model) {
        return stubResponse(
          `AI chat isn't configured yet (${provider.label}). Set OPENROUTER_API_KEY in .env.local — see docs/reference/auth-and-providers.md.`,
          finalThreadId,
        );
      }
      model = provider.model;
    }
    if (!model) return stubResponse(VISION_DISABLED_STUB, finalThreadId);

    const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
    return streamAdvisorResponse({
      ctx,
      path: "owner",
      model,
      system,
      messages,
      tools,
      maxOutputTokens: 2048,
      threadId: finalThreadId,
      setContextHeader,
      persist: (text, modelId) =>
        appendMessage({
          threadId: finalThreadId,
          role: "assistant",
          content: text,
          model: modelId,
        }),
    });
  });
}
