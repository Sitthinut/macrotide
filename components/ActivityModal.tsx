"use client";

import { useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Sparkline } from "@/components/charts";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import type { Transaction } from "@/lib/db/queries/transactions";
import { useBuckets } from "@/lib/fetchers/portfolio";
import { invalidate, useResource } from "@/lib/fetchers/swr";
import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { TxnKind } from "@/lib/portfolio/lots";
import type { TransactionAnalytics } from "@/lib/portfolio/transaction-analytics";
import { normalizeTxnDraft, TXN_KINDS } from "@/lib/portfolio/txn-import";

type AnalyticsResponse = TransactionAnalytics & { transactionCount: number };

export interface ActivityModalProps {
  open: boolean;
  onClose: () => void;
  /** Scope to one portfolio; omit for all owned buckets. */
  bucketId?: string | null;
  /** Open the unified Add-to-portfolio sheet (bulk import / Activity mode). */
  onAddTransactions: () => void;
}

const KIND_LABEL: Record<TxnKind, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  fee: "Fee",
  split: "Split",
  reinvest: "Reinvest",
  opening: "Opening balance",
  snapshot: "Snapshot",
};

// Anchors are NOT trade types — they're outcomes of intent. Label them plainly
// for a retail investor; never expose "opening"/"snapshot" as a picker option.
const ANCHOR_LABEL: Partial<Record<TxnKind, string>> = {
  opening: "Starting balance",
  snapshot: "Restatement",
};

function isAnchorKind(k: TxnKind): boolean {
  return k === "opening" || k === "snapshot";
}

const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

// ── inline-edit draft ─────────────────────────────────────────────────────────

interface Draft {
  bucketId: string;
  tradeDate: string;
  kind: TxnKind;
  ticker: string;
  units: string;
  pricePerUnit: string;
  fee: string;
  amount: string;
  /** Preserved from the row being edited so an edit never re-routes the price source. */
  quoteSource: string;
}

function blankDraft(bucketId = ""): Draft {
  return {
    bucketId,
    tradeDate: "",
    kind: "buy",
    ticker: "",
    units: "",
    pricePerUnit: "",
    fee: "",
    amount: "",
    quoteSource: "",
  };
}

function draftFromTxn(t: Transaction): Draft {
  return {
    bucketId: t.bucketId,
    tradeDate: t.tradeDate.slice(0, 10),
    kind: t.kind as TxnKind,
    ticker: t.ticker,
    units: t.units != null ? String(t.units) : "",
    pricePerUnit: t.pricePerUnit != null ? String(t.pricePerUnit) : "",
    fee: t.fee != null ? String(t.fee) : "",
    amount: String(Math.abs(t.amount)),
    quoteSource: t.quoteSource,
  };
}

