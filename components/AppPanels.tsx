"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { ChatScreen } from "@/components/screens/ChatScreen";
import { useJournalView, usePortfolioView } from "@/lib/fetchers/legacy";
import { ANALYSIS } from "@/lib/static/analysis";

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
  seedPrompt: string | null;
  onPromptConsumed: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <PanelHeader title="Chat" showDot onClose={onClose} />
      <div className="ra-panel-body ra-chat-body">
        <ChatScreen persona="advisor" seedPrompt={seedPrompt} onPromptConsumed={onPromptConsumed} />
      </div>
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

const SEV_TAG: Record<string, string> = {
  good: "Strength",
  low: "Note",
  medium: "Watch",
  high: "Action",
};

export function PlanPanel({ onClose }: { onClose: () => void }) {
  const score = Math.round(
    (ANALYSIS.scores.diversification + ANALYSIS.scores.alignment + ANALYSIS.scores.fees) / 3,
  );
  const dashLen = (150.8 * score) / 100;
  return (
    <>
      <PanelHeader title="Plan & Health" onClose={onClose} />
      <div className="ra-panel-body" style={{ padding: "12px 14px" }}>
        <div className="score-card" style={{ marginBottom: 12 }}>
          <div className="score-circle">
            <svg width="56" height="56" viewBox="0 0 56 56">
              <circle
                cx="28"
                cy="28"
                r="24"
                fill="none"
                stroke="var(--line-soft)"
                strokeWidth="4"
              />
              <circle
                cx="28"
                cy="28"
                r="24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="4"
                strokeDasharray={`${dashLen} 999`}
                strokeLinecap="round"
              />
            </svg>
            <div className="val">{score}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              On track
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {ANALYSIS.insights.length} items
            </div>
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: "var(--muted)",
            letterSpacing: "0.06em",
            margin: "4px 0 6px",
          }}
        >
          SUGGESTED ACTIONS
        </div>
        <ul className="bullet-list">
          {ANALYSIS.insights.slice(0, 4).map((it, i) => (
            <li key={i}>
              <span className="marker">{String(i + 1).padStart(2, "0")}</span>
              <span>
                <strong>{SEV_TAG[it.severity] || "Note"}:</strong> {it.title}
              </span>
            </li>
          ))}
        </ul>
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
