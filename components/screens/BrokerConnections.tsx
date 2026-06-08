"use client";

// Settings → Connections: the broker LOGIN (account) on the outside, its
// portfolios nested inside. Account-level Sync + Disconnect; per-portfolio you
// only remap (merge = point two accounts at one portfolio). One login syncs all
// accounts, so there's no "connect another." Setup (installing the userscript)
// is the "Install connector" link / the Add-sheet banner / empty-state CTA.
// Disconnect rotates the import token (kills the old script) — no separate reset.

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { type Bucket, useBrokerConfig, useBuckets } from "@/lib/fetchers/portfolio";
import { invalidate, useResource } from "@/lib/fetchers/swr";
import { fmtRelativeDate } from "@/lib/format";

interface ConnectionRow {
  source: string;
  accountCode: string;
  displayName: string | null;
  bucketId: string | null;
  bucketName: string | null;
  lastSyncedAt: string | null;
  lastInserted: number;
  lastSkipped: number;
  /** Per-account held count (server-computed). */
  holdings: number;
}

const CONNECTIONS_KEY = "/api/import/broker/connections";

async function refresh() {
  await Promise.all([
    invalidate(CONNECTIONS_KEY),
    invalidate("/api/import/broker/token"),
    invalidate("/api/buckets"),
    invalidate(/^\/api\/holdings/),
    invalidate(/^\/api\/transactions/),
  ]);
}

export function BrokerConnections({ onConnect }: { onConnect: () => void }) {
  const { data: cfg } = useBrokerConfig();
  const { data: conns } = useResource<ConnectionRow[]>(CONNECTIONS_KEY);
  const { data: buckets } = useBuckets();
  const [disconnecting, setDisconnecting] = useState(false);

  // Not configured for this deployment → keep the original placeholder.
  if (cfg && !cfg.installUrl) return <Placeholder />;

  const broker = cfg?.displayName || "your broker";
  const rows = conns ?? [];

  // Empty state: one connect = all accounts (single connection model).
  if (rows.length === 0) {
    return (
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Sync {broker} automatically</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
          Import your full order history and keep it up to date — no manual entry. One connect
          brings every account.
        </div>
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: "flex-start" }}
          onClick={onConnect}
        >
          Connect {broker}
        </button>
      </div>
    );
  }

  const lastSynced =
    rows
      .map((r) => r.lastSyncedAt)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;
  const syncHref =
    cfg?.openUrl && rows[0]
      ? `${cfg.openUrl}?account_code=${encodeURIComponent(rows[0].accountCode)}`
      : (cfg?.openUrl ?? undefined);

  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {/* Login (account) header — mirrors the Account → Passkeys list */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            padding: "12px 14px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.01em" }}>
              {broker}
            </div>
            {cfg?.accountLabel && (
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 1 }}>
                {cfg.accountLabel}
              </div>
            )}
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {lastSynced ? `Synced ${fmtRelativeDate(lastSynced)}` : "Not synced yet"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {syncHref && (
              <a className="btn ghost sm" href={syncHref} target="_blank" rel="noreferrer">
                Sync
              </a>
            )}
            <button
              type="button"
              className="btn ghost sm"
              style={{ color: "var(--loss)", borderColor: "var(--loss)" }}
              onClick={() => setDisconnecting(true)}
            >
              Disconnect
            </button>
          </div>
        </div>

        {/* Portfolios (per broker account) */}
        {rows.map((c) => (
          <PortfolioRow
            key={`${c.source}:${c.accountCode}`}
            conn={c}
            buckets={buckets ?? []}
            holdings={c.holdings}
          />
        ))}
      </div>

      <div style={{ marginTop: 8, padding: "0 4px" }}>
        <button type="button" className="btn ghost sm" onClick={onConnect}>
          Install connector
        </button>
      </div>

      {disconnecting && (
        <DisconnectModal
          broker={broker}
          onClose={() => setDisconnecting(false)}
          onDone={async () => {
            await refresh();
            setDisconnecting(false);
          }}
        />
      )}
    </>
  );
}

function PortfolioRow({
  conn,
  buckets,
  holdings,
}: {
  conn: ConnectionRow;
  buckets: Bucket[];
  holdings: number;
}) {
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch(CONNECTIONS_KEY, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: conn.source, accountCode: conn.accountCode, ...body }),
      });
      if (!res.ok) throw new Error();
      await refresh();
      setNewName(null);
    } catch {
      window.alert("Failed to update the mapping.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderTop: "1px solid var(--line-soft)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 400,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {conn.displayName || `Account ${conn.accountCode}`}
          </span>
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {holdings} holding{holdings === 1 ? "" : "s"}
        </div>
      </div>
      {newName === null ? (
        <select
          className="mt-select"
          style={{ flexShrink: 0 }}
          value={conn.bucketId ?? ""}
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "__new__") setNewName("");
            else patch({ bucketId: e.target.value });
          }}
        >
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          <option value="__new__">＋ New portfolio…</option>
        </select>
      ) : (
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <input
            className="mt-select"
            style={{ maxWidth: 130 }}
            placeholder="Portfolio name"
            value={newName}
            disabled={busy}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy || !newName.trim()}
            onClick={() => patch({ newName: newName.trim() })}
          >
            Save
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setNewName(null)}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 12.5,
              padding: "4px 6px",
            }}
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

function DisconnectModal({
  broker,
  onClose,
  onDone,
}: {
  broker: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (mode: "leave" | "purge") => {
    setBusy(true);
    try {
      const res = await fetch(CONNECTIONS_KEY, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ all: true, mode }),
      });
      if (!res.ok) throw new Error();
      onDone();
    } catch {
      window.alert("Failed to disconnect.");
      setBusy(false);
    }
  };

  return (
    <Modal open variant="confirm" onClose={onClose} labelledBy="disconnect-title">
      <Modal.Header title={`Disconnect ${broker}?`} />
      <Modal.Body gap={8}>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", lineHeight: 1.5, margin: 0 }}>
          Syncing stops and the installed userscript is deactivated. You can reconnect any time.
          Choose what to do with the history already imported:
        </p>
      </Modal.Body>
      <Modal.Footer
        className="modal-footer--stack"
        start={
          <>
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() => run("leave")}
            >
              Keep history
            </button>
            <button
              type="button"
              className="btn sm"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--loss)",
                fontWeight: 600,
              }}
              disabled={busy}
              onClick={() => run("purge")}
            >
              Remove all history
            </button>
          </>
        }
      >
        <button type="button" className="btn primary sm" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </Modal.Footer>
    </Modal>
  );
}

function Placeholder() {
  return (
    <div className="card">
      <div className="row between">
        <div className="row">
          <div className="broker-logo" style={{ width: 36, height: 36 }}>
            +
          </div>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 500, letterSpacing: "-0.01em" }}>
              No brokerage connected
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
              Add holdings manually · broker sync not configured
            </div>
          </div>
        </div>
        <span className="tag">off</span>
      </div>
    </div>
  );
}
