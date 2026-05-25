"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatThreadList } from "@/components/ChatThreadList";
import { FeedbackRow } from "@/components/FeedbackRow";
import { Icon } from "@/components/Icon";
import { invalidate } from "@/lib/fetchers/swr";
import { AI_PERSONALITIES } from "@/lib/static/personalities";

const ACTIVE_THREAD_KEY = "macrotide_chat_active_thread";

interface PlanProposal {
  section: string;
  rationale: string;
  add: string | null;
  rm: string | null;
}

// A holding the advisor proposed via the propose_holding tool. Mirrors the
// payload POST /api/holdings/propose accepts; rendered as a HoldingProposalCard.
interface HoldingProposal {
  ticker: string;
  englishName: string;
  thaiName: string | null;
  units: number;
  avgCost: number | null;
  ter: number | null;
  assetClass: string | null;
  region: string | null;
  quoteSource: string;
  bucketId: string | null;
  source: string | null;
  rationale: string;
}

interface Message {
  role: "user" | "ai";
  text: string;
  ts: number;
  // Stable identity for streaming updates. `ts` is for display only — two
  // messages can share a ms if they're queued in the same event-loop tick.
  id: string;
  proposal?: PlanProposal;
  applied?: boolean;
  rejected?: boolean;
  // A turn can yield MANY holding proposals (one per extracted statement row),
  // so unlike `proposal` these are a keyed list with per-card accept/reject
  // state tracked by index.
  holdings?: HoldingProposal[];
  holdingStatus?: Record<number, "applied" | "rejected">;
  // Set on a failed/empty assistant turn so the UI can offer a "Try again"
  // button that re-sends the preceding user message.
  canRetry?: boolean;
}

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface MsgFeedback {
  rating?: "up" | "down" | null;
  saved?: boolean;
}

// A seed message can be a plain string (shown verbatim as the user turn) or a
// split { display, send } pair: `display` is the short visible bubble, `send`
// is the larger payload actually sent to the model. The OCR handoff uses the
// split form so the raw transcription stays out of the visible message body.
export type SeedPrompt = string | { display: string; send: string };

export interface ChatScreenProps {
  persona?: string;
  seedPrompt?: SeedPrompt | null;
  onPromptConsumed?: () => void;
}

function PlanProposalCard({
  proposal,
  applied,
  onApply,
  onReject,
}: {
  proposal: PlanProposal;
  applied?: boolean;
  onApply: () => void;
  onReject: () => void;
}) {
  if (applied === true) {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
      >
        <div className="label">
          <span>✓ APPLIED TO YOUR PLAN · {proposal.section.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
          Saved to <strong style={{ fontWeight: 500 }}>{proposal.section}</strong>. View in Journal
          → Plan.
        </div>
      </div>
    );
  }
  if (applied === false) {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--card-soft)", borderColor: "var(--line)" }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          ○ DISMISSED
        </div>
      </div>
    );
  }
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>PLAN CHANGE · {proposal.section.toUpperCase()}</span>
      </div>
      <div className="diff">
        {proposal.rm && <span className="rm">{proposal.rm}</span>}
        {proposal.rm && proposal.add && "\n"}
        {proposal.add && <span className="add">{proposal.add}</span>}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
        {proposal.rationale}
      </div>
      <div className="actions">
        <button className="btn ghost sm" onClick={onReject}>
          Not now
        </button>
        <button className="btn primary sm" onClick={onApply} style={{ flex: 1 }}>
          <Icon name="check" size={12} /> Apply to plan
        </button>
      </div>
    </div>
  );
}