export function ActivityModal({ open, onClose, bucketId, onAddTransactions }: ActivityModalProps) {
  const scope = bucketId ? `?bucket=${encodeURIComponent(bucketId)}` : "";
  const { data: txns } = useResource<Transaction[]>(open ? `/api/transactions${scope}` : null);
  const { data: analytics } = useResource<AnalyticsResponse>(
    open ? `/api/transactions/analytics${scope}` : null,
  );
  const { data: buckets } = useBuckets();

  // Inline-edit state: which row id is being edited, or "new" for the add-row.
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  // An anchor delete re-bases every downstream position, so it routes through the
  // in-app ConfirmDialog (not native confirm(), which is off-brand + blocks).
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Realized gain per sell row, keyed by ticker+date, for the row badge.
  const realizedByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of analytics?.realized ?? []) m.set(`${e.ticker}|${e.tradeDate}`, e.realizedGain);
    return m;
  }, [analytics]);

  // Group the ledger by calendar month, newest first.
  const months = useMemo(() => {
    const groups = new Map<string, Transaction[]>();
    for (const t of txns ?? []) {
      const m = t.tradeDate.slice(0, 7);
      (groups.get(m) ?? groups.set(m, []).get(m))!.push(t);
    }
    return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [txns]);

  const hasTxns = (txns?.length ?? 0) > 0;
  const realizedTotal = analytics?.realizedTotal ?? 0;
  const totalInvested = analytics?.contributions.totalInvested ?? 0;
  const netInvestedByMonth = (analytics?.contributions.months ?? []).map((m) => m.net);
  const basisSeries = (analytics?.basisTimeline ?? []).map((p) => p.costBasis);

  const startEdit = (t: Transaction) => {
    setRowError(null);
    setDraft(draftFromTxn(t));
    setEditing(t.id);
  };
  const startAdd = () => {
    setRowError(null);
    setDraft(blankDraft(bucketId ?? buckets?.[0]?.id ?? ""));
    setEditing("new");
  };
  const cancel = () => {
    setEditing(null);
    setRowError(null);
  };

  // Refresh the ledger, the derived holdings, and (implicitly) the analytics +
  // portfolio views after any ledger mutation.
  const refresh = () => {
    invalidate(/^\/api\/transactions/);
    invalidate(/^\/api\/holdings/);
    invalidate(/^\/api\/portfolios/);
  };

  async function save() {
    setBusy(true);
    setRowError(null);
    const anchor = isAnchorKind(draft.kind);
    try {
      // Build the payload the routes expect (positive `amount` magnitude; the
      // server derives the stored sign from `kind`).
      let payload: Record<string, unknown>;
      if (anchor) {
        const units = draft.units.trim() === "" ? null : Number(draft.units);
        if (units == null || !Number.isFinite(units) || units <= 0) {
          setRowError("A starting balance needs a positive number of units.");
          setBusy(false);
          return;
        }
        payload = {
          tradeDate: draft.tradeDate,
          kind: draft.kind,
          ticker: draft.ticker.trim(),
          units,
          pricePerUnit: draft.pricePerUnit.trim() === "" ? null : Number(draft.pricePerUnit),
          amount: 0,
          // Preserve the row's existing routing key on edit; infer only for new.
          quoteSource: draft.quoteSource || inferQuoteSource(draft.ticker),
        };
        if (!payload.tradeDate || !payload.ticker) {
          setRowError("Add a date and a symbol.");
          setBusy(false);
          return;
        }
      } else {
        const d = normalizeTxnDraft({
          tradeDate: draft.tradeDate,
          kind: draft.kind,
          ticker: draft.ticker,
          units: draft.units,
          pricePerUnit: draft.pricePerUnit,
          amount: draft.amount,
          fee: draft.fee,
        });
        if (!d.ticker || d.needsDate || d.needsAmount) {
          setRowError("Add a date, symbol, and amount.");
          setBusy(false);
          return;
        }
        payload = {
          tradeDate: d.tradeDate,
          kind: d.kind,
          ticker: d.ticker,
          units: d.units,
          pricePerUnit: d.pricePerUnit,
          amount: d.amount,
          fee: d.fee,
          // Preserve the row's existing routing key on edit; d.quoteSource is the
          // ticker-inferred default for a new row.
          quoteSource: draft.quoteSource || d.quoteSource,
        };
      }

      let res: Response;
      if (editing === "new") {
        const targetBucket = draft.bucketId || bucketId || buckets?.[0]?.id;
        if (!targetBucket) {
          setRowError("Pick a portfolio.");
          setBusy(false);
          return;
        }
        res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bucketId: targetBucket, transactions: [payload] }),
        });
      } else {
        res = await fetch(`/api/transactions/${editing}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      refresh();
      setEditing(null);
    } catch {
      setRowError("Couldn't save. Check the values and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(t: Transaction) {
    try {
      const res = await fetch(`/api/transactions/${t.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(String(res.status));
      refresh();
    } catch {
      setRowError(`Couldn't delete ${t.ticker}. Try again.`);
    }
  }

  function remove(t: Transaction) {
    // A starting-balance / restatement anchor re-bases every downstream position,
    // so confirm first; ordinary trades delete straight away.
    if (isAnchorKind(t.kind as TxnKind)) {
      setPendingDelete(t);
      return;
    }
    void doDelete(t);
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        variant="detail"
        className="modal--txnwide"
        labelledBy="act-title"
      >
        <Modal.Header
          title="Activity"
          subtitle="Your buy/sell history — realized gains and money-weighted return. Edit any row in place."
          id="act-title"
          action={
            <button className="btn ghost sm" onClick={onAddTransactions} style={{ gap: 4 }}>
              <Icon name="plus" size={12} /> Import
            </button>
          }
        />
        <Modal.Body>
          {!hasTxns && editing !== "new" ? (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
              <Icon name="book" size={28} />
              <p style={{ marginTop: 12, fontSize: 14 }}>
                No transactions yet. Add one, or import a buy/sell log to track realized gains, your
                money-weighted return, and a contribution timeline.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 8 }}>
                <button className="btn primary sm" onClick={startAdd}>
                  <Icon name="plus" size={12} /> Add transaction
                </button>
                <button className="btn ghost sm" onClick={onAddTransactions}>
                  Import a log
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Summary stat strip. */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <Stat
                  label="REALIZED GAIN"
                  value={baht(realizedTotal)}
                  tone={realizedTotal >= 0 ? "up" : "down"}
                />
                <Stat
                  label="RETURN (IRR)"
                  value={analytics?.irr != null ? pct(analytics.irr) : "—"}
                  tone={analytics?.irr != null ? (analytics.irr >= 0 ? "up" : "down") : "muted"}
                  caption={
                    analytics?.irr != null
                      ? "money-weighted"
                      : (analytics?.irrUnavailable ?? "not enough activity yet")
                  }
                />
                <Stat label="TOTAL INVESTED" value={baht(totalInvested)} />
                <Stat
                  label="TRANSACTIONS"
                  value={String(analytics?.transactionCount ?? txns?.length ?? 0)}
                />
              </div>

              {/* Hand-rolled SVG charts (house style). */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                  marginBottom: 18,
                }}
              >
                {basisSeries.length > 1 && (
                  <ChartCard
                    title="Cost basis over time"
                    caption="What you've put in, net of sells"
                  >
                    <Sparkline data={basisSeries} color="var(--accent)" width={240} height={56} />
                  </ChartCard>
                )}
                {netInvestedByMonth.length > 0 && (
                  <ChartCard
                    title="Net invested by month"
                    caption="Contributions minus withdrawals"
                  >
                    <Sparkline
                      data={netInvestedByMonth}
                      color="var(--accent-2)"
                      width={240}
                      height={56}
                      showFill={false}
                    />
                  </ChartCard>
                )}
              </div>

              {rowError && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--loss)",
                    marginBottom: 10,
                    padding: "6px 10px",
                    border: "1px solid var(--loss)",
                    borderRadius: 8,
                  }}
                >
                  {rowError}
                </div>
              )}

              {/* Month-grouped ledger; any row edits in place. */}
              {months.map(([month, rows]) => (
                <div key={month} style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--muted)",
                      letterSpacing: "0.04em",
                      marginBottom: 6,
                    }}
                  >
                    {monthLabel(month)}
                  </div>
                  {rows.map((t) =>
                    editing === t.id ? (
                      <TxnEditor
                        key={t.id}
                        draft={draft}
                        onChange={setDraft}
                        onSave={save}
                        onCancel={cancel}
                        busy={busy}
                        showBucket={false}
                      />
                    ) : (
                      <LedgerRow
                        key={t.id}
                        txn={t}
                        realized={realizedByKey.get(`${t.ticker}|${t.tradeDate}`)}
                        onEdit={() => startEdit(t)}
                        onDelete={() => remove(t)}
                      />
                    ),
                  )}
                </div>
              ))}

              {/* Inline add-row. */}
              {editing === "new" ? (
                <TxnEditor
                  draft={draft}
                  onChange={setDraft}
                  onSave={save}
                  onCancel={cancel}
                  busy={busy}
                  showBucket={!bucketId}
                  buckets={(buckets ?? []).map((b) => ({ id: b.id, name: b.name }))}
                />
              ) : (
                <button
                  type="button"
                  className="btn link"
                  onClick={startAdd}
                  style={{ marginTop: 4, gap: 4 }}
                >
                  <Icon name="plus" size={12} /> Add transaction
                </button>
              )}

              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 12, lineHeight: 1.5 }}>
                Cost basis is average cost. Return is money-weighted (it accounts for when you added
                cash), shown in THB. For information only — not investment advice, and not a tax
                statement. Capital gains on Thai mutual-fund units are generally tax-exempt for
                individuals; holding-period rules (SSF / RMF) are policy-dependent.
              </p>
            </>
          )}
        </Modal.Body>
      </Modal>
      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete starting balance?"
        message={
          pendingDelete
            ? `Deleting the ${ANCHOR_LABEL[pendingDelete.kind as TxnKind] ?? "starting balance"} for ${pendingDelete.ticker} recomputes every position built on it.`
            : undefined
        }
        confirmLabel="Delete"
        busy={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return;
          setDeleting(true);
          await doDelete(pendingDelete);
          setDeleting(false);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

// ── inline editor (edit-in-place + add-row) ───────────────────────────────────

function TxnEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  busy,
  showBucket,
  buckets,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  showBucket: boolean;
  buckets?: { id: string; name: string }[];
}) {
  const anchor = isAnchorKind(draft.kind);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const cls = `ledger-edit${anchor ? " is-anchor" : showBucket ? " has-bucket" : ""}`;

  return (
    <div className="ledger-edit-card">
      <div className={cls}>
        {showBucket && !anchor && (
          <select
            value={draft.bucketId}
            onChange={(e) => set({ bucketId: e.target.value })}
            aria-label="Portfolio"
          >
            {(buckets ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={draft.tradeDate}
          onChange={(e) => set({ tradeDate: e.target.value })}
          aria-label="Trade date"
        />
        {anchor ? (
          // Anchor type is pinned — never a trade-type the user can switch.
          <span className="ledger-edit__pin">{ANCHOR_LABEL[draft.kind] ?? "Anchor"}</span>
        ) : (
          <select
            value={draft.kind}
            onChange={(e) => set({ kind: e.target.value as TxnKind })}
            aria-label="Type"
          >
            {TXN_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
        <input
          value={draft.ticker}
          onChange={(e) => set({ ticker: e.target.value })}
          placeholder="Symbol"
          aria-label="Symbol"
        />
        <input
          value={draft.units}
          onChange={(e) => set({ units: e.target.value })}
          placeholder="Units"
          inputMode="decimal"
          aria-label="Units"
        />
        <input
          value={draft.pricePerUnit}
          onChange={(e) => set({ pricePerUnit: e.target.value })}
          placeholder={anchor ? "Avg cost" : "Price"}
          inputMode="decimal"
          aria-label={anchor ? "Average cost" : "Price"}
        />
        {!anchor && (
          <>
            <input
              value={draft.fee}
              onChange={(e) => set({ fee: e.target.value })}
              placeholder="Fee"
              inputMode="decimal"
              aria-label="Fee"
            />
            <input
              value={draft.amount}
              onChange={(e) => set({ amount: e.target.value })}
              placeholder="฿ amount"
              inputMode="decimal"
              aria-label="Amount in baht"
            />
          </>
        )}
      </div>
      <div className="ledger-edit-actions">
        {anchor && (
          <span style={{ fontSize: 11, color: "var(--muted)", marginRight: "auto" }}>
            Leave avg cost blank if unknown — gains stay hidden until you add it.
          </span>
        )}
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn primary sm" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save"} <Icon name="check" size={12} />
        </button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  caption,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "muted" | "neutral";
  caption?: string;
}) {
  const color = tone === "up" ? "var(--gain)" : tone === "down" ? "var(--loss)" : "var(--ink)";
  return (
    <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: "10px 12px" }}>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          color: "var(--muted)",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
      {caption && (
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{caption}</div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>{caption}</div>
      {children}
    </div>
  );
}

function LedgerRow({
  txn,
  realized,
  onEdit,
  onDelete,
}: {
  txn: Transaction;
  realized?: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const kind = txn.kind as TxnKind;
  const isSell = kind === "sell";
  const anchor = isAnchorKind(kind);
  const pillColor = isSell
    ? "var(--loss)"
    : kind === "buy"
      ? "var(--accent)"
      : anchor
        ? "var(--accent-2)"
        : "var(--muted)";
  const label = anchor ? (ANCHOR_LABEL[kind] ?? "Anchor") : (KIND_LABEL[kind] ?? txn.kind);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0",
        borderBottom: "1px solid var(--line-soft)",
        fontSize: 13,
      }}
    >
      <span
        style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)", width: 84 }}
      >
        {txn.tradeDate.slice(0, 10)}
      </span>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: pillColor,
          border: `1px solid ${pillColor}`,
          borderRadius: 4,
          padding: "1px 6px",
          minWidth: 56,
          textAlign: "center",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, fontWeight: 500 }}>{txn.ticker}</span>
      {txn.units != null && txn.pricePerUnit != null && (
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          {txn.units.toLocaleString("en-US", { maximumFractionDigits: 4 })} @ {txn.pricePerUnit}
        </span>
      )}
      <span style={{ fontFamily: "var(--font-mono)", minWidth: 90, textAlign: "right" }}>
        {baht(Math.abs(txn.amount))}
      </span>
      {isSell && realized != null && (
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            minWidth: 72,
            textAlign: "right",
            color: realized >= 0 ? "var(--gain)" : "var(--loss)",
          }}
        >
          {realized >= 0 ? "+" : ""}
          {baht(realized)}
        </span>
      )}
      <button
        type="button"
        className="icon-btn"
        onClick={onEdit}
        aria-label={`Edit ${txn.ticker}`}
        title="Edit"
        style={{ color: "var(--muted)" }}
      >
        <Icon name="pencil" size={14} />
      </button>
      <button
        type="button"
        className="icon-btn"
        onClick={onDelete}
        aria-label={`Delete ${txn.ticker}`}
        title="Delete"
        style={{ color: "var(--muted)" }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
