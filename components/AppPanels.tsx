"use client";

import { useEffect, useState } from "react";
import { ChatThreadList } from "@/components/ChatThreadList";
import { Icon } from "@/components/Icon";
import { ChatScreen, type SeedPrompt } from "@/components/screens/ChatScreen";
import {
  useJournalView,
  useModelPortfoliosView,
  usePortfolioView,
  useSelectedModelId,
} from "@/lib/fetchers/legacy";
import { computeHealth, summarizeHealth } from "@/lib/portfolio/health";

export type AppId = "chat" | "portfolios" | "plan" | "notes";

interface PanelHeaderProps {
  title: string;
  showDot?: boolean;
  onClose: () => void;
}

function PanelHeader({ title, showDot, onClose }: PanelHeaderProps) {
  return (
    <div className="ra-panel-head">
      <div className="ra-panel-title">
        {showDot && <span className="ra-dot"></span>} {title}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function ChatPanel({
  seedPrompt,
  onPromptConsumed,
  onClose,
}: {
  seedPrompt: SeedPrompt | null;
  onPromptConsumed: () => void;
  onClose: () => void;
}) {
  // In-panel view swap (Option B): the chat body and the thread list share one
  // panel. "All chats" swaps to the list; the back arrow returns to chat.
  const [view, setView] = useState<"chat" | "threads">("chat");
  // Mirror ChatScreen's active thread so the list can highlight it. ChatScreen
  // owns threadId/loadThread/newChat and stays mounted across the swap; we drive
  // it through the same window-CustomEvent bus the portfolio panel already uses,
  // which keeps ChatScreen's public prop signature untouched.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  useEffect(() => {
    const onSync = (e: Event) =>
      setActiveThreadId((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener("chat-active-changed", onSync);
    // Ask ChatScreen to broadcast its current thread on mount.
    window.dispatchEvent(new CustomEvent("chat-active-request"));
    return () => window.removeEventListener("chat-active-changed", onSync);
  }, []);

  const selectThread = (id: string) => {
    window.dispatchEvent(new CustomEvent("chat-load-thread", { detail: id }));
    setView("chat");
  };
  const startNewChat = () => {
    window.dispatchEvent(new CustomEvent("chat-new"));
    setView("chat");
  };

  return (
    <>
      {view === "chat" ? (
        <div className="ra-panel-head">
          <div className="ra-panel-title">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setView("threads")}
              aria-label="All chats"
              title="All chats"
            >
              <Icon name="menu" size={15} />
            </button>
            <span className="ra-dot"></span> Chat
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
      ) : (
        <div className="ra-panel-head">
          <div className="ra-panel-title">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setView("chat")}
              aria-label="Back to chat"
              title="Back to chat"
            >
              <Icon name="arrow-left" size={16} />
            </button>
            Chats
          </div>
          <button
            type="button"
            className="btn ghost sm"
            onClick={startNewChat}
            title="Start a new conversation (⌘K)"
            style={{ gap: 4 }}
          >
            <Icon name="sparkle" size={12} /> New
          </button>
        </div>
      )}
      {/* ChatScreen stays mounted across the swap so in-flight turns and the
          active thread survive — just hidden while the list is showing. */}
      <div
        className="ra-panel-body ra-chat-body"
        style={view === "chat" ? undefined : { display: "none" }}
      >
        <ChatScreen persona="advisor" seedPrompt={seedPrompt} onPromptConsumed={onPromptConsumed} />
      </div>
      {view === "threads" && (
        <ChatThreadList
          variant="panel"
          open
          onClose={() => setView("chat")}
          activeThreadId={activeThreadId}
          onSelect={selectThread}
          onNewChat={startNewChat}
        />
      )}
    </>
  );
}

export function PortfoliosPanel({ onClose }: { onClose: () => void }) {
  const { portfolios, isLoading } = usePortfolioView();
  const fmt = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;
  // Track active portfolio id locally; PortfolioScreen broadcasts state when
  // user navigates, so the sidebar stays in sync with whichever portfolio is
  // currently being viewed.
  const [activeId, setActiveId] = useState<string>("all");
  useEffect(() => {
    const onSync = (e: Event) => setActiveId((e as CustomEvent<string>).detail);
    window.addEventListener("portfolio-active-changed", onSync);
    // Ask PortfolioScreen to broadcast its current state on mount.
    window.dispatchEvent(new CustomEvent("portfolio-active-request"));
    return () => window.removeEventListener("portfolio-active-changed", onSync);
  }, []);
  const activate = (id: string) =>
    window.dispatchEvent(new CustomEvent("activate-portfolio", { detail: id }));
  const editPortfolio = (id: string) =>
    window.dispatchEvent(new CustomEvent("edit-portfolio", { detail: id }));

  return (
    <>
      <PanelHeader title="Portfolios" onClose={onClose} />
      <div className="ra-panel-body" style={{ padding: "10px 14px 14px" }}>
        {isLoading || !portfolios ? (
          <div style={{ padding: 12, color: "var(--muted)", fontSize: 12.5 }}>Loading…</div>
        ) : portfolios.length === 0 ? (
          <div style={{ padding: 12, color: "var(--muted)", fontSize: 12.5 }}>
            No portfolios yet.
          </div>
        ) : (
          portfolios.map((p) => (
            <div className="ra-bucket-row" key={p.id} data-active={activeId === p.id}>
              <button
                type="button"
                className="ra-bucket-card ra-bucket-card-btn"
                onClick={() => activate(p.id)}
                aria-label={`Open ${p.name}`}
                aria-current={activeId === p.id ? "true" : undefined}
              >
                <span className="ra-bucket-icon">
                  <Icon name={p.icon || "wallet"} size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div className="ra-bucket-name">{p.name}</div>
                  <div className="ra-bucket-sub">{p.holdings.length} holdings</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="num" style={{ fontSize: 12.5 }}>
                    {fmt(p.totalValue)}
                  </div>
                  <div className="delta up num">+{p.perfPct.ytd.toFixed(1)}% YTD</div>
                </div>
              </button>
              <button
                type="button"
                className="ra-bucket-edit"
                onClick={() => editPortfolio(p.id)}
                aria-label={`Edit ${p.name}`}
                title={`Edit ${p.name}`}
              >
                <Icon name="pencil" size={12} />
              </button>
            </div>
          ))
        )}
        <button
          className="btn ghost sm"
          style={{ width: "100%", marginTop: 10, display: "flex" }}
          onClick={() => window.dispatchEvent(new CustomEvent("new-portfolio"))}
        >
          <Icon name="plus" size={12} /> New portfolio
        </button>
      </div>
    </>
  );
}

