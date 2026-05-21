"use client";

import { useMemo, useState } from "react";
import { ModelDonut } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { useJournalView, useModelPortfoliosView, useSelectedModelId } from "@/lib/fetchers/legacy";
import { usePlan } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { fmtRelativeDate } from "@/lib/format";
import { parseBullets, parseCommitments, parsePlan, parseQuestions } from "@/lib/mock/data";
import type { FeedbackItem, ModelPortfolio, Note, ReadingItem } from "@/lib/mock/types";

type Tab = "plan" | "notes" | "models" | "reading" | "feedback";

export interface JournalScreenProps {
  onOpenChat: () => void;
  onOpenModels: () => void;
  onOpenSettings: () => void;
}

export function JournalScreen({ onOpenChat, onOpenModels, onOpenSettings }: JournalScreenProps) {
  const [tab, setTab] = useState<Tab>("plan");
  const { journal } = useJournalView();

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand" style={{ flex: 1 }}>
          <span>Journal</span>
          <span className="brand-chip">PICHANON N.</span>
        </div>
        <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"></path>
          </svg>
        </button>
      </div>

      <div className="sub-tabs">
        {(
          [
            { id: "plan", label: "Plan" },
            { id: "notes", label: "Notes" },
            { id: "models", label: "Models" },
            { id: "reading", label: "Reading" },
            { id: "feedback", label: "Feedback" },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button key={t.id} data-active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "plan" && <JournalPlan onOpenModels={onOpenModels} onOpenChat={onOpenChat} />}
      {tab === "notes" && <JournalNotes notes={journal?.notes ?? []} />}
      {tab === "models" && (
        <JournalModels saved={journal?.savedModels ?? []} onOpenModels={onOpenModels} />
      )}
      {tab === "reading" && <JournalReading reading={journal?.reading ?? []} />}
      {tab === "feedback" && <JournalFeedback feedback={journal?.feedback ?? []} />}
    </div>
  );
}

function JournalPlan({
  onOpenModels,
  onOpenChat,
}: {
  onOpenModels: () => void;
  onOpenChat: () => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const { data: plan, isLoading: planLoading } = usePlan();
  const { models } = useModelPortfoliosView();
  const planSelectedModelId = useSelectedModelId();

  const markdown = plan?.markdown ?? "";
  const parsed = useMemo(() => parsePlan(markdown), [markdown]);
  const targetModel = models?.find((m) => m.id === planSelectedModelId);

  const savePlan = async (md: string) => {
    try {
      await fetch("/api/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown: md, selectedModelId: plan?.selectedModelId ?? null }),
      });
      invalidate("/api/plan");
    } catch (err) {
      console.error("Failed to save plan:", err);
    }
    setEditorOpen(false);
  };

  if (planLoading) {
    return (
      <div className="section" style={{ marginTop: 0 }}>
        <div style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  const isEmpty = !markdown.trim();

  if (isEmpty) {
    return (
      <div>
        <div className="section" style={{ marginTop: 0 }}>
          <div className="card" style={{ padding: "32px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                marginBottom: 6,
              }}
            >
              Your plan is empty
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.5,
                marginBottom: 20,
                maxWidth: 280,
                margin: "0 auto 20px",
              }}
            >
              A short brief about what you care about, your target allocation, and rules you set for
              yourself. The advisor reads it before every conversation.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn primary" onClick={() => setEditorOpen(true)}>
                <Icon name="plus" size={13} /> Write your plan
              </button>
              <button className="btn ghost" onClick={onOpenChat}>
                <Icon name="chat" size={13} /> Build with advisor
              </button>
            </div>
          </div>
        </div>

        {editorOpen && (
          <PlanEditorSheet
            initial={markdown}
            onClose={() => setEditorOpen(false)}
            onSave={savePlan}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="section" style={{ marginTop: 0 }}>
        <div className="row between" style={{ padding: "0 4px", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.02em" }}>Your plan</div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {plan?.updatedAt ? `Updated ${fmtRelativeDate(plan.updatedAt)}` : "Not saved yet"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn ghost sm" onClick={() => setEditorOpen(true)}>
              <Icon name="settings" size={12} /> Edit
            </button>
            <button className="btn ghost sm" onClick={onOpenChat}>
              <Icon name="chat" size={12} /> Ask AI
            </button>
          </div>
        </div>

        <PlanSpineCard
          label="TARGET"
          body={parsed.spine.target}
          model={targetModel}
          onAdd={() => setEditorOpen(true)}
          onBrowse={onOpenModels}
        />
        <PlanSpineCard
          label="PRINCIPLES"
          body={parsed.spine.principles}
          kind="bullets"
          onAdd={() => setEditorOpen(true)}
        />
        <PlanSpineCard
          label="RISK"
          body={parsed.spine.risk}
          kind="quote"
          onAdd={() => setEditorOpen(true)}
        />
        <PlanSpineCard
          label="COMMITMENTS"
          body={parsed.spine.commitments}
          kind="checklist"
          onAdd={() => setEditorOpen(true)}
        />

        {parsed.extras.map((ext, i) => (
          <PlanExtraCard key={i} title={ext.title} body={ext.body} />
        ))}
      </div>

      {editorOpen && (
        <PlanEditorSheet
          initial={markdown}
          onClose={() => setEditorOpen(false)}
          onSave={savePlan}
        />
      )}
    </div>
  );
}

function PlanSpineCard({
  label,
  body,
  kind = "prose",
  model,
  onAdd,
  onBrowse,
}: {
  label: string;
  body: string | null;
  kind?: "prose" | "bullets" | "quote" | "checklist";
  model?: ModelPortfolio;
  onAdd: () => void;
  onBrowse?: () => void;
}) {
  if (!body?.trim()) {
    return (
      <div
        onClick={onAdd}
        style={{
          background: "transparent",
          border: "1.5px dashed var(--line)",
          borderRadius: 14,
          padding: 14,
          marginBottom: 8,
          cursor: "pointer",
          color: "var(--muted)",
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            marginBottom: 6,
          }}
        >
          ○ {label}
        </div>
        <div
          style={{
            fontSize: 13,
            color: "var(--muted)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add a {label.toLowerCase()} section
        </div>
      </div>
    );
  }

  if (kind === "checklist") {
    const items = parseCommitments(body);
    return (
      <SpineCardShell label={label}>
        <div className="stack-sm">
          {items.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  marginTop: 1,
                  flexShrink: 0,
                  border: "1.5px solid var(--amber)",
                  background: "color-mix(in oklab, var(--amber) 20%, transparent)",
                }}
              ></span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: "var(--ink)",
                }}
              >
                {c.text}
              </div>
            </div>
          ))}
        </div>
      </SpineCardShell>
    );
  }

  if (kind === "bullets") {
    const items = parseBullets(body);
    if (items.length > 0) {
      return (
        <SpineCardShell label={label}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {items.map((b, i) => (
              <li
                key={i}
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: "5px 0",
                  display: "grid",
                  gridTemplateColumns: "12px 1fr",
                  gap: 8,
                }}
              >
                <span style={{ color: "var(--accent)", paddingTop: 1 }}>·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </SpineCardShell>
      );
    }
  }

  if (kind === "quote") {
    return (
      <SpineCardShell label={label}>
        <div
          style={{
            fontSize: 14,
            lineHeight: 1.5,
            fontStyle: "italic",
            color: "var(--ink)",
            paddingLeft: 12,
            borderLeft: "3px solid var(--accent)",
            letterSpacing: "-0.005em",
          }}
        >
          {body}
        </div>
      </SpineCardShell>
    );
  }

  if (label === "TARGET" && model) {
    return (
      <SpineCardShell label={label}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <ModelDonut mix={model.mix} size={48} thickness={7} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                marginBottom: 2,
              }}
            >
              {model.name}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.35 }}>
              {model.mix.map((m) => `${m.pct}% ${m.label}`).join(" · ")}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>{body}</div>
        {onBrowse && (
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={onBrowse}>
            Browse other models →
          </button>
        )}
      </SpineCardShell>
    );
  }

  return (
    <SpineCardShell label={label}>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink)",
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </div>
    </SpineCardShell>
  );
}

function SpineCardShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 8, padding: 14 }}>
      <div
        style={{
          fontSize: 9.5,
          fontFamily: "var(--font-mono)",
          color: "var(--accent-ink)",
          letterSpacing: "0.04em",
          marginBottom: 8,
        }}
      >
        ● {label}
      </div>
      {children}
    </div>
  );
}

function PlanExtraCard({ title, body }: { title: string; body: string }) {
  const isQuestions = title.toLowerCase().includes("question");
  if (isQuestions) {
    const qs = parseQuestions(body);
    return (
      <div className="card" style={{ marginBottom: 8, padding: 14 }}>
        <div
          style={{
            fontSize: 9.5,
            fontFamily: "var(--font-mono)",
            color: "var(--muted)",
            letterSpacing: "0.04em",
            marginBottom: 8,
          }}
        >
          ○ {title.toUpperCase()}
        </div>
        <div className="stack-sm">
          {qs.map((q, i) => (
            <div
              key={i}
              onClick={() => window.dispatchEvent(new CustomEvent("ai-prompt", { detail: q }))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--card-soft)",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--accent)", fontWeight: 500 }}>?</span>
              <span style={{ flex: 1 }}>{q}</span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--accent-ink)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                ASK AI →
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 8, padding: 14 }}>
      <div
        style={{
          fontSize: 9.5,
          fontFamily: "var(--font-mono)",
          color: "var(--muted)",
          letterSpacing: "0.04em",
          marginBottom: 8,
        }}
      >
        ○ {title.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--ink-soft)",
          whiteSpace: "pre-wrap",
        }}
      >
        {body}
      </div>
    </div>
  );
}

