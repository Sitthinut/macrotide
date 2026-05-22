"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient, signIn, useSession } from "@/lib/auth/client";

type Mode = "intro" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>("intro");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Skip the login screen.
  useEffect(() => {
    if (session?.user) router.replace("/");
  }, [session, router]);

  async function startDemo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) throw new Error("demo start failed");
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "demo start failed");
      setBusy(false);
    }
  }

  async function signInPasskey() {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.passkey();
      if (result?.error) throw new Error(result.error.message ?? "sign in failed");
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign in failed");
      setBusy(false);
    }
  }

  async function createAccountWithPasskey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Step 1: create an empty-password user record. (Passkey registration
      // happens after the user is "signed in" — the addPasskey() call needs
      // a session.)
      const signUp = await authClient.signUp.email({
        email,
        name,
        // better-auth requires a password even when email/password is the
        // disabled fallback path. Generate a random one the user never sees.
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
      if (signUp?.error) throw new Error(signUp.error.message ?? "sign up failed");

      // Step 2: prompt the browser to create a passkey now that we have a
      // session cookie.
      const addPk = await authClient.passkey.addPasskey({
        name: `${name} · ${new Date().toLocaleDateString()}`,
      });
      if (addPk?.error) throw new Error(addPk.error.message ?? "passkey registration failed");

      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign up failed");
      setBusy(false);
    }
  }

  return (
    <div style={shell}>
      <div style={card}>
        <div style={mark}>Macrotide</div>
        <div style={tagline}>
          {mode === "intro" ? (
            <>An AI companion for index investors. Track your funds, plan, and chat.</>
          ) : (
            <>Create your account. We'll set up a passkey on this device.</>
          )}
        </div>

        {mode === "intro" && (
          <>
            <button type="button" style={primary} onClick={signInPasskey} disabled={busy}>
              Sign in with passkey
            </button>
            <button
              type="button"
              style={secondary}
              onClick={() => setMode("signup")}
              disabled={busy}
            >
              Create account
            </button>
            <button type="button" style={ghost} onClick={startDemo} disabled={busy}>
              {busy ? "Loading…" : "Try the demo"}
            </button>
            <div style={hint}>
              Demo data lives in your session only — refresh-safe, never written to a real DB.
              <br />
              Chat is rate-limited to 10 turns in demo mode.
            </div>
          </>
        )}

        {mode === "signup" && (
          <form onSubmit={createAccountWithPasskey} style={{ width: "100%" }}>
            <input
              type="text"
              required
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={input}
            />
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={input}
            />
            <button type="submit" style={primary} disabled={busy || !email || !name}>
              {busy ? "Setting up…" : "Create passkey & continue"}
            </button>
            <button type="button" style={ghost} onClick={() => setMode("intro")} disabled={busy}>
              Back
            </button>
          </form>
        )}

        {error && <div style={errBanner}>{error}</div>}

        <div style={footer}>Open source · Self-hosted</div>
      </div>
    </div>
  );
}

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 16px",
  background: "var(--bg)",
  color: "var(--ink)",
  fontFamily: "var(--font-sans)",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  background: "var(--paper)",
  border: "1px solid var(--line-soft)",
  borderRadius: 18,
  padding: "32px 24px 24px",
  boxShadow: "var(--shadow-md)",
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
};

const mark: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  letterSpacing: "-0.04em",
  marginBottom: 4,
};

const tagline: React.CSSProperties = {
  fontSize: 14,
  color: "var(--muted)",
  lineHeight: 1.5,
  marginBottom: 12,
};

const baseBtn: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: 12,
  fontSize: 14,
  fontWeight: 500,
  fontFamily: "var(--font-sans)",
  cursor: "pointer",
  transition: "opacity 0.15s",
  border: "1px solid transparent",
};

const primary: React.CSSProperties = {
  ...baseBtn,
  background: "var(--accent)",
  color: "white",
};

const secondary: React.CSSProperties = {
  ...baseBtn,
  background: "var(--card-soft)",
  color: "var(--ink)",
  borderColor: "var(--line)",
};

const ghost: React.CSSProperties = {
  ...baseBtn,
  background: "transparent",
  color: "var(--muted)",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  background: "var(--bg)",
  border: "1px solid var(--line)",
  color: "var(--ink)",
  fontSize: 14,
  fontFamily: "var(--font-sans)",
  marginBottom: 8,
  boxSizing: "border-box",
};

const errBanner: React.CSSProperties = {
  width: "100%",
  fontSize: 12,
  background: "rgba(209, 69, 69, 0.08)",
  color: "var(--loss)",
  borderRadius: 8,
  padding: "8px 12px",
  textAlign: "left",
};

const hint: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  lineHeight: 1.5,
  marginTop: 4,
};

const footer: React.CSSProperties = {
  marginTop: 20,
  fontSize: 11,
  color: "var(--muted-2)",
};