const TONE_COLOR: Record<string, string> = {
  good: "var(--gain)",
  watch: "var(--amber)",
  action: "var(--loss)",
};

export function PlanPanel({ onClose }: { onClose: () => void }) {
  // Real, computed health over the combined book vs the selected target model.
  const { aggregate } = usePortfolioView();
  const { models } = useModelPortfoliosView();
  const selectedModelId = useSelectedModelId();
  const targetModel = models?.find((m) => m.id === selectedModelId) ?? null;

  const health = aggregate
    ? computeHealth(
        aggregate.holdings,
        aggregate.totalValue,
        targetModel?.mix ?? null,
        targetModel?.ter ?? null,
      )
    : null;

  if (!health) {
    return (
      <>
        <PanelHeader title="Plan & Health" onClose={onClose} />
        <div
          className="ra-panel-body"
          style={{ padding: 16, color: "var(--muted)", fontSize: 12.5 }}
        >
          Loading…
        </div>
      </>
    );
  }

  const headline = summarizeHealth(health, targetModel?.name ?? null);
  const metrics: { label: string; value: string }[] = [
    ...(targetModel
      ? [{ label: "Off target", value: `${health.trackingGapPp.toFixed(1)}pp` }]
      : []),
    { label: "Blended fee", value: `${health.blendedTer.toFixed(2)}%` },
    {
      label: "Top holding",
      value: health.concentration.top ? `${health.concentration.top.pct.toFixed(0)}%` : "—",
    },
    { label: "Cash", value: `${health.cashPct.toFixed(0)}%` },
  ];

  return (
    <>
      <PanelHeader title="Plan & Health" onClose={onClose} />
      <div className="ra-panel-body" style={{ padding: "12px 14px" }}>
        <div
          className="card-soft"
          style={{ padding: "10px 12px", marginBottom: 12, borderRadius: 12 }}
        >
          <div
            style={{
              fontSize: 9.5,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              color: TONE_COLOR[headline.tone],
              marginBottom: 4,
            }}
          >
            ● TOP THING TO KNOW
          </div>
          <div
            style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.35 }}
          >
            {headline.title}
          </div>
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginTop: 8, gap: 4 }}
            onClick={() =>
              window.dispatchEvent(new CustomEvent("ai-prompt", { detail: headline.prompt }))
            }
          >
            <Icon name="chat" size={12} /> Discuss
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${metrics.length}, 1fr)`,
            gap: 6,
          }}
        >
          {metrics.map((m) => (
            <div key={m.label} style={{ textAlign: "center" }}>
              <div className="num" style={{ fontSize: 15, fontWeight: 500 }}>
                {m.value}
              </div>
              <div
                style={{
                  fontSize: 8.5,
                  fontFamily: "var(--font-mono)",
                  color: "var(--muted)",
                  letterSpacing: "0.04em",
                  marginTop: 2,
                }}
              >
                {m.label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>

        {!targetModel && (
          <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5, marginTop: 12 }}>
            Pick a target model to unlock drift tracking and rebalance suggestions.
          </div>
        )}
      </div>
    </>
  );
}

export function NotesPanel({ onClose }: { onClose: () => void }) {
  const { journal } = useJournalView();
  const notes = journal?.notes ?? [];
  return (
    <>
      <PanelHeader title="Pinned notes" onClose={onClose} />
      <div className="ra-panel-body" style={{ padding: "8px 12px 12px" }}>
        {notes.slice(0, 6).map((n) => (
          <div className="article-card" key={n.id}>
            <div className="meta-row">
              <span>{n.date}</span>
              {n.tags[0] && (
                <>
                  <span>·</span>
                  <span>{n.tags[0]}</span>
                </>
              )}
            </div>
            <div className="a-title">{n.title}</div>
            {n.body && <div className="a-blurb">{n.body}</div>}
          </div>
        ))}
        {notes.length === 0 && (
          <div
            style={{
              padding: 20,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 12.5,
            }}
          >
            No pinned notes yet.
          </div>
        )}
      </div>
    </>
  );
}