function PlanEditorSheet({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (md: string) => void;
}) {
  const [text, setText] = useState(initial || "");
  const placeholder = `## Target
Bogleheads 3-Fund: 50% US, 30% International, 20% Bonds.

## Principles
- Low fees
- Global diversification
- Boring works

## Risk
Comfortable with 20% drawdowns. Won't sell.

## Commitments
- Rebalance when drift > 7pp
- No active funds`;

  const insertSection = (heading: string) => {
    setText(`${text}\n\n## ${heading}\n`);
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "92vh" }}>
        <div className="sheet-handle"></div>
        <div className="row between" style={{ marginBottom: 4 }}>
          <div className="sheet-title">Edit your plan</div>
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            MARKDOWN
          </span>
        </div>
        <div className="sheet-subtitle">
          Free-form. Use <code>## Heading</code> for sections. The advisor reads this before every
          conversation.
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="sheet-input"
          style={{
            minHeight: 280,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            lineHeight: 1.5,
          }}
        />

        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          SUGGESTED HEADINGS
        </div>
        <div className="filter-chips" style={{ padding: "6px 0 0" }}>
          {["Target", "Principles", "Risk", "Commitments", "Open questions", "Contributions"].map(
            (h) => (
              <span key={h} className="chip" onClick={() => insertSection(h)}>
                + {h}
              </span>
            ),
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" style={{ flex: 2 }} onClick={() => onSave(text)}>
            Save plan <Icon name="check" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyTab({ title, body }: { title: string; body: string }) {
  return (
    <div className="section" style={{ marginTop: 0 }}>
      <div
        className="card"
        style={{
          padding: "28px 20px",
          textAlign: "center",
          color: "var(--muted)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, color: "var(--ink)" }}>
          {title}
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 300, margin: "0 auto" }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function JournalNotes({ notes }: { notes: Note[] }) {
  if (notes.length === 0) {
    return (
      <EmptyTab
        title="No notes yet"
        body="Insights you save from chat or analysis appear here. The advisor reads them for context in future conversations."
      />
    );
  }
  return (
    <div>
      <div className="section" style={{ marginTop: 0 }}>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            margin: "0 4px 14px",
            lineHeight: 1.5,
          }}
        >
          Insights you&apos;ve saved from chat and analysis. The advisor uses these as context when
          answering future questions.
        </p>
        {notes.map((n) => (
          <div key={n.id} className="card" style={{ marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: 9.5,
                  fontFamily: "var(--font-mono)",
                  color: "var(--muted)",
                  letterSpacing: "0.04em",
                }}
              >
                {n.source.toUpperCase()} · {n.date.toUpperCase()}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {n.tags.map((t) => (
                  <span key={t} className="tag" style={{ fontSize: 9 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                marginBottom: 6,
              }}
            >
              {n.title}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
              }}
            >
              {n.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JournalModels({ saved, onOpenModels }: { saved: string[]; onOpenModels: () => void }) {
  const { models } = useModelPortfoliosView();
  const target = useSelectedModelId();
  const all = models ?? [];
  const list = saved
    .map((id) => all.find((m) => m.id === id))
    .filter((m): m is ModelPortfolio => Boolean(m));

  if (list.length === 0) {
    return (
      <div>
        <EmptyTab
          title="No saved models"
          body="Pin index strategies from Models to track them here. The advisor can suggest models when you ask 'what should I hold?'"
        />
        <div className="section" style={{ textAlign: "center" }}>
          <button className="btn ghost sm" onClick={onOpenModels}>
            Browse model portfolios →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section">
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            margin: "0 4px 14px",
            lineHeight: 1.5,
          }}
        >
          Index strategies you&apos;ve explored.
        </p>
        {list.map((m) => (
          <div
            key={m.id}
            className="card"
            style={{ marginBottom: 8, cursor: "pointer", padding: 14 }}
            onClick={onOpenModels}
          >
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <ModelDonut mix={m.mix} size={48} thickness={7} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 2,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {m.name}
                  </div>
                  {target === m.id && (
                    <span className="tag green" style={{ fontSize: 9 }}>
                      ● TARGET
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.35,
                  }}
                >
                  {m.tagline}
                </div>
              </div>
              <Icon name="arrowRight" size={13} />
            </div>
          </div>
        ))}
        <button className="btn ghost full" onClick={onOpenModels} style={{ marginTop: 8 }}>
          Browse all {all.length} model portfolios →
        </button>
      </div>
    </div>
  );
}

function JournalReading({ reading }: { reading: ReadingItem[] }) {
  if (reading.length === 0) {
    return (
      <EmptyTab
        title="No saved reading"
        body="Save articles from Markets › Learn, or ask the advisor to summarize a link — they land here for later."
      />
    );
  }
  return (
    <div>
      <div className="section" style={{ marginTop: 0 }}>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            margin: "0 4px 14px",
            lineHeight: 1.5,
          }}
        >
          Articles saved from Markets &gt; Learn, or links you&apos;ve asked the advisor to read.
        </p>
        {reading.map((r) => (
          <div key={r.id} className="article-card">
            <div className="meta-row">
              <span>{r.source.toUpperCase()}</span>
              <span>· {r.readTime} MIN READ</span>
              <span style={{ marginLeft: "auto" }} className={`status-pip ${r.status}`}>
                {r.status === "read" ? "✓ READ" : r.status === "in_progress" ? "READING" : "UNREAD"}
              </span>
            </div>
            <div className="a-title">{r.title}</div>
            <div className="a-blurb">{r.summary}</div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted)" }}>
              Saved {r.savedDate}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function JournalFeedback({ feedback }: { feedback: FeedbackItem[] }) {
  if (feedback.length === 0) {
    return (
      <EmptyTab
        title="No feedback yet"
        body="Once you start chatting with the advisor, your 👍 / 👎 reactions land here so the advisor can avoid repeating advice you didn't like."
      />
    );
  }
  const ups = feedback.filter((f) => f.rating === "up").length;
  const downs = feedback.filter((f) => f.rating === "down").length;
  return (
    <div>
      <div className="section" style={{ marginTop: 0 }}>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--muted)",
            margin: "0 4px 14px",
            lineHeight: 1.5,
          }}
        >
          What you&apos;ve agreed and disagreed with. The advisor avoids repeating advice
          you&apos;ve already rejected.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <div className="card-soft" style={{ padding: 14, textAlign: "center" }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 500, color: "var(--gain)" }}>
              {ups}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
              }}
            >
              AGREED
            </div>
          </div>
          <div className="card-soft" style={{ padding: 14, textAlign: "center" }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 500, color: "var(--loss)" }}>
              {downs}
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
              }}
            >
              DISAGREED
            </div>
          </div>
        </div>

        {feedback.map((f) => (
          <div key={f.id} className="card" style={{ marginBottom: 6, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background:
                    f.rating === "up"
                      ? "var(--accent-soft)"
                      : "color-mix(in oklab, var(--loss) 14%, transparent)",
                  color: f.rating === "up" ? "var(--accent-ink)" : "var(--loss)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {f.rating === "up" ? "👍" : "👎"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {f.topic}
                </div>
                {f.note && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    &quot;{f.note}&quot;
                  </div>
                )}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  flexShrink: 0,
                }}
              >
                {f.date.split(" ")[0]} {f.date.split(" ")[1]}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
