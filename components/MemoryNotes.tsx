"use client";

import { useState } from "react";
import { invalidate, useResource } from "@/lib/fetchers/swr";

// Mirrors `lib/db/queries/preferences.ts#Preference` for the slice of fields the
// UI needs. Importing the type directly would pull server code into the client
// bundle, so we restate it here.
interface PreferenceRow {
  id: number;
  category: "profile" | "finance_context" | "response_style" | "fact";
  content: string;
  // The longer recall-only detail (never injected). When present, it's the rest
  // of the memory beyond the short `content` line — shown under the memory here so
  // the whole thing is visible without leaving the page.
  body?: string | null;
  source: "user_tool" | "advisor_tool" | "extracted";
  validFrom: string;
  validUntil: string | null;
  updatedAt: string;
}

interface MemoryResponse {
  active: PreferenceRow[];
  recentlyForgotten: PreferenceRow[];
}

// Order from docs/explanation/memory.md § Architecture > Categories.
const CATEGORY_ORDER: PreferenceRow["category"][] = [
  "profile",
  "finance_context",
  "response_style",
  "fact",
];

const CATEGORY_LABEL: Record<PreferenceRow["category"], string> = {
  profile: "Profile",
  finance_context: "Finance context",
  response_style: "Response style",
  fact: "Facts",
};

const MEMORY_KEY = "/api/memory/preferences";

// Render UTC ISO timestamp in the user's IANA timezone as
// "YYYY-MM-DD HH:mm (Region/City)". Falls back to the raw string on parse error.
function fmtForgottenAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  })
    .format(d)
    .replace(",", "");
  return `${parts} (${tz})`;
}

// Memories have no direct edit field by design —
// a change flows through Advisor so it stays concise, consistent, and provenance-
// tracked (ADR 0006). "Edit" opens a NEW chat (so it doesn't land in whatever
// conversation was open): the visible bubble shows a short reference (the
// `content` line, never the long body), while the hidden `send` carries the memory
// id so the Advisor targets the right row via update_preference and asks what to
// change before touching anything.
function askAdvisorToEdit(row: PreferenceRow) {
  // A clean, natural message (no internal id, no bracketed directive) — it's
  // both shown to the user AND persisted/titled, so it must read like real
  // speech. The Advisor identifies the memory by its content (update_preference
  // matches by substring) and follows the system-prompt rules: never reveal the
  // id, summarize rather than quote, ask before changing anything.
  const prompt = `I'd like to update my saved memory: "${row.content}". Help me change it.`;
  window.dispatchEvent(
    new CustomEvent("ai-prompt", { detail: { display: prompt, send: prompt, newChat: true } }),
  );
}

// Browsable, reversible view of everything the Advisor has learned — the
// durable counterpart to the in-chat status line. Forget is reversible (moves
// to "Recently forgotten" for 30 days); edits route through Advisor.
export function MemoryNotes() {
  const { data, isLoading, error } = useResource<MemoryResponse>(MEMORY_KEY);
  const active = data?.active ?? [];
  const recentlyForgotten = data?.recentlyForgotten ?? [];

  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    rows: active.filter((p) => p.category === cat),
  })).filter((g) => g.rows.length > 0);

  const handleForget = async (row: PreferenceRow) => {
    // No confirm: forget is reversible. The row moves to "Recently forgotten"
    // (30-day window) with a restore button — that's the undo.
    const res = await fetch(`${MEMORY_KEY}/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      window.alert(`Failed to forget memory (${res.status})`);
      return;
    }
    await invalidate(MEMORY_KEY);
  };

  const handleRestore = async (row: PreferenceRow) => {
    const res = await fetch(`${MEMORY_KEY}/${row.id}`, { method: "POST" });
    if (!res.ok) {
      window.alert(`Failed to restore memory (${res.status})`);
      return;
    }
    await invalidate(MEMORY_KEY);
  };

  return (
    <div className="section" style={{ marginTop: 0 }}>
      <p
        style={{
          fontSize: 12.5,
          color: "var(--muted)",
          margin: "0 4px 14px",
          lineHeight: 1.5,
        }}
      >
        What Advisor has learned about you, loaded into context at the start of each new chat. To
        change a memory, ask Advisor in chat — edits apply to your next chat, not the current one.
      </p>

      {isLoading && (
        <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>
          Loading saved memories…
        </div>
      )}

      {error && !isLoading && (
        <div className="card" style={{ fontSize: 12.5, color: "var(--loss, #c33)" }}>
          Couldn't load your saved memories. Try refreshing.
        </div>
      )}

      {!isLoading && !error && grouped.length === 0 && (
        <div className="card" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.55 }}>
          No saved memories yet. Try saying{" "}
          <em style={{ color: "var(--ink-soft)" }}>"remember I prefer concise responses"</em> in
          chat.
        </div>
      )}

      {!isLoading && !error && grouped.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grouped.map((g) => (
            <div key={g.category}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  padding: "0 4px 6px",
                }}
              >
                {CATEGORY_LABEL[g.category]}
              </div>
              <div className="card" style={{ padding: 0 }}>
                {g.rows.map((row, idx) => (
                  <div
                    key={row.id}
                    style={{
                      padding: "11px 14px",
                      borderTop: idx === 0 ? "none" : "1px solid var(--line-soft)",
                    }}
                  >
                    {/* Header row: the memory line + actions, vertically centered.
                        The body (if any) renders BELOW this row at full width, so
                        Edit/✕ stay put when "Show more" expands the body. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13,
                          lineHeight: 1.45,
                          color: "var(--ink)",
                          wordBreak: "break-word",
                        }}
                      >
                        {row.content}
                      </div>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => askAdvisorToEdit(row)}
                        style={{ flexShrink: 0 }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleForget(row)}
                        aria-label="Forget this memory"
                        title="Forget"
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "var(--muted)",
                          cursor: "pointer",
                          padding: "2px 6px",
                          fontSize: 14,
                          lineHeight: 1,
                          flexShrink: 0,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    {row.body && <MemoryBody body={row.body} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && recentlyForgotten.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.08em",
              color: "var(--muted)",
              textTransform: "uppercase",
              padding: "0 4px 6px",
            }}
          >
            Recently forgotten · 30 days
          </div>
          <div className="card" style={{ padding: 0 }}>
            {recentlyForgotten.map((row, idx) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 14px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--line-soft)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.45,
                      color: "var(--muted)",
                      wordBreak: "break-word",
                    }}
                  >
                    {row.content}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      color: "var(--muted)",
                    }}
                  >
                    forgotten {row.validUntil ? fmtForgottenAt(row.validUntil) : "—"}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => handleRestore(row)}
                  style={{ flexShrink: 0 }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// The longer recall-only detail, clamped to a few lines with a Show more/less
// toggle so a long memory doesn't dominate the list. Bodies are capped at ~2k
// chars upstream (recall-only), so this stays in-list rather than a modal.
function MemoryBody({ body }: { body: string }) {
  const [open, setOpen] = useState(false);
  const isLong = body.length > 180;
  return (
    <div style={{ marginTop: 4 }}>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.45,
          color: "var(--ink-soft)",
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
          ...(isLong && !open
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical" as const,
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {body}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            background: "transparent",
            border: 0,
            padding: "2px 0",
            color: "var(--accent)",
            fontSize: 11.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
