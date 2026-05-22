"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { type MarketIndexResponse, useMarketIndices } from "@/lib/fetchers/portfolio";
import type { LearnArticle, MarketIndex, Markets } from "@/lib/mock/types";
import { LEARN_CONTENT } from "@/lib/static/learn";
import { MARKETS } from "@/lib/static/markets";

export interface MarketsScreenProps {
  onOpenSettings: () => void;
}

export function MarketsScreen({ onOpenSettings }: MarketsScreenProps) {
  const [tab, setTab] = useState<"today" | "learn">("today");
  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand" style={{ flex: 1 }}>
          <span>Markets</span>
          <span className="brand-chip">19 MAY · ICT</span>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <Icon name="settings" size={13} />
        </button>
      </div>

      <div className="sub-tabs">
        <button data-active={tab === "today"} onClick={() => setTab("today")}>
          Today
        </button>
        <button data-active={tab === "learn"} onClick={() => setTab("learn")}>
          Learn
        </button>
      </div>

      {tab === "today" && <MarketsToday />}
      {tab === "learn" && <MarketsLearn />}
    </div>
  );
}

function adaptIndices(rows: MarketIndexResponse[]): { indices: MarketIndex[]; failures: number } {
  let failures = 0;
  const indices: MarketIndex[] = [];
  for (const r of rows) {
    if (!r.ok || r.price == null) {
      failures++;
      continue;
    }
    indices.push({
      sym: r.label,
      name: r.name,
      val: r.price,
      d: r.d1Pct ?? 0,
      isYield: r.symbol === "THB=X",
    });
  }
  return { indices, failures };
}

function MarketsToday() {
  const { data: liveRows, isLoading } = useMarketIndices();
  const live = useMemo(() => (liveRows ? adaptIndices(liveRows) : null), [liveRows]);

  // Live data wins when we have it; otherwise fall back to mock so the screen
  // still tells a coherent story while NAV is being refreshed or rate-limited.
  const markets: Markets = useMemo(
    () => (live && live.indices.length > 0 ? { ...MARKETS, indices: live.indices } : MARKETS),
    [live],
  );

  const banner =
    !isLoading && live && live.failures > 0
      ? `${live.failures} index source${live.failures > 1 ? "s" : ""} temporarily unavailable.`
      : null;

  return <MarketsTodayInner markets={markets} banner={banner} />;
}

