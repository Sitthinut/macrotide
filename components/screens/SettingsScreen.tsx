"use client";

import { invalidate, useResource } from "@/lib/fetchers/swr";

export type Theme = "light" | "dark" | "system";

export interface SettingsScreenProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onBack: () => void;
}

// Mirrors `lib/db/queries/preferences.ts#Preference` for the slice of fields
// the UI needs. Importing the type directly would pull server code into the
// client bundle, so we restate it here.
interface PreferenceRow {
  id: number;
  category: "profile" | "finance_context" | "response_style" | "fact";
  content: string;
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

export function SettingsScreen({ theme, onThemeChange, onBack }: SettingsScreenProps) {
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
      window.alert(`Failed to forget note (${res.status})`);
      return;
    }
    await invalidate(MEMORY_KEY);
  };

  const handleRestore = async (row: PreferenceRow) => {
    const res = await fetch(`${MEMORY_KEY}/${row.id}`, { method: "POST" });
    if (!res.ok) {
      window.alert(`Failed to restore note (${res.status})`);
      return;
    }
    await invalidate(MEMORY_KEY);
  };

  const themeOpts = [
    {
      key: "light" as const,
      label: "Light",
      icon: (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ),
    },
    {
      key: "dark" as const,
      label: "Dark",
      icon: (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      ),
    },
    {
      key: "system" as const,
      label: "System",
      icon: (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="screen">
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back" style={{ marginRight: 8 }}>
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
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>Settings</span>
        </div>
      </div>

      <div className="section" style={{ marginTop: 6 }}>
        <div className="section-header">
          <h3>Appearance</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {themeOpts.map((opt) => (
            <button
              key={opt.key}
              onClick={() => onThemeChange(opt.key)}
              className="card"
              style={{
                padding: "16px 8px",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                background: theme === opt.key ? "var(--accent-soft)" : "var(--paper)",
                borderColor: theme === opt.key ? "var(--accent)" : "var(--line-soft)",
                borderWidth: theme === opt.key ? 1.5 : 1,
                color: theme === opt.key ? "var(--accent-ink)" : "var(--ink)",
                fontFamily: "var(--font-sans)",
                transition: "all 0.18s",
              }}
            >
              {opt.icon}
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>Connections</h3>
        </div>
        <div className="card">
          <div className="row between">
            <div className="row">
              <div className="broker-logo" style={{ width: 36, height: 36 }}>
                +
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  No brokerage connected
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Add holdings manually · sync coming soon
                </div>
              </div>
            </div>
            <span className="tag">soon</span>
          </div>
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "10px 4px 0",
            lineHeight: 1.5,
          }}
        >
          Manage your investment plan in{" "}
          <strong style={{ fontWeight: 500, color: "var(--ink-soft)" }}>Journal → Plan</strong>.
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>Memory</h3>
        </div>

        {isLoading && (
          <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Loading saved notes…
          </div>
        )}

        {error && !isLoading && (
          <div className="card" style={{ fontSize: 12.5, color: "var(--loss, #c33)" }}>
            Couldn't load your saved notes. Try refreshing.
          </div>
        )}

        {!isLoading && !error && grouped.length === 0 && (
          <div
            className="card"
            style={{
              fontSize: 12.5,
              color: "var(--muted)",
              lineHeight: 1.55,
            }}
          >
            No saved notes yet. Try saying{" "}
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
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "11px 14px",
                        borderTop: idx === 0 ? "none" : "1px solid var(--line-soft)",
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
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
                        onClick={() => handleForget(row)}
                        aria-label="Forget this note"
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
                    alignItems: "flex-start",
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

        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "10px 4px 0",
            lineHeight: 1.5,
          }}
        >
          Notes load into Advisor's context at the start of each new chat. Edits here apply to your
          next chat — not the current one.
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <h3>About</h3>
        </div>
        <div className="card">
          <ul className="bullet-list">
            <li>
              <span className="marker">v0.1</span>Open-source AI investment companion · MIT licensed
            </li>
            <li>
              <span className="marker">↗</span>github.com/Sitthinut/macrotide
            </li>
            <li>
              <span className="marker">⚠</span>Educational tool — not licensed financial advice
            </li>
            <li>
              <span className="marker">∞</span>Built with Claude · runs your data locally
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
