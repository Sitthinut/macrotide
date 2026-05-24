"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";

interface Broker {
  id: string;
  abbr: string;
  name: string;
  desc: string;
  primary: boolean;
}

// Brokerage entries are intentionally generic until real integrations are wired
// up. Replace these with real names + branding when actually integrating.
const BROKERS: Broker[] = [
  {
    id: "demo",
    abbr: "D",
    name: "Demo Broker",
    desc: "Multi-AMC mutual funds · API supported",
    primary: true,
  },
  {
    id: "broker-bank",
    abbr: "B1",
    name: "Bank Brokerage",
    desc: "Bank-affiliated platform · OAuth via partner",
    primary: false,
  },
  {
    id: "broker-direct",
    abbr: "B2",
    name: "Asset Manager Direct",
    desc: "Direct AMC platform",
    primary: false,
  },
  {
    id: "broker-wealth",
    abbr: "B3",
    name: "Wealth Platform",
    desc: "Multi-asset wealth platform",
    primary: false,
  },
];

export interface ConnectScreenProps {
  onConnect: () => void;
}

export function ConnectScreen({ onConnect }: ConnectScreenProps) {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState("demo");
  const [progress, setProgress] = useState(0);

  const startConnect = () => {
    setStep(2);
    setProgress(0);
    let p = 0;
    const tick = setInterval(() => {
      p += Math.random() * 18 + 6;
      setProgress(Math.min(100, p));
      if (p >= 100) {
        clearInterval(tick);
        setTimeout(() => setStep(3), 600);
      }
    }, 220);
  };

  if (step === 0) {
    return (
      <div className="screen onboard-shell">
        <div>
          <div
            style={{
              display: "flex",
              gap: 9,
              alignItems: "center",
              marginBottom: 36,
            }}
          >
            <span className="brand-mark" style={{ width: 26, height: 26, borderRadius: 8 }}></span>
            <span
              style={{
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Macrotide
            </span>
          </div>
          <h1
            style={{
              fontSize: 34,
              lineHeight: 1.1,
              marginBottom: 16,
              fontWeight: 500,
              letterSpacing: "-0.035em",
            }}
          >
            An open AI investment companion{" "}
            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
              for Thai index investors.
            </span>
          </h1>
          <p
            style={{
              color: "var(--ink-soft)",
              fontSize: 14.5,
              lineHeight: 1.55,
              marginBottom: 28,
            }}
          >
            Add your funds, see them in one place, and ask an AI to critique your thinking.
            Open-source and self-hostable.
          </p>
          <ul className="bullet-list" style={{ marginBottom: 32 }}>
            <li>
              <span className="marker">01</span>Macrotide never trades — it only reads the holdings
              you add
            </li>
            <li>
              <span className="marker">02</span>Self-hosted — your data isn&apos;t sold or shared
            </li>
            <li>
              <span className="marker">03</span>Chat with a model that knows your holdings
            </li>
            <li>
              <span className="marker">04</span>Code on GitHub · MIT licensed
            </li>
          </ul>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button className="btn primary full" onClick={() => setStep(1)}>
            Connect your brokerage{" "}
            <span className="tag" style={{ fontSize: 9 }}>
              Preview
            </span>
            <Icon name="arrowRight" size={14} />
          </button>
          <button className="btn ghost full" onClick={onConnect}>
            Explore with demo data
          </button>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--muted)",
              lineHeight: 1.5,
              marginTop: 2,
              textAlign: "center",
            }}
          >
            Brokerage sync is a preview of planned functionality — no live integration yet. For now,
            explore the demo or add holdings manually (CSV / screenshot) once you&apos;re in.
          </p>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="screen onboard-shell">
        <div>
          <button
            className="btn ghost sm"
            style={{ marginBottom: 24, padding: "6px 12px" }}
            onClick={() => setStep(0)}
          >
            ← Back
          </button>
          <h2
            style={{
              fontSize: 26,
              marginBottom: 6,
              fontWeight: 500,
              letterSpacing: "-0.03em",
            }}
          >
            Pick a brokerage
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 13.5,
              marginBottom: 24,
            }}
          >
            Currently supports Thai mutual fund platforms.
          </p>

          <div className="stack-sm">
            {BROKERS.map((b) => (
              <div
                key={b.id}
                className="broker-card"
                onClick={() => setSelected(b.id)}
                style={{
                  borderColor: selected === b.id ? "var(--ink)" : "var(--line)",
                  borderWidth: selected === b.id ? 2 : 1,
                }}
              >
                <div className="broker-logo">{b.abbr}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{b.name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{b.desc}</div>
                </div>
                {!b.primary && (
                  <span className="tag" style={{ fontSize: 9 }}>
                    Soon
                  </span>
                )}
                {selected === b.id && b.primary && (
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 50,
                      background: "var(--ink)",
                      color: "#F8F5EE",
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon name="check" size={12} />
                  </span>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 20,
              padding: 14,
              background: "var(--card-soft)",
              border: "1px solid var(--line-soft)",
              borderRadius: "var(--r-md)",
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <Icon name="lock" size={16} />
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
              }}
            >
              Planned: read-only OAuth via the brokerage&apos;s partner API — holdings &amp; NAVs
              only, never your password or trading rights. Not yet live.
            </div>
          </div>
        </div>

        <button
          className="btn primary full"
          onClick={startConnect}
          disabled={!BROKERS.find((b) => b.id === selected)?.primary}
        >
          Continue with {BROKERS.find((b) => b.id === selected)?.name}
          <Icon name="arrowRight" size={14} />
        </button>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div
        className="screen onboard-shell"
        style={{ justifyContent: "center", textAlign: "center" }}
      >
        <div></div>
        <div>
          <div
            style={{
              width: 80,
              height: 80,
              margin: "0 auto 24px",
              borderRadius: 24,
              background: "var(--ink)",
              color: "var(--bg)",
              display: "grid",
              placeItems: "center",
              animation: "ia-pulse 1.6s ease-in-out infinite",
            }}
          >
            <Icon name="bank" size={36} />
          </div>
          <h2
            style={{
              fontSize: 22,
              marginBottom: 8,
              fontWeight: 500,
              letterSpacing: "-0.03em",
            }}
          >
            {progress < 30
              ? "Authenticating with your brokerage…"
              : progress < 60
                ? "Reading your holdings…"
                : progress < 95
                  ? "Fetching latest NAVs…"
                  : "Almost there."}
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 13.5,
              marginBottom: 32,
            }}
          >
            This usually takes a few seconds.
          </p>
          <div
            style={{
              width: 240,
              margin: "0 auto",
              background: "var(--line-soft)",
              borderRadius: 999,
              height: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: "var(--ink)",
                width: `${progress}%`,
                transition: "width 0.22s",
              }}
            ></div>
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            {Math.round(progress)}% · {progress < 100 ? "secure tls" : "complete"}
          </div>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⓘ Demo connection · no real auth happens
        </div>
        <style>{`@keyframes ia-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }`}</style>
      </div>
    );
  }

  return <DraftPlanStep onDone={onConnect} />;
}

