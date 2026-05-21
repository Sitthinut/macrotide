"use client";

import { useMemo, useState } from "react";
import { MiniBars, MiniLine, ModelDonut, PerfChart } from "@/components/charts";
import { FeedbackRow } from "@/components/FeedbackRow";
import { Icon } from "@/components/Icon";
import {
  useModelPortfoliosView,
  usePortfolioView,
  useSelectedModelId,
} from "@/lib/fetchers/legacy";
import { fmtPct } from "@/lib/format";
import {
  ANALYSIS,
  BENCHMARKS,
  CONTRIB_SERIES,
  DRIFT_SERIES,
  GEO_BREAKDOWN,
  SECTOR_BREAKDOWN,
} from "@/lib/mock/data";
import type { AssetClass, BenchmarkKey, Holding, Portfolio } from "@/lib/mock/types";

const SEV_COLOR: Record<string, string> = {
  good: "var(--gain)",
  low: "var(--muted)",
  medium: "var(--amber)",
  high: "var(--loss)",
};
const SEV_LABEL: Record<string, string> = {
  good: "Strength",
  low: "Note",
  medium: "Watch",
  high: "Action",
};

const SWATCH_ABBR: Record<string, string> = {
  "SCBS&P500": "S&P",
  "K-USA-A": "USA",
  "K-WORLDX": "WLD",
  "KFGBRAND-A": "KFG",
  ABSM: "ABS",
  "K-FIXED": "FIX",
  "KKP-GINFRA": "INF",
  KFCASH: "$",
  "SCBSFF-SSF": "SFF",
  "K-USXNDQ-SSF": "NDQ",
  "K-WPSPX-SSF": "WPX",
  TISCOEM: "EM",
};

function swatchAbbr(t: string) {
  return SWATCH_ABBR[t] || t.slice(0, 3);
}

interface ViewPortfolio {
  name: string;
  notes: string | null;
  type: string;
  holdings: Holding[];
  series: { d: string; v: number }[];
  totalValue: number;
  initialInvestment: number;
  perfPct: Portfolio["perfPct"];
  asOf: string;
}

export interface PortfolioScreenProps {
  onOpenSettings: () => void;
  onOpenModels: () => void;
  onOpenChat: () => void;
  onOpenImport: () => void;
}

