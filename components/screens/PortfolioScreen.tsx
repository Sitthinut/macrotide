"use client";

import { useEffect, useMemo, useState } from "react";
import { ModelDonut, ScoreCircle } from "@/components/charts";
import { FeedbackRow } from "@/components/FeedbackRow";
import { type HoldingFormValues, HoldingSheet } from "@/components/HoldingSheet";
import { Icon } from "@/components/Icon";
import { AllocationDonut, DriftBars, NavChart } from "@/components/InteractiveCharts";
import {
  useModelPortfoliosView,
  usePortfolioView,
  useSelectedModelId,
} from "@/lib/fetchers/legacy";
import { type SeriesRange, useBenchmarkSeries } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { fmtPct } from "@/lib/format";
import { BENCHMARK_OPTIONS } from "@/lib/market/benchmark-options";
import { DEFAULT_QUOTE_SOURCE, isQuoteSource } from "@/lib/market/sources";
import { formatSeriesDate } from "@/lib/portfolio/adapter";
import { computeHealth, rebalanceHint, summarizeHealth } from "@/lib/portfolio/health";
import { scorePortfolio } from "@/lib/portfolio/score";
import type { AssetClass, Holding, Portfolio } from "@/lib/static/types";

function holdingToFormValues(h: Holding, fallbackBucketId: string): HoldingFormValues {
  return {
    bucketId: h.bucketId ?? fallbackBucketId,
    ticker: h.ticker,
    thaiName: h.thai ?? "",
    englishName: h.name,
    category: h.category,
    assetClass: h.class,
    region: h.region,
    units: h.units,
    avgCost: h.units > 0 ? h.cost / h.units : 0,
    ter: h.ter,
    source: h.source,
    quoteSource: isQuoteSource(h.quoteSource) ? h.quoteSource : DEFAULT_QUOTE_SOURCE,
    color: h.color,
  };
}

const SWATCH_ABBR: Record<string, string> = {
  "SCBS&P500": "S&P",
  "K-USA-A(A)": "USA",
  "K-WORLDX": "WLD",
  "K-FIXED-A": "FIX",
  "KFGBRAND-A": "KFG",
  "KFGTECH-A": "TEC",
  "KFCASH-A": "$",
  "K-INDIA-A(A)": "IND",
  ABSM: "ABS",
  "K-USARMF": "USR",
  "K-WORLDXRMF": "WLR",
  "K-GINCOMERMF": "INC",
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
  /** Show the top-right kebab that opens the account menu (mobile only). */
  showMenu?: boolean;
}

