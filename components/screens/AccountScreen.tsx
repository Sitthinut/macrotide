"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/client";
import { useResource } from "@/lib/fetchers/swr";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsageData {
  inputTokens: number;
  outputTokens: number;
}

// Shape returned by better-auth's /list-accounts endpoint.
interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
}

export interface AccountScreenProps {
  onBack: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OAUTH_PROVIDERS: { id: string; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  try {
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return String(d);
  }
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AccountScreen({ onBack }: AccountScreenProps) {
  // Session (name + email)
  const session = authClient.useSession();
  // Passkeys (reactive — refetches after add/delete)
  const passkeyState = authClient.useListPasskeys();
  // Today's token usage
  const { data: usageData, isLoading: usageLoading } = useResource<UsageData>("/api/account/usage");

  // Linked OAuth providers fetched once on mount.
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[] | null>(null);
  const [linkedLoading, setLinkedLoading] = useState(true);

  // Action state
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authClient
      .listAccounts()
      .then(({ data }) => {
        if (!cancelled) setLinkedAccounts((data as LinkedAccount[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setLinkedAccounts([]);
      })
      .finally(() => {
        if (!cancelled) setLinkedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const user = session.data?.user;
  const passkeyList = passkeyState.data ?? [];
  const inputTokens = usageData?.inputTokens ?? 0;
  const outputTokens = usageData?.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleAddPasskey() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await authClient.passkey.addPasskey({
        name: `Device · ${new Date().toLocaleDateString()}`,
      });
      if (res?.error) {
        throw new Error(res.error.message ?? "Passkey registration failed");
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Passkey registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePasskey(id: string, name: string | undefined) {
    const label = name ?? "this passkey";
    if (!window.confirm(`Remove "${label}"? You won't be able to use it to sign in.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      // Dynamic proxy routes this to POST /api/auth/passkey/delete-passkey
      const res = await authClient.passkey.deletePasskey({ id });
      if (res?.error) {
        throw new Error(res.error.message ?? "Delete failed");
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOutEverywhere() {
    if (!window.confirm("Sign out of all devices? You'll need to authenticate again on each one."))
      return;
    setBusy(true);
    setActionError(null);
    try {
      // Use $fetch directly to ensure POST method; the dynamic proxy infers GET
      // from an empty body, but /revoke-sessions is a POST-only endpoint.
      const res = await authClient.$fetch("/revoke-sessions", { method: "POST" });
      if ((res as { error?: { message?: string } })?.error) {
        throw new Error(
          (res as { error?: { message?: string } }).error?.message ?? "Sign-out failed",
        );
      }
      window.location.href = "/login";
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Sign-out failed");
      setBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="screen">
      {/* ── Topbar ── */}
      <div className="topbar">
        <button
          className="icon-btn"
          type="button"
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
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="brand" style={{ flex: 1 }}>
          <span>Account</span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {actionError && (
        <div
          style={{
            margin: "0 16px 10px",
            padding: "10px 14px",
            borderRadius: "var(--r-md)",
            background: "var(--loss-soft, #fef2f2)",
            border: "1px solid var(--loss-line, #fecaca)",
            fontSize: 13,
            color: "var(--loss, #dc2626)",
            lineHeight: 1.4,
          }}
        >
          {actionError}
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            style={{
              float: "right",
              background: "none",
              border: 0,
              cursor: "pointer",
              color: "inherit",
              padding: "0 2px",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Profile ── */}
      <div className="section" style={{ marginTop: 6 }}>
        <div className="section-header">
          <h3>Profile</h3>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>Name</span>
            <span
              style={{
                fontSize: 13.5,
                color: "var(--ink)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
              }}
            >
              {user?.name ?? "—"}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderTop: "1px solid var(--line-soft)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>Email</span>
            <span
              style={{
                fontSize: 12.5,
                color: "var(--ink-soft, var(--muted))",
                fontFamily: "var(--font-mono)",
              }}
            >
              {user?.email ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Passkeys ── */}
      <div className="section">
        <div className="section-header">
          <h3>Passkeys</h3>
        </div>

        {passkeyState.isPending && (
          <div className="card" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            Loading passkeys…
          </div>
        )}

        {!passkeyState.isPending && passkeyList.length === 0 && (
          <div className="card" style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.5 }}>
            No passkeys registered yet.
          </div>
        )}

        {!passkeyState.isPending && passkeyList.length > 0 && (
          <div className="card" style={{ padding: 0 }}>
            {passkeyList.map((pk, idx) => (
              <div
                key={pk.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "11px 14px",
                  borderTop: idx === 0 ? "none" : "1px solid var(--line-soft)",
                }}
              >
                {/* Key icon */}
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--muted)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="8" cy="15" r="4" />
                  <path d="M12 15h8M19 15v2M16 15v2" />
                </svg>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {pk.name ?? "Unnamed passkey"}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      color: "var(--muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {pk.deviceType === "multiDevice" ? "Multi-device" : "Single-device"} ·
                    Registered {fmtDate(pk.createdAt)}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDeletePasskey(pk.id, pk.name ?? undefined)}
                  aria-label={`Remove passkey ${pk.name ?? ""}`}
                  style={{
                    background: "transparent",
                    border: 0,
                    color: "var(--muted)",
                    cursor: busy ? "not-allowed" : "pointer",
                    padding: "4px 8px",
                    fontSize: 12.5,
                    borderRadius: "var(--r-sm)",
                    flexShrink: 0,
                    opacity: busy ? 0.5 : 1,
                    transition: "color 0.15s",
                  }}
                  title="Revoke"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add passkey button */}
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn ghost full sm"
            onClick={handleAddPasskey}
            disabled={busy}
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Register passkey on this device
          </button>
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "8px 4px 0",
            lineHeight: 1.5,
          }}
        >
          Use this device's biometrics or PIN to sign in. Register on each device you use.
        </div>
      </div>

      {/* ── Linked sign-in methods ── */}
      <div className="section">
        <div className="section-header">
          <h3>Sign-in methods</h3>
        </div>
        <div className="card" style={{ padding: 0 }}>
          {/* Email/password (always present — used to bootstrap passkey sign-up) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "11px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M2 8l10 7 10-7" />
              </svg>
              <span style={{ fontSize: 13, color: "var(--ink)" }}>Passkey + email</span>
            </div>
            <span className="tag green">active</span>
          </div>

          {/* OAuth providers */}
          {OAUTH_PROVIDERS.map((provider) => {
            const linked = linkedAccounts?.some((a) => a.providerId === provider.id) ?? false;
            return (
              <div
                key={provider.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "11px 14px",
                  borderTop: "1px solid var(--line-soft)",
                  opacity: linkedLoading ? 0.5 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ProviderIcon id={provider.id} />
                  <span style={{ fontSize: 13, color: "var(--ink)" }}>{provider.label}</span>
                </div>
                <span
                  className={`tag ${linked ? "green" : ""}`}
                  style={linked ? {} : { color: "var(--muted)" }}
                >
                  {linked ? "linked" : "not linked"}
                </span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "8px 4px 0",
            lineHeight: 1.5,
          }}
        >
          OAuth sign-in (Google / GitHub) is configured in Phase 6b. Passkey is the primary method
          today.
        </div>
      </div>

      {/* ── Today's usage ── */}
      <div className="section">
        <div className="section-header">
          <h3>Today's usage</h3>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>
              Input tokens
            </span>
            <span
              style={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                color: "var(--ink)",
              }}
            >
              {usageLoading ? "…" : fmtTokens(inputTokens)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderTop: "1px solid var(--line-soft)",
            }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>
              Output tokens
            </span>
            <span
              style={{
                fontSize: 13,
                fontFamily: "var(--font-mono)",
                color: "var(--ink)",
              }}
            >
              {usageLoading ? "…" : fmtTokens(outputTokens)}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              borderTop: "1px solid var(--line-soft)",
              background: "var(--card-soft, var(--paper))",
              borderRadius: "0 0 var(--r-lg) var(--r-lg)",
            }}
          >
            <span
              style={{ fontSize: 12.5, color: "var(--ink-soft, var(--muted))", fontWeight: 500 }}
            >
              Total
            </span>
            <span
              style={{
                fontSize: 14,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {usageLoading ? "…" : fmtTokens(totalTokens)}
            </span>
          </div>
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "8px 4px 0",
            lineHeight: 1.5,
          }}
        >
          Resets at UTC midnight. Your tier determines which models you can access.
        </div>
      </div>

      {/* ── Sign out everywhere ── */}
      <div className="section" style={{ marginBottom: 32 }}>
        <div className="section-header">
          <h3>Sessions</h3>
        </div>
        <button
          type="button"
          className="btn ghost full"
          onClick={handleSignOutEverywhere}
          disabled={busy}
          style={{
            color: "var(--loss, #dc2626)",
            borderColor: "var(--loss-line, #fecaca)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
          </svg>
          Sign out everywhere
        </button>
        <div
          style={{
            fontSize: 11.5,
            color: "var(--muted)",
            padding: "8px 4px 0",
            lineHeight: 1.5,
          }}
        >
          Revokes all active sessions across all devices. You'll be redirected to sign in.
        </div>
      </div>
    </div>
  );
}

// ─── Provider icon helper ──────────────────────────────────────────────────────

function ProviderIcon({ id }: { id: string }) {
  if (id === "google") {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M17.5 12H12v3h3.2A5 5 0 0112 17a5 5 0 010-10c1.35 0 2.57.51 3.48 1.34L17.41 6.4A8 8 0 1012 20a8 8 0 007.5-10.84H17.5z" />
      </svg>
    );
  }
  if (id === "github") {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--muted)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
      </svg>
    );
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--muted)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