export function PortfolioScreen({
  onOpenSettings,
  onOpenModels,
  onOpenImport,
}: PortfolioScreenProps) {
  const [activePfId, setActivePfId] = useState<string>("all");
  const [range, setRange] = useState<string>("6M");
  const [filter, setFilter] = useState<AssetClass | "all">("all");
  const [benchmark, setBenchmark] = useState<"none" | BenchmarkKey>("none");
  const [feedback, setFeedback] = useState<Record<string, "up" | "down" | null>>({});

  const { portfolios, aggregate, isLoading } = usePortfolioView();
  const { models } = useModelPortfoliosView();
  const planSelectedModelId = useSelectedModelId();

  const activePf = useMemo<Portfolio | null>(() => {
    if (activePfId === "all" || !portfolios) return null;
    return portfolios.find((p) => p.id === activePfId) ?? null;
  }, [activePfId, portfolios]);

  const view: ViewPortfolio | null = useMemo(() => {
    if (!aggregate) return null;
    if (!activePf) {
      return {
        name: "All portfolios",
        notes: null,
        type: "free",
        holdings: aggregate.holdings,
        series: aggregate.series,
        totalValue: aggregate.totalValue,
        initialInvestment: aggregate.initialInvestment,
        perfPct: aggregate.perfPct,
        asOf: aggregate.asOf,
      };
    }
    return {
      name: activePf.name,
      notes: activePf.notes,
      type: activePf.type,
      holdings: activePf.holdings,
      series: activePf.series,
      totalValue: activePf.totalValue,
      initialInvestment: activePf.initialInvestment,
      perfPct: activePf.perfPct,
      asOf: activePf.asOf,
    };
  }, [activePf, aggregate]);

  const filtered = useMemo(() => {
    if (!view) return [] as Holding[];
    if (filter === "all") return view.holdings;
    return view.holdings.filter((h) => h.class === filter);
  }, [view, filter]);

  const byClass = useMemo(() => {
    if (!view || view.totalValue <= 0) {
      return { equity: 0, bond: 0, alternative: 0, cash: 0 };
    }
    const groups: Record<string, number> = {};
    view.holdings.forEach((h) => {
      groups[h.class] = (groups[h.class] || 0) + h.value;
    });
    const total = view.totalValue;
    return {
      equity: ((groups.equity || 0) / total) * 100,
      bond: ((groups.bond || 0) / total) * 100,
      alternative: ((groups.alternative || 0) / total) * 100,
      cash: ((groups.cash || 0) / total) * 100,
    };
  }, [view]);

  if (isLoading || !view || !portfolios) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark"></span>
            <span>Tidemark</span>
          </div>
        </div>
        <div style={{ padding: 24, color: "var(--muted)" }}>Loading…</div>
      </div>
    );
  }

  if (portfolios.length === 0) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="brand">
            <span className="brand-mark"></span>
            <span>Tidemark</span>
          </div>
          <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
            <Icon name="settings" size={13} />
          </button>
        </div>
        <div style={{ padding: "24px 20px" }}>
          <div className="card" style={{ padding: "36px 22px", textAlign: "center" }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>○</div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                marginBottom: 8,
              }}
            >
              No buckets yet
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.5,
                marginBottom: 22,
                maxWidth: 320,
                margin: "0 auto 22px",
              }}
            >
              A bucket holds a set of fund positions. Most people start with one "Core" bucket for
              long-term holdings, plus optional buckets for tax-advantaged accounts.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn primary" onClick={onOpenImport}>
                <Icon name="plus" size={13} /> Add your first holdings
              </button>
              <button className="btn ghost" onClick={onOpenModels}>
                Browse model portfolios
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pnl = view.totalValue - view.initialInvestment;
  const pnlPct = view.initialInvestment > 0 ? (pnl / view.initialInvestment) * 100 : 0;

  const minV = view.series.length ? Math.min(...view.series.map((s) => s.v)) : 0;
  const maxV = view.series.length ? Math.max(...view.series.map((s) => s.v)) : 0;
  const fmtK = (n: number) => `฿${Math.round(n / 1000).toLocaleString("en-US")}k`;

  const targetModel = activePf?.targetModelId
    ? models?.find((m) => m.id === activePf.targetModelId)
    : models?.find((m) => m.id === planSelectedModelId);

  const showAnalysis = activePfId === "all" || activePf?.targetModelId;

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark"></span>
          <span>Tidemark</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            className="icon-btn"
            aria-label="Add holdings"
            onClick={onOpenImport}
            style={{ borderColor: "var(--accent)" }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className="icon-btn" aria-label="Settings" onClick={onOpenSettings}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"></path>
            </svg>
          </button>
        </div>
      </div>

      <div className="portfolio-switch">
        <button data-active={activePfId === "all"} onClick={() => setActivePfId("all")}>
          ☰ All
          <span className="pf-sub">{portfolios.length} BUCKETS</span>
        </button>
        {portfolios.map((p) => (
          <button key={p.id} data-active={activePfId === p.id} onClick={() => setActivePfId(p.id)}>
            <span className="pf-icon">{p.icon}</span> {p.name}
            <span className="pf-sub">{p.typeLabel.toUpperCase()}</span>
          </button>
        ))}
        <button
          style={{
            background: "transparent",
            border: "1px dashed var(--line)",
            color: "var(--muted)",
          }}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("ai-prompt", {
                detail:
                  "Help me set up a new portfolio bucket. What types make sense and what should I separate?",
              }),
            )
          }
        >
          <Icon name="plus" size={12} /> New
        </button>
      </div>

      {activePf?.notes && <div className="pf-notes">{activePf.notes}</div>}

      <div className="hero-block">
        <div className="hero-label">
          {activePfId === "all" ? "Combined balance" : view.name} · {view.asOf.split(",")[0]}
        </div>
        <div className="hero-value">
          ฿{Math.floor(view.totalValue).toLocaleString("en-US")}
          <span className="cents">.{view.totalValue.toFixed(2).split(".")[1] || "00"}</span>
        </div>
        <div className="hero-sub">
          <span className={`delta-pill${pnl < 0 ? " down" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d={pnl >= 0 ? "M6 2L10 7H2L6 2Z" : "M6 10L2 5H10L6 10Z"}
                fill="currentColor"
              ></path>
            </svg>
            ฿{Math.abs(Math.round(pnl)).toLocaleString("en-US")} · {fmtPct(pnlPct)}
          </span>
          <span className="muted">all-time</span>
        </div>
      </div>

      <div className="stats-strip">
        {(
          [
            {
              lbl: "TODAY",
              val: view.holdings.reduce((s, h) => s + h.d1 * h.value, 0) / view.totalValue,
            },
            { lbl: "7D", val: view.perfPct.d7 },
            { lbl: "30D", val: view.perfPct.d30 },
            { lbl: "YTD", val: view.perfPct.ytd },
          ] as { lbl: string; val: number }[]
        ).map((s) => (
          <div key={s.lbl}>
            <div className="lbl">{s.lbl}</div>
            <div className="val" style={{ color: s.val >= 0 ? "var(--gain)" : "var(--loss)" }}>
              {fmtPct(s.val, s.val < 1 && s.val > -1 ? 2 : 1)}
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="range-pills">
            {["1M", "3M", "6M", "1Y", "All"].map((r) => (
              <button key={r} data-active={range === r} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <span className="num" style={{ fontSize: 11, color: "var(--muted)" }}>
            {fmtK(minV)} → {fmtK(maxV)}
          </span>
        </div>
        <PerfChart
          data={view.series}
          benchmarkData={benchmark !== "none" ? BENCHMARKS[benchmark] : null}
          benchmarkLabel={
            { sp500: "S&P 500", set: "SET", m60_40: "60/40", none: null }[benchmark] as
              | string
              | null
          }
          height={130}
          accent="var(--accent)"
        />
        <div className="filter-chips" style={{ padding: "8px 0 0", marginLeft: -8 }}>
          <span
            style={{
              fontSize: 11,
              color: "var(--muted)",
              padding: "5px 4px 0",
              letterSpacing: "0.04em",
              fontFamily: "var(--font-mono)",
            }}
          >
            VS
          </span>
          {(
            [
              { v: "none", l: "None" },
              { v: "sp500", l: "S&P 500" },
              { v: "set", l: "SET" },
              { v: "m60_40", l: "60/40" },
            ] as { v: "none" | BenchmarkKey; l: string }[]
          ).map((b) => (
            <span
              key={b.v}
              className="chip"
              data-active={benchmark === b.v}
              onClick={() => setBenchmark(b.v)}
            >
              {b.l}
            </span>
          ))}
        </div>
      </div>

      {activePfId === "all" && (
        <div style={{ marginBottom: 14 }}>
          <div className="section-header" style={{ padding: "0 20px" }}>
            <h3>Charts</h3>
            <span className="link">Swipe →</span>
          </div>
          <div className="chart-row">
            <div className="chart-card">
              <div className="h">DRIFT FROM TARGET · 6M</div>
              <div className="v" style={{ color: "var(--amber)" }}>
                +6.2pp
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                Trending up — time to consider a rebalance
              </div>
              <MiniLine data={DRIFT_SERIES} accent="var(--amber)" height={48} />
            </div>

            <div className="chart-card">
              <div className="h">GEOGRAPHY</div>
              <div className="stacked-bar">
                {GEO_BREAKDOWN.map((g) => (
                  <span key={g.label} style={{ width: `${g.pct}%`, background: g.color }}></span>
                ))}
              </div>
              <div className="stack-sm" style={{ fontSize: 11 }}>
                {GEO_BREAKDOWN.map((g) => (
                  <div key={g.label} className="row between" style={{ gap: 6, padding: "2px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: g.color,
                        }}
                      ></span>
                      <span>{g.label}</span>
                    </span>
                    <span className="num" style={{ color: "var(--muted)" }}>
                      {g.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-card">
              <div className="h">SECTOR · ROLL-UP</div>
              <div className="stacked-bar">
                {SECTOR_BREAKDOWN.map((g) => (
                  <span key={g.label} style={{ width: `${g.pct}%`, background: g.color }}></span>
                ))}
              </div>
              <div className="stack-sm" style={{ fontSize: 11 }}>
                {SECTOR_BREAKDOWN.slice(0, 5).map((g) => (
                  <div key={g.label} className="row between" style={{ gap: 6, padding: "2px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: g.color,
                        }}
                      ></span>
                      <span>{g.label}</span>
                    </span>
                    <span className="num" style={{ color: "var(--muted)" }}>
                      {g.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 10, color: "var(--muted)", paddingTop: 4 }}>
                  + 3 more sectors
                </div>
              </div>
            </div>

            <div className="chart-card">
              <div className="h">CONTRIBUTIONS · 6M</div>
              <div className="v">
                ฿{Math.round(CONTRIB_SERIES.reduce((s, c) => s + c.v, 0) / 1000)}k
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                Total added · {CONTRIB_SERIES.filter((c) => c.v > 0).length} deposits
              </div>
              <MiniBars data={CONTRIB_SERIES} accent="var(--accent)" height={48} />
            </div>
          </div>
        </div>
      )}

      {showAnalysis && targetModel && (
        <div className="section" style={{ marginTop: 8 }}>
          <div className="section-header" style={{ padding: "0 4px" }}>
            <h3>Plan & health</h3>
            <span className="link" onClick={onOpenModels} style={{ cursor: "pointer" }}>
              Target: {targetModel.name} →
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 6,
            }}
          >
            {(
              [
                { key: "diversification", lbl: "DIVERSIFY", color: "var(--accent)" },
                { key: "fees", lbl: "FEES", color: "var(--gain)" },
                { key: "alignment", lbl: "ON-TARGET", color: "var(--amber)" },
                { key: "risk", lbl: "RISK FIT", color: "var(--info)" },
              ] as {
                key: keyof typeof ANALYSIS.scores;
                lbl: string;
                color: string;
              }[]
            ).map((s) => (
              <div
                key={s.key}
                className="card-soft"
                style={{ padding: "8px 8px", textAlign: "center" }}
              >
                <div className="num" style={{ fontSize: 18, fontWeight: 500, color: s.color }}>
                  {ANALYSIS.scores[s.key]}
                </div>
                <div
                  style={{
                    fontSize: 8.5,
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted)",
                    letterSpacing: "0.04em",
                    marginTop: 2,
                  }}
                >
                  {s.lbl}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 10 }}>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--accent-ink)",
                letterSpacing: "0.04em",
                marginBottom: 4,
              }}
            >
              ● TOP THING TO KNOW
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 6,
                letterSpacing: "-0.01em",
              }}
            >
              {ANALYSIS.insights[0].title}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
                marginBottom: 10,
              }}
            >
              {ANALYSIS.insights[0].body}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm primary"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("ai-prompt", {
                      detail: `Help me understand: ${ANALYSIS.insights[0].title}`,
                    }),
                  );
                }}
              >
                <Icon name="chat" size={12} /> Discuss
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            {ANALYSIS.insights.slice(1).map((ins, i, arr) => (
              <div
                key={i}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("ai-prompt", { detail: `Explain: ${ins.title}` }),
                  )
                }
                style={{
                  padding: "10px 12px",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--line-soft)" : "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 50,
                    background: SEV_COLOR[ins.severity],
                    flexShrink: 0,
                  }}
                ></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {ins.title}
                  </div>
                </div>
                <span
                  className="tag"
                  style={{
                    background: "transparent",
                    borderColor: SEV_COLOR[ins.severity],
                    color: SEV_COLOR[ins.severity],
                    fontSize: 9,
                  }}
                >
                  {SEV_LABEL[ins.severity]}
                </span>
              </div>
            ))}
          </div>

          <div
            className="card"
            style={{
              marginTop: 12,
              background: "var(--accent-soft)",
              borderColor: "transparent",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--accent-ink)",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              ● SUGGESTED ACTION
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 6,
                color: "var(--accent-ink)",
                letterSpacing: "-0.01em",
              }}
            >
              Rebalance toward {targetModel.name}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--accent-ink)",
                lineHeight: 1.45,
                opacity: 0.85,
                marginBottom: 10,
              }}
            >
              5 small moves to bring you back on target.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm primary"
                style={{ flex: 1 }}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("ai-prompt", {
                      detail: `Show me the rebalance plan for ${targetModel.name} and explain each move.`,
                    }),
                  );
                }}
              >
                Read more <Icon name="arrowRight" size={12} />
              </button>
            </div>

            <FeedbackRow
              topic="rebalance"
              label="HELPFUL?"
              value={feedback.rebalance ?? null}
              onChange={(rating) => setFeedback({ ...feedback, rebalance: rating })}
            />
          </div>
        </div>
      )}

      <div className="section-header" style={{ padding: "0 20px", marginBottom: 4, marginTop: 18 }}>
        <h3>Holdings</h3>
        <span className="link">{view.holdings.length} funds</span>
      </div>
      <div className="filter-chips">
        <span className="chip" data-active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </span>
        <span
          className="chip"
          data-active={filter === "equity"}
          onClick={() => setFilter("equity")}
        >
          Stocks {byClass.equity.toFixed(0)}%
        </span>
        <span className="chip" data-active={filter === "bond"} onClick={() => setFilter("bond")}>
          Bonds {byClass.bond.toFixed(0)}%
        </span>
        {byClass.alternative > 0.5 && (
          <span
            className="chip"
            data-active={filter === "alternative"}
            onClick={() => setFilter("alternative")}
          >
            Alt {byClass.alternative.toFixed(0)}%
          </span>
        )}
        {byClass.cash > 0.5 && (
          <span className="chip" data-active={filter === "cash"} onClick={() => setFilter("cash")}>
            Cash {byClass.cash.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="holdings-list">
        {filtered.map((h) => {
          const pct = (h.value / view.totalValue) * 100;
          return (
            <div key={h.ticker + (h.source || "")} className="holding">
              <div className="swatch" style={{ background: h.color }}>
                {swatchAbbr(h.ticker)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="name">{h.ticker}</div>
                <div className="sub">
                  {h.category} · {pct.toFixed(1)}%
                </div>
              </div>
              <div className="stack-xs" style={{ alignItems: "flex-end" }}>
                <div className="value">฿{Math.round(h.value).toLocaleString("en-US")}</div>
                <div className={`pct ${h.d1 >= 0 ? "delta up" : "delta down"}`}>
                  {fmtPct(h.d1, 2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {activePfId === "all" && targetModel && (
        <div className="section" style={{ marginTop: 14 }}>
          <div className="card" style={{ padding: 14, cursor: "pointer" }} onClick={onOpenModels}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <ModelDonut mix={targetModel.mix} size={44} thickness={7} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted)",
                    letterSpacing: "0.04em",
                    marginBottom: 2,
                  }}
                >
                  YOUR TARGET
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {targetModel.name}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  Browse {Math.max(0, (models?.length ?? 0) - 1)} other index strategies →
                </div>
              </div>
              <Icon name="arrowRight" size={14} />
            </div>
          </div>
        </div>
      )}

      <div className="section" style={{ marginTop: 4 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.5,
            padding: "0 4px",
            fontFamily: "var(--font-mono)",
          }}
        >
          ⓘ Educational analysis only. Not personalised financial advice.
        </div>
      </div>
    </div>
  );
}
