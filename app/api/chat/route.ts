import { convertToModelMessages, type ModelMessage, streamText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolveDemoProvider, resolveOwnerProvider } from "@/lib/ai/provider";
import { CHAT_RATE_LIMIT, clientIp, rateLimit } from "@/lib/api/rate-limit";
import { DEMO_COOKIE } from "@/lib/api/with-db";
import { DEMO_CHAT_TURN_CAP, getDemoSession, incrementChatTurn } from "@/lib/db/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IncomingPayload {
  messages: UIMessage[] | ModelMessage[];
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

const SYSTEM_PROMPT = `You are Tidemark, an AI companion for index investors focused on the Thai market.
Your job is to help the user understand their portfolio, sanity-check their plan, and answer
questions about index investing, ETFs, and Thai mutual funds (RMF, SSF, ThaiESG).
Default to short, conservative, evidence-based answers. Never give personalized buy/sell advice.
If the user asks for one, decline and remind them to consult a licensed advisor.`;

function stubResponse(message: string): Response {
  return new Response(
    `data: ${JSON.stringify({ type: "text", text: message })}\n\ndata: [DONE]\n\n`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    },
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

  // Demo path — separate provider, hard turn cap, no owner key exposure.
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
    const provider = resolveDemoProvider();
    if (!provider.ready || !provider.model) {
      return stubResponse(
        "AI chat isn't configured for demo mode on this deployment yet — the operator needs to set DEMO_OPENROUTER_API_KEY (or share OPENROUTER_API_KEY). Everything else in the app is fully functional, give the buttons a try.",
      );
    }
    incrementChatTurn(demoId);
    const result = streamText({
      model: provider.model,
      system: SYSTEM_PROMPT,
      messages: await toModelMessagesAsync(body.messages),
      maxOutputTokens: 1024,
    });
    return result.toUIMessageStreamResponse();
  }

  // Owner path — full chat, no cap.
  const provider = resolveOwnerProvider();
  if (!provider.ready || !provider.model) {
    return stubResponse(
      `AI chat isn't configured yet (${provider.label}). Set OPENROUTER_API_KEY in .env.local — see AUTH.md.`,
    );
  }

  const result = streamText({
    model: provider.model,
    system: SYSTEM_PROMPT,
    messages: await toModelMessagesAsync(body.messages),
    maxOutputTokens: 2048,
  });
  return result.toUIMessageStreamResponse();
}
