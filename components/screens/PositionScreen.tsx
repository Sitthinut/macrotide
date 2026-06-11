"use client";

// PositionScreen — one fund's record: the app-native per-position summary
// (`.hero-block` value + unrealised, a per-fund `.stats-strip`, a value-vs-cost
// chart) sitting directly above the history that produced it (the ticker-scoped
// HistoryList). Reached by tapping a holding; back is a chevron.

import { useState } from "react";
import { FundDetailSheet } from "@/components/FundDetailSheet";
import { HistoryList } from "@/components/history/HistoryList";
import { Icon } from "@/components/Icon";
import { NavChart } from "@/components/InteractiveCharts";
import { Stat } from "@/components/ui/Stat";
import { type SeriesRange, useHoldingSeries, useHoldings } from "@/lib/fetchers/portfolio";
import { useResource } from "@/lib/fetchers/swr";
import { fmtPct } from "@/lib/format";
import type { TransactionAnalytics } from "@/lib/portfolio/transaction-analytics";
import { usePrivacy } from "@/lib/stores/privacy";

type AnalyticsResponse = TransactionAnalytics & { transactionCount: number };

// Range pills for the value chart, mapping a short UI label to a SeriesRange.
const VALUE_RANGES: { lbl: string; range: SeriesRange }[] = [
  { lbl: "1M", range: "1mo" },
  { lbl: "3M", range: "3mo" },
  { lbl: "6M", range: "6mo" },
  { lbl: "1Y", range: "1y" },
  { lbl: "All", range: "max" },
];

const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
const signed = (n: number): string => `${n >= 0 ? "+" : "−"}${baht(Math.abs(n))}`;
const pct = (r: number): string => `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%`;
// Hero rounds units/avg-cost for legibility; full precision lives on History rows.
const num = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface PositionScreenProps {
  ticker: string;
  onBack: () => void;
  onRecord: () => void;
}

export function PositionScreen({ ticker, onBack, onRecord }: PositionScreenProps) {
  const { hidden: valuesHidden } = usePrivacy();
  const [range, setRange] = useState<SeriesRange>("6mo");
  const [fundOpen, setFundOpen] = useState(false);
  const { data: holdings } = useHoldings();
  const { data: a } = useResource<AnalyticsResponse>(
    `/api/transactions/analytics?ticker=${encodeURIComponent(ticker)}`,
  );
  const { data: vs } = useHoldingSeries(ticker, range);

  const holding = (holdings ?? []).find((h) => h.ticker === ticker);
  const pos = a?.positions.find((p) => p.ticker === ticker) ?? a?.positions[0];
  const value = a?.marketValue ?? null;
  const costBasis = pos?.costBasis ?? null;
  const units = pos?.units ?? holding?.units ?? 0;
  const avgCost = pos?.avgCost ?? null;
  const unrealised = value != null && costBasis != null ? value - costBasis : null;
  const unrealisedPct = unrealised != null && costBasis ? unrealised / costBasis : null;
  const navPerUnit = value != null && units > 0 ? value / units : null;
  const irr = a?.irr;

  // Value-over-time (units × NAV × fx) with the cost-basis line beneath it, so
  // the gap reads as unrealized gain. Mapped to NavChart's {d,v} shape.
  const valueData = (vs?.value ?? []).map((p) => ({ d: p.date, v: p.value }));
  const costData = (vs?.costBasis ?? []).map((p) => ({ d: p.date, v: p.value }));

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
        {/* The ticker used to live here, but squeezed between the back arrow and
            the two buttons a long hyphenated code (ONE-ALLCHINA-ASSF) broke onto
            2–3 lines. It now headlines the hero block below at full width; keep a
            spacer so the buttons stay right-aligned. */}
        <div style={{ flex: 1 }} />
        {holding && (
          <button className="btn ghost sm" onClick={() => setFundOpen(true)}>
            Fund details
          </button>
        )}
        <button
          className="btn ghost sm"
          onClick={onRecord}
          style={{ gap: 4, borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          <Icon name="plus" size={12} /> Record
        </button>
      </div>

      <div style={{ padding: "4px 16px 40px", maxWidth: 760, margin: "0 auto" }}>
        {/* The screen content already has 16px side padding; the shared .hero-block
            adds its own 16px, double-indenting the hero past the 4px-margin boxes
            below. Drop the horizontal padding here so the 3 rows line up with them. */}
        <div className="hero-block" style={{ padding: "6px 4px 4px" }}>
          {/* Ticker headlines the position at full width (it no longer fits in the
              topbar), with the fund's full name muted beneath it. */}
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: "var(--ink)",
              lineHeight: 1.2,
            }}
          >
            {ticker}
          </div>
          {holding?.englishName && holding.englishName !== ticker && (
            <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2, marginBottom: 4 }}>
              {holding.englishName}
            </div>
          )}
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
          </div>
        </div>

        {/* Composition — what you hold, near the value. A soft stats-strip (the
            app's boxed pattern for grouped small numbers), visually distinct from
            the bordered performance cards below. units × avg ≈ cost basis and
            units × NAV ≈ value, so the trio is self-checking. Rounded here; full
            precision lives on the History rows. */}
        <div
          className="stats-strip"
          style={{ gridTemplateColumns: "1fr 1fr 1fr", margin: "12px 4px 6px" }}
        >
          <div>
            <div className="lbl">UNITS</div>
            <div className="val">{num(units)}</div>
          </div>
          <div>
            <div className="lbl">AVG COST</div>
            <div className="val">{avgCost != null ? `฿${num(avgCost)}` : "—"}</div>
          </div>
          <div>
            <div className="lbl">NAV</div>
            <div className="val">{navPerUnit != null ? `฿${num(navPerUnit)}` : "—"}</div>
          </div>
        </div>

        <div className="stat-cards-cq">
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
            <Stat label="INVESTED" value={baht(a?.costBasisTotal ?? 0)} caption="cost basis" />
            <Stat
              label="REALIZED"
              value={signed(a?.realizedTotal ?? 0)}
              tone={
                (a?.realizedTotal ?? 0) > 0
                  ? "up"
                  : (a?.realizedTotal ?? 0) < 0
                    ? "down"
                    : "neutral"
              }
              caption="from sells"
            />
            <Stat label="INCOME" value={baht(a?.incomeTotal ?? 0)} caption="dividends" />
          </div>
        </div>

        {valueData.length > 1 && (
          <div style={{ marginTop: 16 }}>
            <div className="section-header" style={{ padding: "0 4px", marginBottom: 6 }}>
              <h3 style={{ fontSize: 13 }}>Value over time</h3>
              <div className="range-pills">
                {VALUE_RANGES.map((r) => (
                  <button
                    key={r.lbl}
                    type="button"
                    data-active={range === r.range}
                    onClick={() => setRange(r.range)}
                  >
                    {r.lbl}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: "0 4px" }}>
              <NavChart
                data={valueData}
                investedData={costData}
                height={150}
                seriesLabel="Value"
                valuesHidden={valuesHidden}
              />
            </div>
            {vs?.estimatedThrough && (
              <p
                className="muted"
                style={{ fontSize: 11, lineHeight: 1.5, padding: "6px 4px 0", margin: 0 }}
              >
                Values up to {vs.estimatedThrough} are estimated from your recorded prices — exact
                fund prices weren’t available that far back.
              </p>
            )}
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

      <FundDetailSheet projId={fundOpen ? ticker : null} onClose={() => setFundOpen(false)} />
    </div>
  );
}
