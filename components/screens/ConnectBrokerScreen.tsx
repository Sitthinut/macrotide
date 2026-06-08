"use client";

// Connect-a-broker wizard — a dedicated full screen (not a modal) for the
// multi-step setup: install a userscript manager → install the Macrotide
// userscript (URL / QR, paste fallback) → open the broker → see the sync land.
// Opened from a banner in the Add sheet and from Settings → Connections; Back is
// contextual (returns to wherever it was opened from). Management of synced
// accounts lives in Settings → Connections (the success step links there).

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  type DeviceOS,
  detectOS,
  ENABLE_NOTE,
  OS_LABEL,
  USERSCRIPT_APPS,
} from "@/lib/portfolio/userscript-apps";

interface Config {
  token: string;
  displayName: string;
  installUrl: string;
  openUrl: string | null;
  loginUrl: string | null;
}

interface ConnectionRow {
  lastSyncedAt: string | null;
  lastInserted: number;
}

const STEP_TITLES = [
  "Install a userscript manager",
  "Install the Macrotide userscript",
  "Open your broker & log in",
  "Synced",
];

export interface ConnectBrokerScreenProps {
  onBack: () => void;
  onOrganize: () => void;
}

export function ConnectBrokerScreen({ onBack, onOrganize }: ConnectBrokerScreenProps) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [step, setStep] = useState(1);
  const [os, setOs] = useState<DeviceOS>("desktop");
  const [showAllApps, setShowAllApps] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [scriptText, setScriptText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [synced, setSynced] = useState<{ inserted: number; portfolios: number } | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined") setOs(detectOS(navigator.userAgent));
  }, []);

  // Load config (token + install/open URLs). 404 → broker not configured.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/import/broker/token");
        if (!alive) return;
        if (res.status === 404) {
          setConfigured(false);
          return;
        }
        const body = (await res.json()) as Partial<Config>;
        if (body.token && body.installUrl) {
          setCfg({
            token: body.token,
            displayName: body.displayName || "your broker",
            installUrl: body.installUrl,
            openUrl: body.openUrl ?? null,
            loginUrl: body.loginUrl ?? null,
          });
          setConfigured(true);
        } else {
          setConfigured(false);
        }
      } catch {
        if (alive) setConfigured(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (step !== 2 || !cfg || qr) return;
    QRCode.toDataURL(cfg.installUrl, { width: 168, margin: 1 })
      .then(setQr)
      .catch(() => {});
  }, [step, cfg, qr]);

  // Poll for a fresh sync once the user is on step 3+.
  useEffect(() => {
    if (step < 3) return;
    let alive = true;
    let timer: number;
    const start = Date.now();
    const tick = async () => {
      try {
        const res = await fetch("/api/import/broker/connections");
        if (res.ok && alive) {
          const rows = (await res.json()) as ConnectionRow[];
          const done = rows.filter((r) => r.lastSyncedAt);
          if (done.length) {
            setSynced({
              inserted: done.reduce((s, r) => s + (r.lastInserted || 0), 0),
              portfolios: done.length,
            });
            setStep(4);
          }
        }
      } catch {
        // transient — keep polling
      }
      if (alive && Date.now() - start < 5 * 60_000) timer = window.setTimeout(tick, 3000);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [step]);

  // One-click: fetch the script (if not already) and copy it in a single action.
  const copyScript = async () => {
    if (!cfg) return;
    try {
      const text = scriptText ?? (await (await fetch(cfg.installUrl)).text());
      setScriptText(text);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked / fetch failed — the install link still works */
    }
  };

  const otherOses = (Object.keys(USERSCRIPT_APPS) as DeviceOS[]).filter((o) => o !== os);

  const apps = USERSCRIPT_APPS[os];

  return (
    <div className="screen">
      <div className="topbar">
        <button
          type="button"
          className="icon-btn"
          onClick={onBack}
          aria-label="Back"
          style={{ marginRight: 8 }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>Connect {cfg?.displayName ?? "your broker"}</span>
        </div>
      </div>

      <div className="section" style={{ marginTop: 6 }}>
        {configured === false ? (
          <div className="card">
            <div style={{ fontSize: 13, fontWeight: 500 }}>Broker import isn't set up</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
              This deployment has no broker configured.
            </div>
          </div>
        ) : (
          <ol className="import-steps">
            {STEP_TITLES.map((title, i) => {
              const n = i + 1;
              const state =
                synced && n === 4 ? "done" : n < step ? "done" : n === step ? "active" : "todo";
              return (
                <li key={title} className={`import-step import-step--${state}`}>
                  <div className="import-step__marker" aria-hidden>
                    {state === "done" ? <Icon name="check" size={12} /> : n}
                  </div>
                  <div className="import-step__main">
                    <div className="import-step__title">{title}</div>

                    {n === step && n === 1 && (
                      <div className="import-step__body">
                        <p className="import-hint">For {OS_LABEL[os]}:</p>
                        {apps.map((a, ai) => (
                          <a
                            key={a.name}
                            className={`import-app${ai === 0 ? " import-app--rec" : ""}`}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <strong>{a.name}</strong>
                            <span>{a.note}</span>
                          </a>
                        ))}
                        <p className="import-note">{ENABLE_NOTE}</p>
                        <button
                          type="button"
                          className="btn link"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 0",
                            fontSize: 12,
                          }}
                          aria-expanded={showAllApps}
                          onClick={() => setShowAllApps((v) => !v)}
                        >
                          Other devices
                          <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                            {showAllApps ? "▾" : "▸"}
                          </span>
                        </button>
                        {showAllApps &&
                          otherOses.map((o) => (
                            <div key={o} className="import-step__body" style={{ marginTop: 2 }}>
                              <p className="import-hint">For {OS_LABEL[o]}:</p>
                              {USERSCRIPT_APPS[o].map((a) => (
                                <a
                                  key={a.name}
                                  className="import-app"
                                  href={a.url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <strong>{a.name}</strong>
                                  <span>{a.note}</span>
                                </a>
                              ))}
                            </div>
                          ))}
                        <button type="button" className="btn primary sm" onClick={() => setStep(2)}>
                          I've installed one →
                        </button>
                      </div>
                    )}

                    {n === step && n === 2 && cfg && (
                      <div className="import-step__body">
                        <p className="import-hint">Add the Macrotide userscript to your manager:</p>
                        <div className="import-actions">
                          <a
                            className="btn ghost sm"
                            style={{ gap: 4, borderColor: "var(--accent)", color: "var(--accent)" }}
                            href={cfg.installUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icon name="download" size={12} /> Install userscript
                          </a>
                          <button type="button" className="btn ghost sm" onClick={copyScript}>
                            {copied ? "Copied ✓" : "Copy script"}
                          </button>
                        </div>
                        {qr && (
                          <div className="import-qr-block">
                            <span className="import-note">Or scan to install on your phone</span>
                            {/* biome-ignore lint/performance/noImgElement: data-URL QR, no Next loader */}
                            <img
                              className="import-qr"
                              src={qr}
                              alt="Install QR code"
                              width={132}
                              height={132}
                            />
                          </div>
                        )}
                        <button type="button" className="btn primary sm" onClick={() => setStep(3)}>
                          I've added the script →
                        </button>
                      </div>
                    )}

                    {n === step && n === 3 && cfg && (
                      <div className="import-step__body">
                        <p className="import-hint">
                          Open {cfg.displayName}, log in if needed, and the script syncs
                          automatically — keep this tab open.
                        </p>
                        {cfg.openUrl && (
                          <a
                            className="btn accent sm"
                            href={cfg.openUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Icon name="arrowRight" size={12} /> Open {cfg.displayName}
                          </a>
                        )}
                        <p className="import-note">
                          You may briefly see an error page on {cfg.displayName} — that's fine, the
                          sync still runs underneath.
                        </p>
                        {cfg.loginUrl && cfg.loginUrl !== cfg.openUrl && (
                          <a
                            className="btn link xs"
                            href={cfg.loginUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Need to log in first? Open your dashboard
                          </a>
                        )}
                        <p className="broker-import__status" aria-live="polite">
                          <Icon name="loader" size={12} /> Waiting for your first sync…
                        </p>
                      </div>
                    )}

                    {n === 4 && synced && (
                      <div className="import-step__body">
                        <p className="import-hint" aria-live="polite">
                          Synced {synced.inserted} new order(s) across {synced.portfolios}{" "}
                          portfolio(s).
                        </p>
                        <button type="button" className="btn primary sm" onClick={onOrganize}>
                          Organize in Settings → Connections
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
