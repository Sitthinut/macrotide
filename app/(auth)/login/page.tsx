"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authClient, signIn, useSession } from "@/lib/auth/client";
import { Turnstile } from "./Turnstile";

type Mode = "intro" | "signup";

interface AuthConfig {
  providers: { google: boolean; github: boolean };
  turnstile: { enabled: boolean; siteKey: string | null };
}

// useSearchParams requires a Suspense boundary in Next 15 app router.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>("intro");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  // After OAuth sign-in we redirect back to /login?passkey=prompt to offer
  // registering a passkey on this device. Detect that here.
  const passkeyPrompt = searchParams.get("passkey") === "prompt";

  // Load which providers + bot-protection the server has configured.
  useEffect(() => {
    fetch("/api/auth-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((c: AuthConfig | null) => c && setConfig(c))
      .catch(() => {});
  }, []);

  // Already signed in? Skip the login screen — unless we're prompting for a
  // passkey after a fresh OAuth sign-in. Skip while `busy`: during account
  // creation, signUp.email() auto-signs-in and flips `session` before the
  // following addPasskey() can run, so a redirect here would preempt the
  // WebAuthn prompt. The active handler does its own redirect once done.
  useEffect(() => {
    if (session?.user && !passkeyPrompt && !busy) {
      // Drop any stale demo session before bouncing into the dashboard so a
      // returning demo-then-login user doesn't carry the cookie. Best-effort.
      fetch("/api/demo", { method: "DELETE" }).catch(() => {});
      router.replace("/");
    }
  }, [session, router, passkeyPrompt, busy]);

  // Header sent on account-creation / OAuth POSTs so the server-side Turnstile
  // gate can verify it. Empty when Turnstile isn't configured (dev bypass).
  function turnstileHeaders(): Record<string, string> {
    return turnstileToken ? { "x-turnstile-token": turnstileToken } : {};
  }

  // Clear any stale demo session before entering a real account. DELETE
  // /api/demo drops the in-memory demo DB and clears the macrotide_demo cookie
  // so a returning demo-then-login user doesn't carry it into the dashboard.
  // Best-effort: never block login if it fails.
  async function clearDemoSession() {
    try {
      await fetch("/api/demo", { method: "DELETE" });
    } catch {
      // ignore — demo cookie is harmless once a real session takes precedence.
    }
  }

  async function continueToApp() {
    await clearDemoSession();
    router.replace("/");
  }

  async function signInSocial(provider: "google" | "github") {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn.social({
        provider,
        callbackURL: "/login?passkey=prompt",
        fetchOptions: { headers: turnstileHeaders() },
      });
      if (result?.error) throw new Error(result.error.message ?? "sign in failed");
      // signIn.social triggers a redirect to the provider; nothing more to do.
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign in failed");
      setBusy(false);
    }
  }

  async function addPasskeyAndContinue() {
    setBusy(true);
    setError(null);
    try {
      const addPk = await authClient.passkey.addPasskey({
        name: `${session?.user?.name ?? "Passkey"} · ${new Date().toLocaleDateString()}`,
      });
      if (addPk?.error) throw new Error(addPk.error.message ?? "passkey registration failed");
      await continueToApp();
    } catch (e) {
      setError(e instanceof Error ? e.message : "passkey registration failed");
      setBusy(false);
    }
  }

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
      await continueToApp();
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
        // Carry the Turnstile token so the server-side signup gate (6c) can
        // verify it. Bypassed server-side when Turnstile isn't configured.
        fetchOptions: { headers: turnstileHeaders() },
      });
      if (signUp?.error) throw new Error(signUp.error.message ?? "sign up failed");

      // Step 2: prompt the browser to create a passkey now that we have a
      // session cookie.
      const addPk = await authClient.passkey.addPasskey({
        name: `${name} · ${new Date().toLocaleDateString()}`,
      });
      if (addPk?.error) throw new Error(addPk.error.message ?? "passkey registration failed");

      await continueToApp();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign up failed");
      setBusy(false);
    }
  }

  const hasOAuth = Boolean(config?.providers.google || config?.providers.github);
  // Turnstile must be solved before account-creation / OAuth when it's
  // configured. In dev (not configured) this is always satisfied.
  const turnstileSatisfied = !config?.turnstile.enabled || Boolean(turnstileToken);

  // Post-OAuth passkey registration prompt (6b): offer to add a passkey to
  // this device so future sign-ins skip the OAuth round-trip.
  if (passkeyPrompt && session?.user) {
    return (
      <div style={shell}>
        <div style={card}>
          <div style={mark}>Macrotide</div>
          <div style={tagline}>
            You're signed in. Add a passkey to this device for faster sign-in next time?
          </div>
          <button type="button" style={primary} onClick={addPasskeyAndContinue} disabled={busy}>
            {busy ? "Setting up…" : "Add a passkey"}
          </button>
          <button type="button" style={ghost} onClick={continueToApp} disabled={busy}>
            Skip for now
          </button>
          {error && <div style={errBanner}>{error}</div>}
          <div style={footer}>Open source · Self-hosted</div>
        </div>
      </div>
    );
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
            {hasOAuth && (
              <>
                {config?.providers.google && (
                  <button
                    type="button"
                    style={secondary}
                    onClick={() => signInSocial("google")}
                    disabled={busy || !turnstileSatisfied}
                  >
                    Continue with Google
                  </button>
                )}
                {config?.providers.github && (
                  <button
                    type="button"
                    style={secondary}
                    onClick={() => signInSocial("github")}
                    disabled={busy || !turnstileSatisfied}
                  >
                    Continue with GitHub
                  </button>
                )}
                {config?.turnstile.enabled && config.turnstile.siteKey && (
                  <Turnstile siteKey={config.turnstile.siteKey} onToken={setTurnstileToken} />
                )}
                <div style={divider}>or</div>
              </>
            )}
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
            {config?.turnstile.enabled && config.turnstile.siteKey && (
              <div style={{ margin: "8px 0" }}>
                <Turnstile siteKey={config.turnstile.siteKey} onToken={setTurnstileToken} />
              </div>
            )}
            <button
              type="submit"
              style={primary}
              disabled={busy || !email || !name || !turnstileSatisfied}
            >
              {busy ? "Setting up…" : "Create passkey & continue"}
            </button>
            <p style={consentNote}>
              By continuing, you agree to the{" "}
              <a href="/legal/terms" target="_blank" rel="noreferrer" style={legalLink}>
                Terms
              </a>{" "}
              and{" "}
              <a href="/legal/privacy" target="_blank" rel="noreferrer" style={legalLink}>
                Privacy Policy
              </a>
              .
            </p>
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

const divider: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted-2)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "4px 0",
};

const consentNote: React.CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
  lineHeight: 1.5,
  margin: "8px 0 2px",
};

const legalLink: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
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
