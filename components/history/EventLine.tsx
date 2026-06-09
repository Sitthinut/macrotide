"use client";

// EventLine — one ledger event rendered in the app's native holdings-row
// grammar (`.holding` / `.swatch` / `.name` / `.sub` / `.value` / `.pct .delta`),
// so a list of events reads as one list with the Holdings below it: a kind-tinted
// swatch, "Bought EXAMPLE-FUND-A" as the name, a muted detail sub-line, the
// amount right-aligned, and (on a sell) the realized gain as the colored delta.

import { PrivateAmount } from "@/components/PrivateAmount";
import type { Transaction } from "@/lib/db/queries/transactions";
import type { TxnKind } from "@/lib/portfolio/lots";

const VERB: Record<TxnKind, string> = {
  buy: "Bought",
  sell: "Sold",
  dividend: "Dividend",
  fee: "Fee",
  split: "Split",
  reinvest: "Reinvested",
  // Both anchors are one user-facing concept, "Balance".
  opening: "Balance",
  snapshot: "Balance",
};

// Short swatch tag (mirrors the holdings swatch's 3-char abbreviation).
const ABBR: Record<TxnKind, string> = {
  buy: "BUY",
  sell: "SELL",
  dividend: "DIV",
  fee: "FEE",
  split: "SPL",
  reinvest: "RE",
  opening: "BAL",
  snapshot: "BAL",
};

// Swatch colour by kind (same token palette the rest of the app uses).
const TONE: Record<TxnKind, string> = {
  buy: "var(--accent)",
  sell: "var(--loss)",
  dividend: "var(--accent-2)",
  reinvest: "var(--accent-2)",
  fee: "var(--muted-2)",
  split: "var(--muted-2)",
  opening: "var(--amber)",
  snapshot: "var(--amber)",
};

function isAnchor(k: TxnKind): boolean {
  return k === "opening" || k === "snapshot";
}

const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
const units = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
const price = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso.slice(0, 10);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface EventLineProps {
  txn: Transaction;
  /** Realized gain for a sell (THB), keyed by the caller from analytics. */
  realized?: number;
  onOpen: () => void;
  /** Hide the ticker in the title (on a position page the fund is implicit). */
  hideTicker?: boolean;
  /** Drop the leading verb for anchors — used under the "Starting balances"
   * header, which already says what these rows are (no "Starting balance ·" on
   * every line). */
  hideVerb?: boolean;
}

// The native holdings-row reset for a <button> acting as a grid row.
const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "32px 1fr auto",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  background: "none",
  border: "none",
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
};

export function EventLine({
  txn,
  realized,
  onOpen,
  hideTicker = false,
  hideVerb = false,
}: EventLineProps) {
  const kind = txn.kind as TxnKind;
  const anchor = isAnchor(kind);
  const verb = VERB[kind] ?? txn.kind;
  // Under the "Starting balances" header the verb is redundant — show just the
  // fund (or, when the fund is implicit too, fall back to the verb).
  const name =
    anchor && hideVerb
      ? hideTicker
        ? verb
        : txn.ticker
      : hideTicker
        ? verb
        : `${verb}${anchor ? " · " : " "}${txn.ticker}`;

  const sub: string[] = [fmtDate(txn.tradeDate)];
  if (anchor) {
    if (txn.units != null) sub.push(`${units(txn.units)} units`);
  } else if (kind === "dividend") {
    sub.push("paid in cash");
  } else if (kind === "fee") {
    sub.push("fee");
  } else if (txn.units != null && txn.pricePerUnit != null) {
    sub.push(`${units(txn.units)} @ ฿${price(txn.pricePerUnit)}`);
  }
  if (txn.source) sub.push(txn.source);

  const costUnknown = anchor && txn.pricePerUnit == null;
  const amount =
    kind === "split" ? "" : `${kind === "fee" ? "−" : ""}${baht(Math.abs(txn.amount))}`;

  return (
    <button type="button" className="holding" style={ROW_STYLE} onClick={onOpen}>
      <div className="swatch" style={{ background: TONE[kind] }}>
        {ABBR[kind]}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="name">{name}</div>
        <div className="sub">
          {sub.join(" · ")}
          {costUnknown && <span style={{ color: "var(--amber)" }}> · cost not recorded</span>}
        </div>
      </div>
      <div className="stack-xs" style={{ alignItems: "flex-end" }}>
        {amount && (
          <div className="value">
            <PrivateAmount>{amount}</PrivateAmount>
          </div>
        )}
        {kind === "sell" && realized != null && (
          <div className={`pct delta ${realized >= 0 ? "up" : "down"}`}>
            {realized >= 0 ? "+" : "−"}
            <PrivateAmount>{baht(Math.abs(realized))}</PrivateAmount>
          </div>
        )}
      </div>
    </button>
  );
}