export function PortfolioScreen({
  onOpenSettings,
  onOpenModels,
  onOpenImport,
  showMenu = true,
}: PortfolioScreenProps) {
  const [activePfId, setActivePfId] = useState<string>("all");
  const [range, setRange] = useState<string>("6M");
  const [filter, setFilter] = useState<AssetClass | "all">("all");
  const [benchmark, setBenchmark] = useState<string>("none");
  const [feedback, setFeedback] = useState<Record<string, "up" | "down" | null>>({});
  const [holdingSheet, setHoldingSheet] = useState<Holding | null>(null);

  // Broadcast active portfolio id so the right-rail PortfoliosPanel can
  // highlight the matching row without lifting state up to App.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("portfolio-active-changed", { detail: activePfId }));
  }, [activePfId]);

  // Listen for cross-component navigation events.
  useEffect(() => {
    const onActivate = (e: Event) => setActivePfId((e as CustomEvent<string>).detail);
    const onSyncRequest = () => {
      window.dispatchEvent(new CustomEvent("portfolio-active-changed", { detail: activePfId }));
    };
    window.addEventListener("activate-portfolio", onActivate);
    window.addEventListener("portfolio-active-request", onSyncRequest);
    return () => {
      window.removeEventListener("activate-portfolio", onActivate);
      window.removeEventListener("portfolio-active-request", onSyncRequest);
    };
  }, [activePfId]);

  // Helpers for emitting modal events to App.
  const openNewPortfolio = () => window.dispatchEvent(new CustomEvent("new-portfolio"));
  const openEditPortfolio = (id: string) =>
    window.dispatchEvent(new CustomEvent("edit-portfolio", { detail: id }));

  async function saveHolding(values: HoldingFormValues) {
    const id = holdingSheet?.id;
    if (id === undefined) return;
    const payload = {
      bucketId: values.bucketId,
      ticker: values.ticker,
      thaiName: values.thaiName || null,
      englishName: values.englishName,
      category: values.category || null,
      assetClass: values.assetClass,
      region: values.region || null,
      units: values.units,
      avgCost: values.avgCost,
      ter: values.ter,
      color: values.color,
      source: values.source || null,
      quoteSource: values.quoteSource,
    };
    const res = await fetch(`/api/holdings/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Update failed (${res.status})`);
    invalidate(/^\/api\/holdings/);
  }

  async function deleteHolding(id: number) {
    const res = await fetch(`/api/holdings/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Delete failed (${res.status})`);
    invalidate(/^\/api\/holdings/);
  }

  const seriesRange: SeriesRange = useMemo(() => {
    switch (range) {
      case "1M":
        return "1mo";
      case "3M":
        return "3mo";
      case "1Y":
        return "1y";
      case "All":
        return "max";
      default:
        return "6mo";
    }
  }, [range]);

  const { portfolios, aggregate, isLoading } = usePortfolioView(seriesRange);
  const { models } = useModelPortfoliosView();
  const planSelectedModelId = useSelectedModelId();

  // Real benchmark overlay: fetch the selected index over the SAME range as the
  // chart, then map it onto the portfolio's date-label space so NavChart can
  // align + rebase it. Empty series (upstream cold / backing off) → no overlay.
  const { data: benchmarkResp } = useBenchmarkSeries(
    benchmark === "none" ? null : benchmark,
    seriesRange,
  );
  const benchmarkSeries = useMemo(
    () =>
      benchmarkResp && benchmarkResp.series.length > 0
        ? benchmarkResp.series.map((p) => ({ d: formatSeriesDate(p.date), v: p.value }))
        : null,
    [benchmarkResp],
  );

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

  // Target model for plan/health drift — resolve before the early returns so
  // the health memo below can depend on it (hooks must run unconditionally).
  const targetModel = useMemo(() => {
    if (!models) return null;
    if (activePf?.targetModelId) return models.find((m) => m.id === activePf.targetModelId) ?? null;
    return models.find((m) => m.id === planSelectedModelId) ?? null;
  }, [models, activePf, planSelectedModelId]);

  // Real, computed health signals — drift vs target, blended fee, concentration,
  // cash drag. No mock fixtures.
  const health = useMemo(
    () =>
      view
        ? computeHealth(
            view.holdings,
            view.totalValue,
            targetModel?.mix ?? null,
            targetModel?.ter ?? null,
          )
        : null,
    [view, targetModel],
  );

  // Composite 0-100 score derived transparently from health signals.
  // Each component rule is documented in lib/portfolio/score.ts.
  const score = useMemo(
    () => (health ? scorePortfolio(health, targetModel !== null) : null),
    [health, targetModel],
  );

  if (isLoading || !view || !portfolios) {
    return (
      <div className="screen">
        <div className="topbar">
          <div className="brand" style={{ flex: 1 }}>
            <span className="brand-mark"></span>
            <span>Macrotide</span>
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
          <div className="brand" style={{ flex: 1 }}>
            <span className="brand-mark"></span>
            <span>Macrotide</span>
          </div>
          {showMenu && (
            <button className="icon-btn" aria-label="More" onClick={onOpenSettings}>
              <Icon name="ellipsis-vertical" size={13} />
            </button>
          )}
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
              No portfolios yet
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
              A portfolio holds a set of holdings — funds, stocks, ETFs, or cash. Most people start
              with one "Core" portfolio for long-term holdings, plus optional ones for
              tax-advantaged accounts.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn primary" onClick={openNewPortfolio}>
                <Icon name="plus" size={13} /> Create your first portfolio
              </button>
              <button className="btn ghost" onClick={onOpenImport}>
                Import existing holdings
              </button>
              <button className="btn ghost" onClick={onOpenModels}>
                Browse templates
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

  const showAnalysis = activePfId === "all" || activePf?.targetModelId;

  // `health` is derived from `view`, which is guaranteed non-null past the
  // early returns above — this guard just narrows the type for TS.
  if (!health) return null;

  const hasHoldings = view.holdings.length > 0;
  const headline = summarizeHealth(health, targetModel?.name ?? null);
  const { trim, add } = rebalanceHint(health.drift);
  const HEADLINE_TONE: Record<string, string> = {
    good: "var(--gain)",
    watch: "var(--amber)",
    action: "var(--loss)",
  };

  // Score display helpers
  const scoreColor = score
    ? score.total >= 80
      ? "var(--gain)"
      : score.total >= 60
        ? "var(--amber)"
        : "var(--loss)"
    : "var(--muted)";
  const scoreLabel = score
    ? score.total >= 80
      ? "Great shape"
      : score.total >= 60
        ? "Doing well"
        : score.total >= 40
          ? "Needs attention"
          : "Action needed"
    : "";
  const COMPONENT_ICONS: Record<string, string> = {
    drift: "◎",
    fees: "€",
    concentration: "◈",
    cash: "⊙",
  };

  return (
    <div className="screen">
      <div className="topbar">
        <div className="brand" style={{ flex: 1 }}>
          <span className="brand-mark"></span>
          <span>Macrotide</span>
        </div>
        {showMenu && (
          <button className="icon-btn" aria-label="More" onClick={onOpenSettings}>
            <Icon name="ellipsis-vertical" size={13} />
          </button>
        )}
      </div>

      <div className="portfolio-switch">
        <button data-active={activePfId === "all"} onClick={() => setActivePfId("all")}>
          ☰ All
          <span className="pf-sub">{portfolios.length} PORTFOLIOS</span>
        </button>
        {portfolios.map((p) => (
          <button key={p.id} data-active={activePfId === p.id} onClick={() => setActivePfId(p.id)}>
            <span className="pf-icon">
              <Icon name={p.icon || "wallet"} size={12} />
            </span>{" "}
            {p.name}
          </button>
        ))}
        <button
          style={{
            background: "transparent",
            border: "1px dashed var(--line)",
            color: "var(--muted)",
          }}
          onClick={openNewPortfolio}
        >
          <Icon name="plus" size={12} /> New
        </button>
      </div>

      {activePf?.notes && <div className="pf-notes">{activePf.notes}</div>}

      <div className="hero-block">
        <div className="hero-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span>
            {activePfId === "all" ? "Combined balance" : view.name} · {view.asOf.split(",")[0]}
          </span>
          {activePf && (
            <button
              type="button"
              className="hero-edit-btn"
              onClick={() => openEditPortfolio(activePf.id)}
              aria-label={`Edit ${activePf.name}`}
              title={`Edit ${activePf.name}`}
            >
              <Icon name="pencil" size={11} />
            </button>
          )}
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
        <NavChart
          data={view.series}
          benchmarkData={benchmark !== "none" ? benchmarkSeries : null}
          benchmarkLabel={benchmark !== "none" ? (benchmarkResp?.label ?? null) : null}
          height={130}
          accent="var(--accent)"
          emptyHint={
            view.holdings.length === 0
              ? "Add holdings to see how this portfolio tracks over time."
              : "We're still fetching NAV history. Pull-to-refresh or wait a moment."
          }
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
          {[{ key: "none", label: "None" }, ...BENCHMARK_OPTIONS].map((b) => (
            <span
              key={b.key}
              className="chip"
              data-active={benchmark === b.key}
              onClick={() => setBenchmark(b.key)}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {hasHoldings && (
        <div style={{ marginBottom: 14 }}>
          <div className="section-header" style={{ padding: "0 20px" }}>
            <h3>Charts</h3>
          </div>
          <div className="chart-row">
            <div className="chart-card">
              <div className="h">ALLOCATION · BY ASSET CLASS</div>
              <AllocationDonut data={health.byClass} height={150} />
              <div className="stack-sm" style={{ fontSize: 11, marginTop: 4 }}>
                {health.byClass.map((s) => (
                  <div key={s.key} className="row between" style={{ gap: 6, padding: "2px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }}
                      ></span>
                      <span>{s.label}</span>
                    </span>
                    <span className="num" style={{ color: "var(--muted)" }}>
                      {s.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-card">
              <div className="h">
                DRIFT FROM TARGET{targetModel ? ` · ${targetModel.name}` : ""}
              </div>
              {targetModel ? (
                <>
                  <div
                    className="v"
                    style={{
                      color: health.trackingGapPp >= 5 ? "var(--amber)" : "var(--gain)",
                    }}
                  >
                    {health.trackingGapPp.toFixed(1)}pp
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                    {health.trackingGapPp >= 5
                      ? "Off target — consider a rebalance"
                      : "Closely tracking your target"}
                  </div>
                  <DriftBars data={health.drift} height={150} />
                </>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.5,
                    padding: "16px 0",
                  }}
                >
                  Pick a target model to track how far each holding has drifted from its intended
                  weight.
                </div>
              )}
            </div>

            <div className="chart-card">
              <div className="h">GEOGRAPHY · BY FUND DOMICILE</div>
              <div className="stacked-bar">
                {health.byRegion.map((g) => (
                  <span key={g.key} style={{ width: `${g.pct}%`, background: g.color }}></span>
                ))}
              </div>
              <div className="stack-sm" style={{ fontSize: 11 }}>
                {health.byRegion.slice(0, 6).map((g) => (
                  <div key={g.key} className="row between" style={{ gap: 6, padding: "2px 0" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{ width: 7, height: 7, borderRadius: "50%", background: g.color }}
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
              <div className="h">CONCENTRATION</div>
              <div className="v">
                {health.concentration.top ? `${health.concentration.top.pct.toFixed(0)}%` : "—"}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                {health.concentration.top
                  ? `Largest holding · ${health.concentration.top.ticker}`
                  : "No holdings"}
              </div>
              <div className="stack-sm" style={{ fontSize: 11 }}>
                <div className="row between" style={{ padding: "2px 0" }}>
                  <span>Top 3 holdings</span>
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {health.concentration.top3Pct.toFixed(0)}%
                  </span>
                </div>
                <div className="row between" style={{ padding: "2px 0" }}>
                  <span>Holdings held</span>
                  <span className="num" style={{ color: "var(--muted)" }}>
                    {health.concentration.holdingCount}
                  </span>
                </div>
                <div className="row between" style={{ padding: "2px 0" }}>
                  <span>Cash drag</span>
                  <span
                    className="num"
                    style={{ color: health.cashPct >= 10 ? "var(--amber)" : "var(--muted)" }}
                  >
                    {health.cashPct.toFixed(1)}%
                  </span>
                </div>
              </div>
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

          {/* ── Composite health score ─────────────────────────────── */}
          {score && hasHoldings && (
            <div
              className="card"
              style={{
                marginBottom: 10,
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                <ScoreCircle value={score.total} max={100} size={58} color={scoreColor} />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--muted)",
                      letterSpacing: "0.04em",
                      marginBottom: 2,
                    }}
                  >
                    PORTFOLIO SCORE
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: scoreColor,
                      letterSpacing: "-0.02em",
                      lineHeight: 1,
                    }}
                  >
                    {score.total}
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 400,
                        color: "var(--muted)",
                        marginLeft: 2,
                      }}
                    >
                      /100
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 3 }}>
                    {scoreLabel}
                  </div>
                </div>
              </div>

              {/* Score breakdown — why this score */}
              <div
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--muted)",
                  letterSpacing: "0.04em",
                  marginBottom: 6,
                }}
              >
                ● WHY THIS SCORE
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {score.components.map((c) => {
                  const pct = c.score / c.max;
                  const barColor =
                    pct >= 0.8 ? "var(--gain)" : pct >= 0.5 ? "var(--amber)" : "var(--loss)";
                  return (
                    <div key={c.key}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 2,
                        }}
                      >
                        <span
                          style={{
                            width: 14,
                            textAlign: "center",
                            fontSize: 10,
                            color: "var(--muted)",
                          }}
                        >
                          {COMPONENT_ICONS[c.key]}
                        </span>
                        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-soft)" }}>
                          {c.label}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                            color: barColor,
                            minWidth: 36,
                            textAlign: "right",
                          }}
                        >
                          {c.score}/{c.max}
                        </span>
                      </div>
                      {/* Mini progress bar */}
                      <div
                        style={{
                          marginLeft: 20,
                          height: 3,
                          background: "var(--line-soft)",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct * 100}%`,
                            height: "100%",
                            background: barColor,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <div
                        style={{
                          marginLeft: 20,
                          fontSize: 10.5,
                          color: "var(--muted)",
                          marginTop: 2,
                          lineHeight: 1.35,
                        }}
                      >
                        {c.detail}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  marginTop: 8,
                  lineHeight: 1.4,
                  borderTop: "1px solid var(--line-soft)",
                  paddingTop: 6,
                }}
              >
                Score = drift (30) + fees (25) + diversification (25) + cash (20). Deterministic, no
                AI — each rule is documented in lib/portfolio/score.ts.
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {(
              [
                {
                  lbl: "OFF TARGET",
                  val: `${health.trackingGapPp.toFixed(1)}`,
                  unit: "pp",
                  color: health.trackingGapPp >= 5 ? "var(--amber)" : "var(--gain)",
                },
                {
                  lbl: "BLENDED FEE",
                  val: health.blendedTer.toFixed(2),
                  unit: "%",
                  color: health.blendedTer <= 0.75 ? "var(--gain)" : "var(--amber)",
                },
                {
                  lbl: "TOP HOLDING",
                  val: health.concentration.top ? health.concentration.top.pct.toFixed(0) : "0",
                  unit: "%",
                  color: (health.concentration.top?.pct ?? 0) >= 35 ? "var(--loss)" : "var(--info)",
                },
                {
                  lbl: "CASH",
                  val: health.cashPct.toFixed(0),
                  unit: "%",
                  color: health.cashPct >= 10 ? "var(--amber)" : "var(--accent)",
                },
              ] as { lbl: string; val: string; unit: string; color: string }[]
            ).map((s) => (
              <div
                key={s.lbl}
                className="card-soft"
                style={{ padding: "8px 8px", textAlign: "center" }}
              >
                <div className="num" style={{ fontSize: 18, fontWeight: 500, color: s.color }}>
                  {s.val}
                  <span style={{ fontSize: 10, marginLeft: 1 }}>{s.unit}</span>
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
                color: HEADLINE_TONE[headline.tone],
                letterSpacing: "0.04em",
                marginBottom: 4,
              }}
            >
              ● TOP THING TO KNOW
            </div>
            <div
              style={{ fontSize: 14, fontWeight: 500, marginBottom: 6, letterSpacing: "-0.01em" }}
            >
              {headline.title}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
                marginBottom: 10,
              }}
            >
              {headline.body}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn sm primary"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("ai-prompt", { detail: headline.prompt }));
                }}
              >
                <Icon name="chat" size={12} /> Discuss
              </button>
            </div>
          </div>

          {(trim || add) && (
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
                ● SUGGESTED REBALANCE
              </div>
              <div style={{ marginBottom: 10 }}>
                {trim && (
                  <div className="row between" style={{ padding: "3px 0", fontSize: 12.5 }}>
                    <span style={{ color: "var(--accent-ink)" }}>
                      Trim <strong>{trim.ticker}</strong>
                    </span>
                    <span className="num" style={{ color: "var(--accent-ink)" }}>
                      {trim.current.toFixed(0)}% → {trim.target.toFixed(0)}%
                    </span>
                  </div>
                )}
                {add && (
                  <div className="row between" style={{ padding: "3px 0", fontSize: 12.5 }}>
                    <span style={{ color: "var(--accent-ink)" }}>
                      Add to <strong>{add.ticker}</strong>
                    </span>
                    <span className="num" style={{ color: "var(--accent-ink)" }}>
                      {add.current.toFixed(0)}% → {add.target.toFixed(0)}%
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className="btn sm primary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("ai-prompt", {
                        detail: `My portfolio has drifted ${health.trackingGapPp.toFixed(1)}pp from my ${targetModel.name} target. Give me a step-by-step rebalance plan with specific amounts.`,
                      }),
                    );
                  }}
                >
                  Plan the rebalance <Icon name="arrowRight" size={12} />
                </button>
              </div>

              <FeedbackRow
                topic="rebalance"
                label="HELPFUL?"
                value={feedback.rebalance ?? null}
                onChange={(rating) => setFeedback({ ...feedback, rebalance: rating })}
              />
            </div>
          )}
        </div>
      )}

      <div className="section-header" style={{ padding: "0 20px", marginBottom: 4, marginTop: 18 }}>
        <h3>Holdings</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="link">{view.holdings.length} holdings</span>
          <button
            className="btn ghost sm"
            onClick={onOpenImport}
            style={{ gap: 4, borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            <Icon name="plus" size={12} /> Add
          </button>
        </div>
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
        {filtered.length === 0 && (
          <div
            className="card-soft"
            style={{
              padding: "18px 16px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {view.holdings.length === 0 ? (
              <>
                <div style={{ marginBottom: 10, color: "var(--ink-soft)" }}>
                  No holdings in this portfolio yet.
                </div>
                <button className="btn sm primary" onClick={onOpenImport}>
                  <Icon name="plus" size={12} /> Add your first holding
                </button>
              </>
            ) : (
              <>No {filter} holdings here. Switch filters to see the rest.</>
            )}
          </div>
        )}
        {filtered.map((h) => {
          const pct = view.totalValue > 0 ? (h.value / view.totalValue) * 100 : 0;
          const editable = h.id !== undefined;
          return (
            <div
              key={(h.id ?? h.ticker) + (h.source || "")}
              className="holding"
              role={editable ? "button" : undefined}
              tabIndex={editable ? 0 : undefined}
              onClick={editable ? () => setHoldingSheet(h) : undefined}
              onKeyDown={
                editable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setHoldingSheet(h);
                      }
                    }
                  : undefined
              }
              style={editable ? { cursor: "pointer" } : undefined}
            >
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

      <HoldingSheet
        open={!!holdingSheet}
        holdingId={holdingSheet?.id}
        lockTicker
        initial={
          holdingSheet
            ? holdingToFormValues(
                holdingSheet,
                holdingSheet.bucketId ?? activePf?.id ?? portfolios[0]?.id ?? "",
              )
            : {
                bucketId: "",
                ticker: "",
                thaiName: "",
                englishName: "",
                category: "",
                assetClass: "equity",
                region: "",
                units: 0,
                avgCost: 0,
                ter: 0,
                source: "",
                quoteSource: DEFAULT_QUOTE_SOURCE,
                color: "var(--accent)",
              }
        }
        bucketOptions={portfolios.map((p) => ({ id: p.id, name: p.name }))}
        onClose={() => setHoldingSheet(null)}
        onSave={saveHolding}
        onDelete={
          holdingSheet?.id !== undefined
            ? () => deleteHolding(holdingSheet.id as number)
            : undefined
        }
      />
    </div>
  );
}
