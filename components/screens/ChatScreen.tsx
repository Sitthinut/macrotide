"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FeedbackRow } from "@/components/FeedbackRow";
import { Icon } from "@/components/Icon";
import { invalidate } from "@/lib/fetchers/swr";
import { applyPlanEdit } from "@/lib/portfolio/plan-edit";
import { AI_PERSONALITIES } from "@/lib/static/personalities";

const ACTIVE_THREAD_KEY = "macrotide_chat_active_thread";

interface PlanProposal {
  section: string;
  rationale: string;
  add: string | null;
  rm: string | null;
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

export interface ChatScreenProps {
  persona?: string;
  seedPrompt?: string | null;
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
  const streamRef = useRef<HTMLDivElement>(null);

  // Hydrate the most recently active thread on mount. If the server doesn't
  // know about the stored id (e.g. demo session restarted, DB wiped), we silently
  // discard the stale id and start fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(ACTIVE_THREAD_KEY);
    if (!stored) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/chat/threads/${encodeURIComponent(stored)}`);
        if (cancelled) return;
        if (!res.ok) {
          window.localStorage.removeItem(ACTIVE_THREAD_KEY);
          return;
        }
        const { messages: rows } = (await res.json()) as {
          messages: Array<{ id: number; role: string; content: string; createdAt: string }>;
        };
        if (cancelled || rows.length === 0) return;
        setThreadId(stored);
        setMessages(
          rows.map((r) => ({
            role: r.role === "assistant" ? "ai" : "user",
            text: r.content,
            ts: Date.parse(r.createdAt) || Date.now(),
            id: `db-${r.id}`,
          })),
        );
      } catch {
        // Network blip; leave the stored id alone and let the next turn retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const newChat = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_THREAD_KEY);
    }
    setThreadId(null);
    setMessages(initial);
    setMsgFeedback({});
  }, [initial]);

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
    // Build the model conversation from prior turns + this new prompt.
    const model = [
      ...history
        .filter((m) => !m.proposal) // proposals are UI-only
        .map((m) => ({
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
      const returnedThread = res.headers.get("x-thread-id");
      if (returnedThread && returnedThread !== threadId) {
        setThreadId(returnedThread);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(ACTIVE_THREAD_KEY, returnedThread);
        }
      }

      // The route returns a UI message stream — each line is `data: <json>`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

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
          } catch {
            // Some events are not JSON (heartbeats, [DONE]); ignore.
          }
        }
      }

      // If nothing streamed, surface a friendly fallback so the message slot
      // isn't blank.
      if (!accumulated) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholderId
              ? { ...m, text: "(no response — check server logs or your AI provider config)" }
              : m,
          ),
        );
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                text: `Chat error: ${err instanceof Error ? err.message : "unknown"}. The dashboard still works; this just means AI hasn't been configured (or the demo turn cap was hit).`,
              }
            : m,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const ask = (prompt: string) => {
    if (!prompt.trim() || loading) return;
    const newUserMsg: Message = { role: "user", text: prompt, ts: Date.now(), id: makeId() };
    const nextHistory = [...messages, newUserMsg];
    setMessages(nextHistory);
    setInput("");

    const isPlanEdit =
      /add|update|change|set|replace|remove/i.test(prompt) &&
      /(rule|principle|risk|target|commitment|plan)/i.test(prompt);
    if (isPlanEdit) {
      // Client-side proposal preview — purely a UI affordance for the
      // "edit my plan" affordance until we wire AI tool calls (Phase 2.6).
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        const m = prompt.match(
          /(?:add|update|change|set|replace|remove)\s+(?:a|the)?\s*(?:rule|line|principle|note|item)?\s*[:"']?(.+?)["']?$/i,
        );
        const newLine = m?.[1] ? m[1].trim() : (prompt.split("about").pop()?.trim() ?? prompt);
        const sectionGuess = /risk/i.test(prompt)
          ? "Risk"
          : /commit|rule/i.test(prompt)
            ? "Commitments"
            : /target|alloc/i.test(prompt)
              ? "Target"
              : "Principles";
        const proposal: PlanProposal = {
          section: sectionGuess,
          rationale: `Adding to your ${sectionGuess} section to reflect: "${newLine}". This will be saved to your plan and the advisor will reference it in future conversations.`,
          add: `- ${newLine}`,
          rm: null,
        };
        setMessages((m) => [
          ...m,
          {
            role: "ai",
            text: `I'll add this to your **${sectionGuess}** section. Here's the change — confirm to apply.`,
            ts: Date.now(),
            id: makeId(),
            proposal,
          },
        ]);
      }, 700);
      return;
    }

    void askLive(prompt, messages);
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
      ask(seedPrompt);
      onPromptConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt, onPromptConsumed, ask]);

  const applyProposal = async (idx: number, proposal: PlanProposal) => {
    // Optimistic: mark applied immediately, roll back on failure.
    setMessages((prev) => prev.map((x, i) => (i === idx ? { ...x, applied: true } : x)));
    try {
      const planRes = await fetch("/api/plan");
      if (!planRes.ok) throw new Error(`plan fetch ${planRes.status}`);
      const current = (await planRes.json()) as {
        markdown?: string;
        selectedModelId?: string | null;
      };
      const nextMarkdown = applyPlanEdit(current.markdown ?? "", {
        section: proposal.section,
        add: proposal.add,
        rm: proposal.rm,
      });
      const putRes = await fetch("/api/plan", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: nextMarkdown,
          selectedModelId: current.selectedModelId ?? null,
        }),
      });
      if (!putRes.ok) throw new Error(`plan put ${putRes.status}`);
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

  return (
    <div
      // .chat-shell sets the screen's height as a CSS rule rather than inline
      // so the wide-screen panel override (.ra-chat-body .screen { height: 100% })
      // can win on specificity — inline `height` would block it.
      className="screen chat-shell"
    >
      <div className="topbar">
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
            {m.role === "ai" && i > 0 && !m.proposal && (
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
    </div>
  );
}
