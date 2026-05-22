"use client";

export type Theme = "light" | "dark" | "system";

export interface SettingsScreenProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onBack: () => void;
}

export function SettingsScreen({ theme, onThemeChange, onBack }: SettingsScreenProps) {
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
                F
              </div>
              <div>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Demo Broker
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  Last sync · 14:32 · 8 funds
                </div>
              </div>
            </div>
            <span className="tag green">connected</span>
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
