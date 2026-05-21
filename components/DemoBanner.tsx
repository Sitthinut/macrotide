"use client";

import { useState } from "react";

export function DemoBanner() {
  const [exiting, setExiting] = useState(false);

  async function exit() {
    setExiting(true);
    try {
      await fetch("/api/demo", { method: "DELETE" });
    } catch {
      // ignore — we still want to redirect
    }
    window.location.href = "/onboarding";
  }

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--amber)",
        color: "#1a1a1a",
        padding: "6px 16px",
        fontSize: 12,
        fontWeight: 500,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <span>◐ Demo mode — your changes live in this browser session only.</span>
      <button
        type="button"
        onClick={exit}
        disabled={exiting}
        style={{
          background: "rgba(0,0,0,0.18)",
          color: "inherit",
          border: "none",
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 500,
          cursor: "pointer",
        }}
      >
        {exiting ? "Exiting…" : "Exit demo"}
      </button>
    </div>
  );
}
