"use client";

// Funded-from-cash nudge (#232) — shown on History after a save whose buy a tracked
// cash account could have covered. Under the no-deduct model a buy never debits cash,
// so paying from a tracked account would otherwise double-count as new money; one tap
// records the matching withdrawal and buy(+) / withdraw(−) net to an internal
// transfer. Dismissible and session-only: ignoring it stays correct (the next Set
// balance reconciles to the same place) — this is convenience, not correctness.

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { invalidate } from "@/lib/fetchers/swr";
import { fmtTHBClean } from "@/lib/format";
import type { CashNudge } from "@/lib/portfolio/settlement-cash";

export interface CashNudgeCardProps {
  bucketId: string;
  nudge: CashNudge;
  /** Called when the nudge is spent — recorded or dismissed. */
  onResolve: () => void;
}

export function CashNudgeCard({ bucketId, nudge, onResolve }: CashNudgeCardProps) {
  const [account, setAccount] = useState(nudge.accounts[0]?.ticker ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const record = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bucketId,
          transactions: [
            {
              tradeDate: nudge.tradeDate,
              kind: "withdraw",
              ticker: account,
              englishName: account,
              // Cash rows carry the native figure as units and the ฿ amount; the
              // candidates are THB-only, so the two are the same number here.
              units: nudge.shortfall,
              amount: nudge.shortfall,
              quoteSource: "cash",
              tradeCurrency: "THB",
              fxToThb: 1,
              note: `Funded the ${nudge.buyTicker} buy`,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      invalidate(/^\/api\/transactions/);
      invalidate(/^\/api\/holdings/);
      invalidate(/^\/api\/portfolios/);
      onResolve();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <div className="import-cta" role="status">
      <div className="import-cta__main" style={{ cursor: "default" }}>
        <Icon name="info" size={14} />
        <span className="import-cta__text">
          <strong>Funded from cash?</strong>
          <span>
            {error
              ? "Couldn't record the withdrawal. Try again."
              : `Record a ${fmtTHBClean(nudge.shortfall)} withdrawal so the ${nudge.buyTicker} ` +
                "buy isn't counted as new money."}
          </span>
        </span>
      </div>
      {nudge.accounts.length > 1 ? (
        <select
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          aria-label="Cash account to withdraw from"
          className="mt-select"
          disabled={busy}
        >
          {nudge.accounts.map((a) => (
            <option key={a.ticker} value={a.ticker}>
              {a.ticker}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" className="btn primary sm" onClick={record} disabled={busy || !account}>
        {busy
          ? "Recording…"
          : nudge.accounts.length > 1
            ? "Record withdrawal"
            : `Withdraw from ${account}`}
      </button>
      <button
        type="button"
        className="import-cta__x"
        onClick={onResolve}
        aria-label="Dismiss"
        disabled={busy}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
