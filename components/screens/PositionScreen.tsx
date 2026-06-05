"use client";

// PositionScreen — one fund's record: the app-native per-position summary
// (`.hero-block` value + unrealised, a per-fund `.stats-strip`, a cost-basis
// sparkline) sitting directly above the history that produced it (the
// ticker-scoped HistoryList). Reached by tapping a holding; back is a chevron.

import { Sparkline } from "@/components/charts";
import { HistoryList } from "@/components/history/HistoryList";
import { Icon } from "@/components/Icon";
import { Stat } from "@/components/ui/Stat";
import { useHoldings } from "@/lib/fetchers/portfolio";
import { useResource } from "@/lib/fetchers/swr";
import { fmtPct } from "@/lib/format";
import type { TransactionAnalytics } from "@/lib/portfolio/transaction-analytics";

type AnalyticsResponse = TransactionAnalytics & { transactionCount: number };

const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
const signed = (n: number): string => `${n >= 0 ? "+" : "−"}${baht(Math.abs(n))}`;
const pct = (r: number): string => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export interface PositionScreenProps {
  ticker: string;
  onBack: () => void;
  onRecord: () => void;
}

export function PositionScreen({ ticker, onBack, onRecord }: PositionScreenProps) {
  const { data: holdings } = useHoldings();
  const { data: a } = useResource<AnalyticsResponse>(
    `/api/transactions/analytics?ticker=${encodeURIComponent(ticker)}`,
  );

  const holding = (holdings ?? []).find((h) => h.ticker === ticker);
  const pos = a?.positions.find((p) => p.ticker === ticker) ?? a?.positions[0];
  const value = a?.marketValue ?? null;
  const costBasis = pos?.costBasis ?? null;
  const units = pos?.units ?? holding?.units ?? 0;
  const avgCost = pos?.avgCost ?? null;
  const unrealised = value != null && costBasis != null ? value - costBasis : null;
  const unrealisedPct = unrealised != null && costBasis ? unrealised / costBasis : null;
  const basisSeries = (a?.basisTimeline ?? []).map((p) => p.costBasis);
  const irr = a?.irr;

  return (
    <div className="screen">
      <div className="topbar">
        <button
          className="icon-btn"
          onClick={onBack}
          aria-label="Back to portfolio"
          style={{ marginRight: 8 }}
        >
          <svg
            width="16"
            height="16"
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
          <span>{ticker}</span>
        </div>
        <button
          className="btn ghost sm"
          onClick={onRecord}
          style={{ gap: 4, borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          <Icon name="plus" size={12} /> Record
        </button>
      </div>

      <div style={{ padding: "4px 16px 40px", maxWidth: 760, margin: "0 auto" }}>
        <div className="hero-block">
          <div className="hero-label">{holding?.englishName || ticker}</div>
          <div className="hero-value">
            {value != null ? (
              <>
                ฿{Math.floor(value).toLocaleString("en-US")}
                <span className="cents">.{value.toFixed(2).split(".")[1] || "00"}</span>
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="hero-sub">
            {unrealised != null ? (
              <span className={`delta-pill${unrealised < 0 ? " down" : ""}`}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path
                    d={unrealised >= 0 ? "M6 2L10 7H2L6 2Z" : "M6 10L2 5H10L6 10Z"}
                    fill="currentColor"
                  />
                </svg>
                ฿{Math.abs(Math.round(unrealised)).toLocaleString("en-US")}
                {unrealisedPct != null ? ` · ${fmtPct(unrealisedPct)}` : ""} unrealised
              </span>
            ) : value == null ? (
              <span className="muted">price unavailable</span>
            ) : null}
            <span className="muted">
              {num(units)} units
              {avgCost != null ? ` · avg ฿${num(avgCost)}` : " · cost not recorded"}
            </span>
          </div>
        </div>

        <div className="stat-cards">
          <Stat
            label="RETURN"
            value={irr != null ? pct(irr) : "—"}
            tone={irr == null ? "neutral" : irr >= 0 ? "up" : "down"}
            caption={
              irr != null
                ? "money-weighted"
                : (a?.irrUnavailable ?? "Return appears after about a month of activity.")
            }
          />
          <Stat
            label="INVESTED"
            value={baht(a?.contributions.totalInvested ?? 0)}
            caption="contributions"
          />
          <Stat
            label="REALIZED"
            value={signed(a?.realizedTotal ?? 0)}
            tone={
              (a?.realizedTotal ?? 0) > 0 ? "up" : (a?.realizedTotal ?? 0) < 0 ? "down" : "neutral"
            }
            caption="from sells"
          />
          <Stat label="INCOME" value={baht(a?.incomeTotal ?? 0)} caption="dividends" />
        </div>

        {basisSeries.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <div className="section-header" style={{ padding: "0 4px", marginBottom: 6 }}>
              <h3 style={{ fontSize: 13 }}>Cost basis over time</h3>
              <span className="num" style={{ fontSize: 11, color: "var(--muted)" }}>
                what you’ve put in, net of sells
              </span>
            </div>
            <div style={{ padding: "0 4px" }}>
              <Sparkline data={basisSeries} color="var(--accent)" width={300} height={60} />
            </div>
          </div>
        )}

        <div
          className="section-header"
          style={{ padding: "0 4px", marginTop: 18, marginBottom: 4 }}
        >
          <h3 style={{ fontSize: 13 }}>How you got here</h3>
        </div>
        <HistoryList ticker={ticker} showRecap={false} onAddEntry={onRecord} />
      </div>
    </div>
  );
}
