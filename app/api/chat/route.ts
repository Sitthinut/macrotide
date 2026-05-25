import {
  convertToModelMessages,
  type ModelMessage,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdvisorTools } from "@/lib/advisor/tools";
import { resolveDemoProvider, resolveOwnerProvider, resolveTierProvider } from "@/lib/ai/provider";
import { compressContext, estimateTokens } from "@/lib/ai/summarize";
import { CHAT_RATE_LIMIT, clientIp, rateLimit } from "@/lib/api/rate-limit";
import { DEMO_COOKIE, withDb } from "@/lib/api/with-db";
import { getUserId, runWithDbContext } from "@/lib/db/context";
import { DEMO_CHAT_TURN_CAP, getDemoSession, incrementChatTurn } from "@/lib/db/demo";
import {
  appendMessage,
  createThread,
  getThread,
  reactivateThread,
  upsertSummary,
} from "@/lib/db/queries/chat";
import { dailyTokenBudget, getTier, isOverDailyCap, recordUsage } from "@/lib/db/queries/usage";
import { buildMemoryBlock } from "@/lib/memory/inject";
import { createMemoryTools } from "@/lib/memory/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IncomingPayload {
  messages: UIMessage[] | ModelMessage[];
  threadId?: string;
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

const SYSTEM_PROMPT = `You are Macrotide, an AI companion for index investors focused on the Thai market.
Your job is to help the user understand their portfolio, sanity-check their plan, and answer
questions about index investing, ETFs, and Thai mutual funds (RMF, SSF, ThaiESG).
Default to short, conservative, evidence-based answers. Never give personalized buy/sell advice.
If the user asks for one, decline and remind them to consult a licensed advisor.

You have tools to read the user's real data — use them instead of guessing:
- read_portfolio for their actual holdings, allocation, drift, fees, and concentration;
- read_plan for their written investing plan;
- read_journal to recall past notes, decisions, and questions.
Use write_journal to log a decision or note when the user asks.
When the user wants to add a rule/principle/risk note/target to their plan, call
propose_plan_edit — it shows them a card to confirm; it does NOT change the plan itself.
When the user wants to add holdings — including when you're handed a transcribed brokerage
statement and asked to extract positions — call propose_holding ONCE PER POSITION. It shows a
card to confirm per holding; it does NOT write anything until they Accept. Only propose rows you
can actually read from the source; omit fields you can't read rather than inventing them.
Always read before you reference numbers or propose plan changes, and never invent figures.`;

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

    // Persist the latest user message before streaming. Tool-call follow-ups
    // (assistant role at the end) are server-driven and shouldn't double-write.
    const lastMsg = body.messages[body.messages.length - 1];
    const lastRole = (lastMsg as { role?: string } | undefined)?.role;
    if (lastRole === "user" && lastUserText) {
      appendMessage({ threadId, role: "user", content: lastUserText });
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

    if (demoId) {
      const provider = resolveDemoProvider();
      if (!provider.ready || !provider.model) {
        return stubResponse(
          "AI chat isn't configured for demo mode on this deployment yet — the operator needs to set DEMO_OPENROUTER_API_KEY (or share OPENROUTER_API_KEY). Everything else in the app is fully functional, give the buttons a try.",
          threadId,
        );
      }
      incrementChatTurn(demoId);
      const finalThreadId = threadId;
      const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
      const result = streamText({
        model: provider.model,
        system,
        messages: compression.messages,
        tools,
        // Multi-step so the model can call a read tool (read_portfolio /
        // read_plan / read_journal) and then answer using the result, or
        // explain a proposal after propose_plan_edit. Token usage aggregates
        // across steps in onFinish, so 6d's per-user budget is unaffected.
        stopWhen: stepCountIs(5),
        maxOutputTokens: 1024,
        onFinish: ({ text }) => {
          if (!text) return;
          runWithDbContext(ctx, () => {
            appendMessage({ threadId: finalThreadId, role: "assistant", content: text });
          });
        },
      });
      const response = result.toUIMessageStreamResponse();
      response.headers.set("x-thread-id", finalThreadId);
      setContextHeader(response);
      return response;
    }

    const finalThreadId = threadId;

    // ── Authenticated multi-user path ──────────────────────────────────────
    // A real user means tier gating + a daily token cap. Single-owner /
    // pre-auth mode (userId === null) falls through to the legacy owner path
    // below, which is uncapped and uses the owner model chain — identical to
    // single-owner behavior.
    if (userId !== null) {
      const tier = getTier(userId);

      // Hard gate BEFORE forwarding to OpenRouter: a user already at/over the
      // cap never starts a (possibly paid) request. The cap resets at UTC
      // midnight as the usage date key rolls over.
      if (isOverDailyCap(userId, tier)) {
        const budget = dailyTokenBudget(tier);
        const limit = stubResponse(
          `You've reached today's usage limit (${budget.toLocaleString()} tokens). ` +
            `It resets at midnight UTC. Your dashboard and saved notes still work — ` +
            `come back tomorrow to keep chatting.`,
          finalThreadId,
        );
        limit.headers.set("x-daily-limit", "reached");
        return limit;
      }

      const provider = resolveTierProvider(tier);
      if (!provider.ready || !provider.model) {
        return stubResponse(
          `AI chat isn't configured yet (${provider.label}). Set OPENROUTER_API_KEY in .env.local — see docs/reference/auth-and-providers.md.`,
          finalThreadId,
        );
      }

      const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
      const result = streamText({
        model: provider.model,
        system,
        messages: compression.messages,
        tools,
        stopWhen: stepCountIs(5),
        maxOutputTokens: tier === "trusted" ? 2048 : 1024,
        onFinish: ({ text, totalUsage }) => {
          runWithDbContext(ctx, () => {
            if (text) {
              appendMessage({ threadId: finalThreadId, role: "assistant", content: text });
            }
            // Log tokens regardless of whether prose came back — a tool-only
            // turn still consumes budget. `totalUsage` aggregates across steps.
            recordUsage(userId, totalUsage?.inputTokens ?? 0, totalUsage?.outputTokens ?? 0);
          });
        },
      });
      const response = result.toUIMessageStreamResponse();
      response.headers.set("x-thread-id", finalThreadId);
      setContextHeader(response);
      return response;
    }

    // Owner path — full chat, no cap (single-owner / pre-auth mode).
    const provider = resolveOwnerProvider();
    if (!provider.ready || !provider.model) {
      return stubResponse(
        `AI chat isn't configured yet (${provider.label}). Set OPENROUTER_API_KEY in .env.local — see docs/reference/auth-and-providers.md.`,
        finalThreadId,
      );
    }

    const tools = { ...createMemoryTools({ userId }), ...createAdvisorTools({ userId }) };
    const result = streamText({
      model: provider.model,
      system,
      messages: compression.messages,
      tools,
      stopWhen: stepCountIs(5),
      maxOutputTokens: 2048,
      onFinish: ({ text }) => {
        if (!text) return;
        runWithDbContext(ctx, () => {
          appendMessage({ threadId: finalThreadId, role: "assistant", content: text });
        });
      },
    });
    const response = result.toUIMessageStreamResponse();
    response.headers.set("x-thread-id", finalThreadId);
    setContextHeader(response);
    return response;
  });
}
