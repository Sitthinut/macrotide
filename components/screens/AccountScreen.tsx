"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { aaguidName } from "@/lib/auth/aaguid";
import { clearDemoSession } from "@/lib/auth/clear-demo";
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
  // Pending destructive action awaiting confirmation.
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);

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
  // Lockout guard: a user's only sign-in path is their passkey(s) unless they've
  // linked an OAuth provider (the email/password record is a hidden bootstrap,
  // not a usable login). So forbid revoking the last passkey in that case.
  const hasLinkedOAuth = OAUTH_PROVIDERS.some(
    (p) => linkedAccounts?.some((a) => a.providerId === p.id) ?? false,
  );
  const cannotRevokeLast = passkeyList.length <= 1 && !hasLinkedOAuth;
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

  function handleDeletePasskey(id: string, name: string | undefined) {
    if (cannotRevokeLast) {
      setActionError(
        "This is your only way to sign in. Register another passkey before removing this one.",
      );
      return;
    }
    const label = name ?? "this passkey";
    setConfirm({
      title: "Remove passkey?",
      message: `"${label}" will be removed and can no longer be used to sign in.`,
      confirmLabel: "Remove passkey",
      run: async () => {
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
      },
    });
  }

  function handleSignOutEverywhere() {
    setConfirm({
      title: "Sign out everywhere?",
      message: "You'll be signed out of all devices and need to authenticate again on each one.",
      confirmLabel: "Sign out everywhere",
      run: async () => {
        setBusy(true);
        setActionError(null);
        try {
          // Clear the demo cookie alongside the real session — see comment in
          // App.tsx::signOut.
          await clearDemoSession();
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
      },
    });
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

      {/* ── Sign in (methods + registered passkeys) ── */}
      <div className="section">
        <div className="section-header">
          <h3>Sign in</h3>
        </div>

        {/* Methods linked to this account */}
        <div className="card" style={{ padding: 0 }}>
          {/* Passkey — the native method (bootstrapped at sign-up) */}
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
                style={{ flexShrink: 0 }}
              >
                <circle cx="8" cy="15" r="4" />
                <path d="M12 15h8M19 15v2M16 15v2" />
              </svg>
              <span style={{ fontSize: 13, color: "var(--ink)" }}>Passkeys</span>
            </div>
            {/* Reflect the real credential count — an OAuth user who skipped the
                passkey prompt has none, so "active" would be a lie. */}
            {passkeyState.isPending ? (
              <span className="tag" style={{ color: "var(--muted)" }}>
                …
              </span>
            ) : passkeyList.length > 0 ? (
              <span className="tag green">active</span>
            ) : (
              <span className="tag" style={{ color: "var(--muted)" }}>
                none
              </span>
            )}
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
          Passkey is the primary sign-in method. Where the operator has configured Google or GitHub,
          you can link it for one-tap sign-in.
        </div>

        {/* Your registered passkeys */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--muted)",
            letterSpacing: "0.02em",
            padding: "18px 4px 6px",
          }}
        >
          Your passkeys
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
            {passkeyList.map((pk, idx) => {
              // Primary label: prefer the resolved authenticator/provider name;
              // otherwise fall back to a device-type-based label that still
              // conveys whether the credential is synced across devices.
              const resolvedName = aaguidName(pk.aaguid);
              const label =
                resolvedName ??
                (pk.deviceType === "multiDevice" ? "Synced passkey" : "This device");
              // Only show the "Synced" badge alongside a named authenticator —
              // when we fell back to a device-type label it would be redundant.
              const showSyncedBadge = resolvedName != null && pk.backedUp === true;
              return (
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
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        minWidth: 0,
                      }}
                    >
                      <span
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
                        {label}
                      </span>
                      {showSyncedBadge && (
                        <span className="tag" style={{ flexShrink: 0 }}>
                          Synced
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 11,
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      Created on {fmtDate(pk.createdAt)}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={busy || cannotRevokeLast}
                    onClick={() => handleDeletePasskey(pk.id, label)}
                    aria-label={`Remove passkey ${label}`}
                    style={{
                      background: "transparent",
                      border: 0,
                      color: "var(--muted)",
                      cursor: busy || cannotRevokeLast ? "not-allowed" : "pointer",
                      padding: "4px 8px",
                      fontSize: 12.5,
                      borderRadius: "var(--r-sm)",
                      flexShrink: 0,
                      opacity: busy || cannotRevokeLast ? 0.5 : 1,
                      transition: "color 0.15s",
                    }}
                    title={
                      cannotRevokeLast
                        ? "Register another passkey before removing your last sign-in method"
                        : "Revoke"
                    }
                  >
                    Revoke
                  </button>
                </div>
              );
            })}
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

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ""}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        busy={busy}
        onConfirm={async () => {
          const action = confirm;
          setConfirm(null);
          await action?.run();
        }}
        onCancel={() => setConfirm(null)}
      />
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