function DraftPlanStep({ onDone }: { onDone: () => void }) {
  return (
    <div className="screen onboard-shell">
      <div>
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--accent)",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            ● CONNECTED · 4 OF 4
          </div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: "-0.03em",
              marginBottom: 8,
            }}
          >
            Draft your plan
          </h2>
          <p
            style={{
              color: "var(--muted)",
              fontSize: 13.5,
              lineHeight: 1.55,
              margin: 0,
            }}
          >
            A short brief about what you care about, your target allocation, and rules you set for
            yourself. The advisor reads it before every conversation — so it gets smarter the more
            you write.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            className="card"
            style={{ padding: 16, borderColor: "var(--accent)", borderWidth: 1.5 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--accent)",
                  color: "white",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                <Icon name="chat" size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 500,
                    marginBottom: 4,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Build with advisor
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-soft)",
                    lineHeight: 1.45,
                    marginBottom: 10,
                  }}
                >
                  Five conversational questions → a drafted plan with target, principles, risk, and
                  commitments.
                </div>
                <button
                  className="btn primary sm"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("ai-prompt", {
                        detail:
                          "Help me draft my investing plan. Walk me through what I should think about and write it for me as we go.",
                      }),
                    );
                    onDone();
                  }}
                >
                  Start conversation <Icon name="arrowRight" size={12} />
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: "var(--card-soft)",
                  color: "var(--ink-soft)",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  border: "1px solid var(--line)",
                }}
              >
                <Icon name="book" size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 500,
                    marginBottom: 4,
                    letterSpacing: "-0.01em",
                  }}
                >
                  Write it myself
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    color: "var(--ink-soft)",
                    lineHeight: 1.45,
                    marginBottom: 10,
                  }}
                >
                  Free-form markdown editor. Skip sections you&apos;re not sure about — you can
                  always edit later.
                </div>
                <button className="btn ghost sm" onClick={onDone}>
                  Open editor <Icon name="arrowRight" size={12} />
                </button>
              </div>
            </div>
          </div>

          <div style={{ padding: "10px 0", textAlign: "center" }}>
            <button
              onClick={onDone}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--muted)",
                fontSize: 13,
                fontFamily: "var(--font-sans)",
                cursor: "pointer",
                padding: 8,
              }}
            >
              Skip — I&apos;ll set this up later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