function HoldingProposalCard({
  holding,
  status,
  onApply,
  onReject,
}: {
  holding: HoldingProposal;
  status?: "applied" | "rejected";
  onApply: () => void;
  onReject: () => void;
}) {
  if (status === "applied") {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
      >
        <div className="label">
          <span>✓ ADDED · {holding.ticker.toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
          Saved to your portfolio. View it in your holdings.
        </div>
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div
        className="plan-proposal"
        style={{ background: "var(--card-soft)", borderColor: "var(--line)" }}
      >
        <div
          style={{
            fontSize: 12,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          ○ SKIPPED · {holding.ticker.toUpperCase()}
        </div>
      </div>
    );
  }
  const facts = [
    `${holding.units} units`,
    holding.avgCost != null ? `@ ฿${holding.avgCost.toLocaleString()}` : null,
    holding.assetClass,
    holding.region,
  ].filter(Boolean);
  return (
    <div className="plan-proposal">
      <div className="label">
        <Icon name="sparkle" size={12} />
        <span>ADD HOLDING · {holding.ticker.toUpperCase()}</span>
      </div>
      <div className="diff">
        <span className="add">
          {holding.englishName}
          {facts.length > 0 ? `\n${facts.join(" · ")}` : ""}
        </span>
      </div>
      {holding.rationale && (
        <div style={{ fontSize: 11.5, color: "var(--ink-soft)", lineHeight: 1.45 }}>
          {holding.rationale}
        </div>
      )}
      <div className="actions">
        <button className="btn ghost sm" onClick={onReject}>
          Skip
        </button>
        <button className="btn primary sm" onClick={onApply} style={{ flex: 1 }}>
          <Icon name="check" size={12} /> Add to portfolio
        </button>
      </div>
    </div>
  );
}

export function ChatScreen({ persona = "advisor", seedPrompt, onPromptConsumed }: ChatScreenProps) {
  void persona; // single advisor persona for MVP

  const initial = useMemo<Message[]>(
    () => [
      {
        role: "ai",
        text: "Hi — I'm your index-investing advisor. Ask me about your portfolio, your plan, or how index investing works. If you don't have a plan yet, say \"help me write my plan\" and I'll walk you through it.",
        ts: Date.now(),
        id: makeId(),
      },
    ],
    [],
  );

  const [messages, setMessages] = useState<Message[]>(initial);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [msgFeedback, setMsgFeedback] = useState<Record<number, MsgFeedback>>({});
  const [showThreads, setShowThreads] = useState(false);
  // Set when the server signals it crossed ~80% of the model context budget
  // (header `x-context-summarized`). Earlier turns are summarized in the
  // model's input view; we surface a banner suggesting a fresh chat rather
  // than condensing silently. See docs/explanation/memory.md § mid-chat.
  const [contextNotice, setContextNotice] = useState(false);
  // Set when the server rejects a turn because the user hit their daily token
  // budget (header `x-daily-limit`). Resets at UTC midnight
  // server-side; the banner just nudges the user to come back.
  const [limitNotice, setLimitNotice] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  // Tracks which thread ids we've already tried to title in this session, so
  // a slow title-endpoint response doesn't get re-fired while the user keeps
  // chatting. The server is idempotent regardless, but this saves the round
  // trip + the SWR invalidate churn.
  const titledRef = useRef<Set<string>>(new Set());
  // Mirror of threadId for callbacks that must not re-bind on every switch
  // (e.g. newChat reads it without taking threadId as a dep).
  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);
  // True once the user has sent a message into the current thread that hasn't
  // been closed yet. Gates the close beacon so we never spend an extraction
  // model call on a session with no NEW activity — a refresh, or reopening a
  // thread just to read it. Token-efficiency: extract only when there's
  // something new to extract, and only once per session.
  const dirtyRef = useRef(false);

  // Real-time session close for the OUTGOING thread — on New Chat, thread
  // switch, or the page going away (pagehide). The server extracts durable
  // facts + marks the thread idle (lib/memory/session-close.ts), once per
  // session. Fire-and-forget: idempotent + best-effort server-side, so we
  // ignore the response. Prefers `sendBeacon` (survives unload) with a
  // keepalive `fetch` fallback. No-ops unless the session is dirty.
  const closeOutgoing = useCallback((id: string | null) => {
    if (!id || !dirtyRef.current || typeof navigator === "undefined") return;
    dirtyRef.current = false;
    const url = `/api/chat/threads/${encodeURIComponent(id)}/close`;
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  }, []);

  // Close the active session when the page goes away (tab/window close,
  // navigation, bfcache). `pagehide` is the reliable unload signal;
  // `beforeunload` is not. This is what catches "user closed the window
  // without clicking New Chat".
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHide = () => closeOutgoing(threadIdRef.current);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [closeOutgoing]);

  const loadThread = useCallback(
    async (id: string): Promise<boolean> => {
      // Close the thread we're leaving (no-op on first load / same thread).
      if (id !== threadIdRef.current) closeOutgoing(threadIdRef.current);
      try {
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}`);
        if (!res.ok) return false;
        const { messages: rows } = (await res.json()) as {
          messages: Array<{ id: number; role: string; content: string; createdAt: string }>;
        };
        setThreadId(id);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_THREAD_KEY, id);
        }
        setMessages(
          rows.length === 0
            ? initial
            : rows.map((r) => ({
                role: r.role === "assistant" ? "ai" : "user",
                text: r.content,
                ts: Date.parse(r.createdAt) || Date.now(),
                id: `db-${r.id}`,
              })),
        );
        setMsgFeedback({});
        setContextNotice(false);
        return true;
      } catch {
        return false;
      }
    },
    [initial, closeOutgoing],
  );

  // Hydrate the most recently active thread on mount. If the server doesn't
  // know about the stored id (e.g. demo session restarted, DB wiped), we silently
  // discard the stale id and start fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTIVE_THREAD_KEY);
    if (!stored) return;
    let cancelled = false;
    (async () => {
      const ok = await loadThread(stored);
      if (cancelled) return;
      if (!ok && typeof window !== "undefined") {
        window.localStorage.removeItem(ACTIVE_THREAD_KEY);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadThread]);

  const newChat = useCallback(() => {
    // Close the session we're leaving before clearing it (real-time extraction).
    closeOutgoing(threadIdRef.current);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_THREAD_KEY);
    }
    setThreadId(null);
    setMessages(initial);
    setMsgFeedback({});
    setContextNotice(false);
  }, [initial, closeOutgoing]);

  // Keyboard shortcut: ⌘/Ctrl+K opens a new chat. We swallow the event so the
  // browser's "search bar" default (Firefox) doesn't also fire. Disabled
  // while a turn is in flight — same constraint as the topbar's "New chat"
  // button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "k") return;
      if (loading) return;
      e.preventDefault();
      newChat();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [newChat, loading]);

  // Cross-component bus for the in-panel thread list (desktop/tablet right
  // rail). The list lives in ChatPanel, which can't reach this component's
  // threadId/loadThread/newChat directly without prop-drilling — so we use the
  // same window-CustomEvent pattern the portfolio panel uses. Mobile keeps
  // driving the drawer through props and ignores this entirely.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLoad = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id && id !== threadId) void loadThread(id);
    };
    const onNew = () => newChat();
    const onRequest = () => {
      window.dispatchEvent(new CustomEvent("chat-active-changed", { detail: threadId }));
    };
    window.addEventListener("chat-load-thread", onLoad);
    window.addEventListener("chat-new", onNew);
    window.addEventListener("chat-active-request", onRequest);
    return () => {
      window.removeEventListener("chat-load-thread", onLoad);
      window.removeEventListener("chat-new", onNew);
      window.removeEventListener("chat-active-request", onRequest);
    };
  }, [threadId, loadThread, newChat]);

  // Broadcast the active thread so the in-panel list highlights the right row.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("chat-active-changed", { detail: threadId }));
  }, [threadId]);

  /**
   * Fire-and-forget auto-title trigger. Called after the first turn pair
   * completes on a brand-new thread. The server is idempotent so a duplicate
   * POST is harmless; `titledRef` just avoids the redundant round trip.
   */
  const maybeAutoTitle = useCallback(async (id: string) => {
    if (titledRef.current.has(id)) return;
    titledRef.current.add(id);
    try {
      const res = await fetch(`/api/chat/threads/${encodeURIComponent(id)}/title`, {
        method: "POST",
      });
      if (!res.ok) {
        // Allow a retry on the next turn-pair completion — the server probably
        // just didn't have the assistant message persisted yet.
        titledRef.current.delete(id);
        return;
      }
      // Refresh the sidebar so the new title surfaces next time the drawer
      // opens. Matches the existing SWR pattern in this file.
      void invalidate("/api/chat/threads");
    } catch {
      titledRef.current.delete(id);
    }
  }, []);

  // Auto-scroll to the bottom whenever messages grow or the streaming text
  // changes. We track the last message's text length so streamed deltas tick
  // the effect without re-rendering it on every keystroke in the composer.
  const lastText = messages[messages.length - 1]?.text ?? "";
  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [messages.length, lastText]);

  const askLive = async (prompt: string, history: Message[]) => {
    setLoading(true);
    // New user turn → this session now has content worth extracting when it
    // closes (gates the close beacon; see closeOutgoing).
    dirtyRef.current = true;
    // Build the model conversation from prior turns + this new prompt.
    const model = [
      // Send each turn's text. The `proposal` field is UI-only metadata and is
      // never forwarded (we only pass role + text), but the assistant prose that
      // accompanied a proposal IS part of the conversation, so keep these turns.
      ...history.map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text,
      })),
      { role: "user" as const, content: prompt },
    ];

    // Reserve the placeholder assistant message we'll stream into.
    const placeholderId = makeId();
    setMessages((m) => [...m, { role: "ai", text: "", ts: Date.now(), id: placeholderId }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: model, threadId: threadId ?? undefined }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`chat failed (${res.status})`);
      }
      const ctxHeader = res.headers.get("x-context-summarized");
      if (ctxHeader === "1" || ctxHeader === "over") setContextNotice(true);
      // Daily token budget hit — the server streams a plain-text explanation
      // (rendered as the assistant turn) and flags it here so we also show a
      // dismissible banner above the composer.
      if (res.headers.get("x-daily-limit") === "reached") setLimitNotice(true);
      const returnedThread = res.headers.get("x-thread-id");
      if (returnedThread && returnedThread !== threadId) {
        setThreadId(returnedThread);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_THREAD_KEY, returnedThread);
        }
      }
      // Refresh the sidebar so the new/updated thread surfaces next time
      // the drawer opens.
      void invalidate("/api/chat/threads");

      // The route returns a UI message stream — each line is `data: <json>`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      // Tool confirmations collected from the stream. A model can run a tool
      // (e.g. save_preference) and end its turn without emitting any prose —
      // some cheaper models do this routinely. We surface the tool's own
      // message so the turn is never blank when work actually happened.
      const toolMessages: string[] = [];
      // propose_holding can fire multiple times in one turn (one per extracted
      // statement row). Accumulate them here and attach the growing list to the
      // streaming assistant message so each card appears as it arrives.
      const holdingProposals: HoldingProposal[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const event = JSON.parse(payload);
            // UIMessage stream emits various event types; collect text from
            // any text-delta or text shape so we work regardless of which
            // event variant the model emits.
            const delta: string | undefined =
              event.delta ?? event.text ?? event.textDelta ?? undefined;
            if (delta && (event.type?.startsWith("text") || !event.type)) {
              accumulated += delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholderId ? { ...m, text: accumulated } : m)),
              );
            }
            // Tool result, regardless of the exact event variant: our memory
            // tools return `{ message: string }`. Pull it from common shapes.
            const toolOut: unknown = event.output ?? event.result ?? undefined;
            if (toolOut && typeof toolOut === "object" && "message" in toolOut) {
              const msg = (toolOut as { message?: unknown }).message;
              if (typeof msg === "string" && msg.trim()) toolMessages.push(msg.trim());
            }
            // propose_plan_edit emits a `proposal` in its tool output (the
            // PlanProposal shape the card expects). Attach it to the streaming
            // assistant message so PlanProposalCard renders with Accept/Not now.
            if (toolOut && typeof toolOut === "object" && "proposal" in toolOut) {
              const p = (toolOut as { proposal?: unknown }).proposal;
              if (p && typeof p === "object" && "section" in p && "add" in p) {
                const raw = p as Partial<PlanProposal>;
                const proposal: PlanProposal = {
                  section: String(raw.section ?? "Plan"),
                  rationale: String(raw.rationale ?? ""),
                  add: raw.add ?? null,
                  rm: raw.rm ?? null,
                };
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, proposal } : m)),
                );
              }
            }
            // propose_holding emits a `holding` in its tool output. Collect each
            // one and re-attach the full list so the cards render incrementally.
            if (toolOut && typeof toolOut === "object" && "holding" in toolOut) {
              const h = (toolOut as { holding?: unknown }).holding;
              if (h && typeof h === "object" && "ticker" in h && "units" in h) {
                const raw = h as Partial<HoldingProposal>;
                holdingProposals.push({
                  ticker: String(raw.ticker ?? ""),
                  englishName: String(raw.englishName ?? raw.ticker ?? ""),
                  thaiName: raw.thaiName ?? null,
                  units: Number(raw.units ?? 0),
                  avgCost: raw.avgCost ?? null,
                  ter: raw.ter ?? null,
                  assetClass: raw.assetClass ?? null,
                  region: raw.region ?? null,
                  quoteSource: String(raw.quoteSource ?? "yahoo"),
                  bucketId: raw.bucketId ?? null,
                  source: raw.source ?? null,
                  rationale: String(raw.rationale ?? ""),
                });
                const snapshot = [...holdingProposals];
                setMessages((prev) =>
                  prev.map((m) => (m.id === placeholderId ? { ...m, holdings: snapshot } : m)),
                );
              }
            }
          } catch {
            // Some events are not JSON (heartbeats, [DONE]); ignore.
          }
        }
      }

      // Fail-safe: if the model emitted no prose, fall back to the tool
      // confirmation(s); if there were none either, show a calm note rather
      // than a scary "check server logs" message. The dashboard is unaffected
      // regardless of what the LLM did.
      if (!accumulated) {
        const hadTool = toolMessages.length > 0;
        const fallback = hadTool
          ? toolMessages.join("\n\n")
          : "I didn't have a reply for that — your dashboard and notes are unaffected.";
        setMessages((prev) =>
          prev.map((m) =>
            // Offer retry only on a genuinely empty turn (no tool ran). When a
            // tool ran, the work succeeded — no point retrying.
            m.id === placeholderId ? { ...m, text: fallback, canRetry: !hadTool } : m,
          ),
        );
        // A tool ran even though no prose came back — refresh memory views and
        // still attempt the auto-title so the thread doesn't stay "Untitled".
        if (toolMessages.length) {
          void invalidate("/api/memory/preferences");
          const tid = returnedThread ?? threadId;
          if (tid) void maybeAutoTitle(tid);
        }
      } else {
        // First turn pair just completed on a thread we haven't titled yet —
        // ask the server to auto-title it. Idempotent server-side; the ref
        // dedup is just to avoid the round trip on subsequent turns.
        const tid = returnedThread ?? threadId;
        if (tid) void maybeAutoTitle(tid);
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                text: `Chat error: ${err instanceof Error ? err.message : "unknown"}. The dashboard still works; this just means AI hasn't been configured (or the demo turn cap was hit).`,
                canRetry: true,
              }
            : m,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  // `display` is the visible user bubble; `send` is what's actually sent to the
  // model. They differ only for the OCR handoff, where the raw transcription
  // rides along in `send` but stays out of the visible body. Default: identical.
  const ask = (display: string, send: string = display) => {
    if (!display.trim() || loading) return;
    const newUserMsg: Message = { role: "user", text: display, ts: Date.now(), id: makeId() };
    const nextHistory = [...messages, newUserMsg];
    setMessages(nextHistory);
    setInput("");

    // Plan edits now flow through the advisor's propose_plan_edit tool, and
    // holding extraction through propose_holding: the model emits proposals in
    // the chat stream, which askLive picks up and renders as cards. No
    // client-side heuristic / fake preview.
    void askLive(send, messages);
  };

  // Re-send the user message that produced a failed/empty assistant turn.
  // Drops the failed placeholder, then replays the preceding user turn with
  // the same prior history (askLive re-appends the prompt itself).
  const retry = (failedId: string) => {
    if (loading) return;
    const withoutFailed = messages.filter((m) => m.id !== failedId);
    const last = withoutFailed[withoutFailed.length - 1];
    if (!last || last.role !== "user") return;
    setMessages(withoutFailed);
    void askLive(last.text, withoutFailed.slice(0, -1));
  };

  const suggestions = [
    "How am I doing vs my target?",
    "Add a rule: no individual stocks",
    "Update my risk to 25% drawdown",
    "When should I rebalance?",
    "What's a 3-fund portfolio?",
    "Why index over active?",
  ];

  useEffect(() => {
    if (seedPrompt) {
      if (typeof seedPrompt === "string") ask(seedPrompt);
      else ask(seedPrompt.display, seedPrompt.send);
      onPromptConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt, onPromptConsumed, ask]);

  const applyProposal = async (idx: number, proposal: PlanProposal) => {
    // Optimistic: mark applied immediately, roll back on failure.
    setMessages((prev) => prev.map((x, i) => (i === idx ? { ...x, applied: true } : x)));
    try {
      // Single server round trip — the route reads the current plan, applies
      // the additive edit (applyPlanEdit), and upserts it, all per-user scoped.
      const res = await fetch("/api/plan/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: proposal.section,
          add: proposal.add,
          rm: proposal.rm,
        }),
      });
      if (!res.ok) throw new Error(`plan edit ${res.status}`);
      invalidate("/api/plan");
    } catch (err) {
      // Roll back the optimistic apply and surface the error inline.
      setMessages((prev) =>
        prev.map((x, i) =>
          i === idx
            ? {
                ...x,
                applied: undefined,
                text: `${x.text}\n\n(Couldn't save: ${err instanceof Error ? err.message : "unknown error"}. Try again?)`,
              }
            : x,
        ),
      );
    }
  };

  // Accept a single holding proposal: optimistically mark it applied, POST to
  // the per-user-scoped accept route, then invalidate the holdings SWR cache so
  // the portfolio refreshes. Rolls back on failure. `msgIdx` is the message in
  // the stream; `holdingIdx` is which card within that message's list.
  const applyHolding = async (msgIdx: number, holdingIdx: number, holding: HoldingProposal) => {
    setMessages((prev) =>
      prev.map((x, i) =>
        i === msgIdx ? { ...x, holdingStatus: { ...x.holdingStatus, [holdingIdx]: "applied" } } : x,
      ),
    );
    try {
      const res = await fetch("/api/holdings/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketId: holding.bucketId,
          ticker: holding.ticker,
          englishName: holding.englishName,
          thaiName: holding.thaiName,
          assetClass: holding.assetClass,
          region: holding.region,
          units: holding.units,
          avgCost: holding.avgCost,
          ter: holding.ter,
          quoteSource: holding.quoteSource,
          source: holding.source,
        }),
      });
      if (!res.ok) throw new Error(`holding save ${res.status}`);
      invalidate(/^\/api\/holdings/);
    } catch (err) {
      // Roll back the optimistic apply and surface the error inline.
      setMessages((prev) =>
        prev.map((x, i) => {
          if (i !== msgIdx) return x;
          const next = { ...x.holdingStatus };
          delete next[holdingIdx];
          return {
            ...x,
            holdingStatus: next,
            text: `${x.text}\n\n(Couldn't save ${holding.ticker}: ${
              err instanceof Error ? err.message : "unknown error"
            }. Try again?)`,
          };
        }),
      );
    }
  };

  const rejectHolding = (msgIdx: number, holdingIdx: number) => {
    setMessages((prev) =>
      prev.map((x, i) =>
        i === msgIdx
          ? { ...x, holdingStatus: { ...x.holdingStatus, [holdingIdx]: "rejected" } }
          : x,
      ),
    );
  };

  return (
    <div
      // .chat-shell sets the screen's height as a CSS rule rather than inline
      // so the wide-screen panel override (.ra-chat-body .screen { height: 100% })
      // can win on specificity — inline `height` would block it.
      className="screen chat-shell"
    >
      <div className="topbar">
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => setShowThreads(true)}
          disabled={loading}
          aria-label="Open chat list"
          title="All chats"
          style={{ padding: "4px 8px" }}
        >
          <Icon name="menu" size={14} />
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>{AI_PERSONALITIES.advisor.label}</span>
          <span
            className="brand-chip"
            style={{
              background: "var(--accent-soft)",
              color: "var(--accent-ink)",
              borderColor: "transparent",
            }}
          >
            ● INDEX TEACHER
          </span>
        </div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={newChat}
          disabled={loading}
          title="Start a new conversation"
          style={{ gap: 4 }}
        >
          <Icon name="sparkle" size={12} /> New chat
        </button>
        <div className="avatar">DU</div>
      </div>

      <ChatThreadList
        open={showThreads}
        onClose={() => setShowThreads(false)}
        activeThreadId={threadId}
        onSelect={(id) => {
          if (id !== threadId) {
            void loadThread(id);
          }
        }}
        onNewChat={newChat}
      />

      <div
        className="chat-stream"
        ref={streamRef}
        // `min-height: 0` lets flex:1 shrink below content size so overflow-y
        // actually kicks in (otherwise long messages push the composer off-screen).
        style={{ flex: 1, paddingBottom: 8, minHeight: 0, overflowY: "auto" }}
      >
        {messages.map((m, i) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "ai" && (
              <div className="meta">
                Advisor ·{" "}
                {new Date(m.ts).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            )}
            {m.role === "ai" && !m.text && loading ? (
              <div className="typing">
                <span></span>
                <span></span>
                <span></span>
              </div>
            ) : (
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            )}
            {m.canRetry && (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => retry(m.id)}
                disabled={loading}
                style={{ marginTop: 6 }}
              >
                Try again
              </button>
            )}
            {m.proposal && (
              <PlanProposalCard
                proposal={m.proposal}
                applied={m.applied}
                onApply={() => applyProposal(i, m.proposal!)}
                onReject={() => {
                  setMessages((prev) =>
                    prev.map((x, idx) =>
                      idx === i ? { ...x, applied: false, rejected: true } : x,
                    ),
                  );
                }}
              />
            )}
            {m.holdings?.map((h, hIdx) => (
              <HoldingProposalCard
                key={`${m.id}-holding-${hIdx}`}
                holding={h}
                status={m.holdingStatus?.[hIdx]}
                onApply={() => applyHolding(i, hIdx, h)}
                onReject={() => rejectHolding(i, hIdx)}
              />
            ))}
            {m.role === "ai" && i > 0 && !m.proposal && !m.holdings?.length && (
              <FeedbackRow
                label="HELPFUL?"
                value={msgFeedback[i]?.rating ?? null}
                saved={msgFeedback[i]?.saved}
                onChange={(rating) =>
                  setMsgFeedback({
                    ...msgFeedback,
                    [i]: { ...msgFeedback[i], rating },
                  })
                }
                onSave={() =>
                  setMsgFeedback({
                    ...msgFeedback,
                    [i]: { ...msgFeedback[i], saved: !msgFeedback[i]?.saved },
                  })
                }
              />
            )}
          </div>
        ))}
        {/* Standalone "thinking" bubble only when there's no streaming
            placeholder yet — i.e. proposal flow with 700ms setTimeout. The
            stream flow renders typing dots inline inside the empty AI msg. */}
        {loading && messages[messages.length - 1]?.role !== "ai" && (
          <div className="msg ai">
            <div className="meta">Advisor · thinking</div>
            <div className="typing">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
      </div>

      {contextNotice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 8px 6px",
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--ink-soft)",
            background: "var(--card-soft)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <Icon name="sparkle" size={12} />
          <span style={{ flex: 1 }}>
            This chat is getting long — earlier turns are summarized to keep replies fast. Start a
            new chat for a clean slate.
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={newChat}
            disabled={loading}
            style={{ flexShrink: 0 }}
          >
            New chat
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setContextNotice(false)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, padding: "4px 8px" }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {limitNotice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 8px 6px",
            padding: "8px 10px",
            fontSize: 12,
            lineHeight: 1.4,
            color: "var(--ink-soft)",
            background: "var(--card-soft)",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <Icon name="sparkle" size={12} />
          <span style={{ flex: 1 }}>
            You've reached today's chat usage limit. It resets at midnight UTC — your dashboard and
            saved notes are unaffected.
          </span>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setLimitNotice(false)}
            aria-label="Dismiss"
            style={{ flexShrink: 0, padding: "4px 8px" }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      <div className="suggested-chips">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => ask(s)} disabled={loading}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your portfolio, target, or rebalancing…"
          disabled={loading}
        />
        <button type="submit" disabled={!input.trim() || loading}>
          <Icon name="send" size={14} />
        </button>
      </form>

      {/*
        Persistent AI disclaimer. Verbatim project-wide string — see
        AGENTS.md § Product copy & vocabulary. Plain muted text, not
        dismissible, not a banner.
      */}
      <div
        role="note"
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "var(--muted)",
          padding: "6px 12px 8px",
          lineHeight: 1.4,
        }}
      >
        Advisor is AI and can make mistakes.
      </div>
    </div>
  );
}