function MarketsTodayInner({ markets, banner }: { markets: Markets; banner: string | null }) {
  return (
    <div>
      {banner && (
        <div
          className="section"
          style={{ marginTop: 0, paddingTop: 0, paddingBottom: 0, marginBottom: 8 }}
        >
          <div
            style={{
              padding: "8px 12px",
              background: "var(--card-soft)",
              border: "1px solid var(--line-soft)",
              borderRadius: 8,
              fontSize: 11.5,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.02em",
            }}
          >
            ⓘ {banner}
          </div>
        </div>
      )}
      <div className="section" style={{ marginTop: 0 }}>
        <div
          className="card"
          style={{
            background: "var(--ink)",
            color: "var(--bg)",
            borderColor: "transparent",
          }}
        >
          <div className="row" style={{ marginBottom: 8, color: "var(--accent)" }}>
            <Icon name="sparkle" size={13} />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.05em",
              }}
            >
              TODAY, IN YOUR WORDS
            </span>
          </div>
          <div
            style={{
              fontSize: 15,
              lineHeight: 1.45,
              color: "var(--bg)",
              letterSpacing: "-0.005em",
            }}
          >
            &quot;{markets.digest}&quot;
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>Indices</h3>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            {markets.indices.map((idx, i) => (
              <div
                key={idx.sym}
                style={{
                  padding: 12,
                  borderRight: i % 2 === 0 ? "1px solid var(--line-soft)" : "none",
                  borderBottom:
                    i < markets.indices.length - 2 ? "1px solid var(--line-soft)" : "none",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.04em",
                  }}
                >
                  {idx.sym}
                </div>
                <div className="num" style={{ fontSize: 16, marginTop: 3, fontWeight: 500 }}>
                  {idx.val.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  {idx.isYield ? "%" : ""}
                </div>
                <div
                  className={`delta ${idx.d >= 0 ? "up" : "down"}`}
                  style={{ fontSize: 11, marginTop: 1 }}
                >
                  {idx.d >= 0 ? "▲" : "▼"} {Math.abs(idx.d).toFixed(2)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>What matters for you</h3>
          <span className="link">Show all</span>
        </div>
        <div className="card" style={{ padding: "4px 14px" }}>
          {markets.news.map((n, i) => (
            <div key={i} className="news-card">
              <div className="head">
                <span>
                  {n.tag} · {n.time}
                </span>
                <span
                  className={n.relevance === "high" ? "tag green" : "tag"}
                  style={{ fontSize: 9 }}
                >
                  {n.relevance}
                </span>
              </div>
              <div className="title">{n.title}</div>
              <div className="summary">{n.summary}</div>
              <div className="impact">
                <Icon name="sparkle" size={13} />
                <div>
                  <strong>For you:</strong> {n.impact}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MarketsLearn() {
  const L = LEARN_CONTENT;
  const saveArticle = (a: LearnArticle) =>
    window.dispatchEvent(new CustomEvent("save-reading", { detail: a }));

  return (
    <div>
      <div className="section" style={{ marginTop: 0 }}>
        <div className="section-header">
          <h3>Start here</h3>
          <span className="link">Foundations</span>
        </div>
        {L.startHere.map((a) => (
          <div key={a.id} className="article-card" onClick={() => saveArticle(a)}>
            <div className="meta-row">
              <span>{a.tag}</span>
              <span>· {a.readTime} MIN READ</span>
              <span style={{ marginLeft: "auto", color: "var(--accent-ink)" }}>📑 SAVE</span>
            </div>
            <div className="a-title">{a.title}</div>
            <div className="a-blurb">{a.blurb}</div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-header">
          <h3>Recommended for you</h3>
          <span className="link" style={{ color: "var(--accent-ink)" }}>
            ● Based on your portfolio
          </span>
        </div>
        {L.recommendedForYou.map((a) => (
          <div
            key={a.id}
            className="article-card"
            style={{ background: "var(--accent-soft)", borderColor: "transparent" }}
            onClick={() => saveArticle(a)}
          >
            <div className="meta-row" style={{ color: "var(--accent-ink)", opacity: 0.7 }}>
              <span>{a.tag}</span>
              <span>· {a.readTime} MIN READ</span>
              <span style={{ marginLeft: "auto" }}>📑 SAVE</span>
            </div>
            <div className="a-title" style={{ color: "var(--accent-ink)" }}>
              {a.title}
            </div>
            <div className="a-blurb" style={{ color: "var(--accent-ink)", opacity: 0.85 }}>
              {a.blurb}
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-header">
          <h3>By topic</h3>
        </div>
        <div className="filter-chips" style={{ padding: "0 4px" }}>
          {L.topics.map((t) => (
            <span key={t.id} className="chip">
              {t.label} <span style={{ color: "var(--muted)", marginLeft: 4 }}>{t.count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="card" style={{ padding: 14, textAlign: "center" }}>
          <Icon name="sparkle" size={20} />
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              marginTop: 6,
              marginBottom: 4,
              letterSpacing: "-0.01em",
            }}
          >
            Found something elsewhere?
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--muted)",
              lineHeight: 1.45,
              marginBottom: 12,
            }}
          >
            Paste a link in chat and ask the advisor to read it. It&apos;ll save the summary to your
            Journal.
          </div>
          <button
            className="btn ghost sm"
            onClick={() => window.dispatchEvent(new CustomEvent("nav", { detail: "chat" }))}
          >
            <Icon name="chat" size={12} /> Send a link to the advisor
          </button>
        </div>
      </div>
    </div>
  );
}
