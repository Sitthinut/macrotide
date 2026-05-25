"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Public, signed-out landing shown at `/` (app/page.tsx renders this when there
// is no session and no demo cookie). The single source of the product pitch —
// the in-app onboarding does NOT duplicate this copy. CTAs route to real auth
// (/login) or start a demo session; there is no simulated brokerage flow here.
export default function Landing() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function startDemo() {
    setBusy(true);
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) throw new Error("demo start failed");
      // Cookie is set; re-render `/` server-side, which now routes to demo mode.
      router.replace("/");
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="screen onboard-shell">
      <div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 36 }}>
          <span className="brand-mark" style={{ width: 26, height: 26, borderRadius: 8 }} />
          <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em" }}>Macrotide</span>
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
          <span style={{ color: "var(--muted)", fontWeight: 400 }}>for Thai index investors.</span>
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
        <button
          type="button"
          className="btn primary full"
          onClick={() => router.push("/login")}
          disabled={busy}
        >
          Get started
        </button>
        <button type="button" className="btn ghost full" onClick={startDemo} disabled={busy}>
          {busy ? "Loading…" : "Explore with demo data"}
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
          Brokerage sync is coming soon. For now, add holdings manually (CSV / screenshot) once
          you&apos;re in.
        </p>
      </div>
    </div>
  );
}
