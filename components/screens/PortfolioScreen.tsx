"use client";

import { useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ModelDonut, ScoreCircle } from "@/components/charts";
import { FeedbackRow } from "@/components/FeedbackRow";
import { FundDetailSheet } from "@/components/FundDetailSheet";
import { type HoldingFormValues, HoldingSheet } from "@/components/HoldingSheet";
import { Icon } from "@/components/Icon";
import { AllocationDonut, DriftBars, NavChart } from "@/components/InteractiveCharts";
import {
  useModelPortfoliosView,
  usePortfolioView,
  useSelectedModelId,
} from "@/lib/fetchers/legacy";
import {
  type FeeCreepFinding,
  type HiddenActionItem,
  mutateActionItemState,
  restoreActionItem,
  type SeriesRange,
  useBenchmarkSeries,
  useFeeCreep,
  useHiddenActionItems,
} from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { fmtPct } from "@/lib/format";
import { BENCHMARK_OPTIONS } from "@/lib/market/benchmark-options";
import { DEFAULT_QUOTE_SOURCE, isQuoteSource } from "@/lib/market/sources";
import { feeCreepKey } from "@/lib/portfolio/action-item-key";
import { REASON_CHIPS, type ReasonChip } from "@/lib/portfolio/action-item-resurface";
import { formatSeriesDate } from "@/lib/portfolio/adapter";
import { presentFeeChecks } from "@/lib/portfolio/fee-creep-presentation";
import { computeHealth, rebalanceHint, summarizeHealth } from "@/lib/portfolio/health";
import { scorePortfolio } from "@/lib/portfolio/score";
import type { AssetClass, Holding, Portfolio } from "@/lib/static/types";
import { usePortfolioUi } from "@/lib/stores/portfolio-ui";

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
    // The edit form represents an unknown fee as 0 (the field starts blank).
    ter: h.ter ?? 0,
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

// Human labels for the "Not for me" reason chips (keys from REASON_CHIPS).
const REASON_CHIP_LABELS: Record<ReasonChip, string> = {
  too_small: "Too small to matter",
  tax_switching: "Tax & switching cost",
  prefer_this_fund: "I prefer this fund",
  already_considered: "Already considered",
};

// One fee-check finding rendered as a full card: held fund, cheaper
// alternatives, the annual saving, and the two honest controls — Archive and
// "Not for me" (#74). "Not for me" expands an inline reason picker (the four
// chips + an optional "Other…" free text); none of it is a blocking modal.
function FeeCheckCard({
  finding,
  reasonOpen,
  reasonText,
  onOpenReason,
  onReasonText,
  onArchive,
  onReject,
}: {
  finding: FeeCreepFinding;
  reasonOpen: boolean;
  reasonText: string;
  onOpenReason: (open: boolean) => void;
  onReasonText: (text: string) => void;
  onArchive: () => void;
  onReject: (reason: ReasonChip | string | null) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 4,
        }}
      >
        <div>
          <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.01em" }}>
            {finding.heldTicker}
          </span>
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>
            {finding.heldName}
          </span>
        </div>
        <span
          className="num"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber)",
            whiteSpace: "nowrap",
            marginLeft: 8,
          }}
        >
          {finding.heldTer.toFixed(2)}% TER
        </span>
      </div>
      {finding.alternatives.slice(0, 2).map((alt) => (
        <div
          key={alt.projId}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "3px 0",
            paddingLeft: 10,
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
            {alt.abbrName}
            {alt.englishName ? (
              <span style={{ color: "var(--muted)", marginLeft: 4 }}>· {alt.englishName}</span>
            ) : null}
          </span>
          <span
            className="num"
            style={{ fontSize: 11.5, color: "var(--gain)", whiteSpace: "nowrap" }}
          >
            {alt.ter.toFixed(2)}%
          </span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, paddingLeft: 10 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Potential saving:</span>
        <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--gain)" }}>
          −{finding.savingsPp.toFixed(2)}pp/yr
        </span>
      </div>

      {/* Two honest actions: Archive (file it) and "Not for me" (reject). */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingLeft: 10 }}>
        <button
          type="button"
          className="btn ghost sm"
          style={{ gap: 4 }}
          onClick={onArchive}
          aria-label={`Archive the fee check for ${finding.heldTicker}`}
          title="File this. It returns only if the saving grows materially."
        >
          <Icon name="archive" size={11} /> Archive
        </button>
        <button
          type="button"
          className="btn ghost sm"
          style={{ gap: 4 }}
          onClick={() => onOpenReason(!reasonOpen)}
          aria-expanded={reasonOpen}
          aria-label={`Reject the fee check for ${finding.heldTicker}`}
          title="This advice isn't right for me. Optionally tell us why."
        >
          <Icon name="thumbs-down" size={11} /> Not for me
        </button>
      </div>

      {reasonOpen && (
        <div style={{ marginTop: 8, paddingLeft: 10 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            Why isn&apos;t this right for you? (optional)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {REASON_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className="btn ghost sm"
                onClick={() => onReject(chip)}
              >
                {REASON_CHIP_LABELS[chip]}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={reasonText}
              onChange={(e) => onReasonText(e.target.value)}
              placeholder="Other… (optional)"
              aria-label="Other reason"
              style={{
                flex: 1,
                fontSize: 12,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid var(--line)",
                background: "var(--bg)",
                color: "var(--ink)",
              }}
            />
            <button
              type="button"
              className="btn sm"
              onClick={() => onReject(reasonText.trim() || null)}
            >
              Confirm
            </button>
          </div>
        </div>
      )}
    </div>
  );
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
  // Active portfolio lives in the shared store so the right-rail PortfoliosPanel
  // stays in sync without a window-event handshake.
  const { activeId: activePfId, setActiveId, requestNew, requestEdit } = usePortfolioUi();
  const [range, setRange] = useState<string>("6M");
  const [filter, setFilter] = useState<AssetClass | "all">("all");
  const [benchmark, setBenchmark] = useState<string>("none");
  const [feedback, setFeedback] = useState<Record<string, "up" | "down" | null>>({});
  // Tapping a holding row opens a read-only detail view (detailHolding); the
  // per-row Edit affordance opens the edit form (holdingSheet). Reading a
  // holding no longer drops the user straight into an edit form.
  const [holdingSheet, setHoldingSheet] = useState<Holding | null>(null);
  const [detailHolding, setDetailHolding] = useState<Holding | null>(null);
  // Which fee-creep card has its "Not for me" reason picker open (by heldTicker).
  const [reasonPickerFor, setReasonPickerFor] = useState<string | null>(null);
  // Free-text reason ("Other…") typed in the open reason picker.
  const [reasonText, setReasonText] = useState("");
  // Whether the low-severity tail ("N more") is expanded.
  const [showAllFeeChecks, setShowAllFeeChecks] = useState(false);
  // Whether the Hidden-checks (N) review-and-restore list is expanded.
  const [showHidden, setShowHidden] = useState(false);

  // App owns the create/edit sheet; request it through the shared store.
  const openNewPortfolio = () => requestNew();
  const openEditPortfolio = (id: string) => requestEdit(id);

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
  const { data: feeCreepData, mutate: mutateFeeCreep } = useFeeCreep();
  const { data: hiddenData } = useHiddenActionItems();
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

  // Fee-creep findings scoped to the active view's holdings.
  const feeCreepFindings = useMemo<FeeCreepFinding[]>(() => {
    if (!feeCreepData || !view) return [];
    const activeTickers = new Set(view.holdings.map((h) => h.ticker));
    return feeCreepData.filter((f) => activeTickers.has(f.heldTicker));
  }, [feeCreepData, view]);

  // Long-list presentation (#74 §5): severity order, top-N as full cards, the
  // rest behind a "N more" expander, plus a calm summary line.
  const feeCheckView = useMemo(() => presentFeeChecks(feeCreepFindings), [feeCreepFindings]);

  // Hidden (archived / rejected) fee-creep items — the "Hidden checks (N)" list.
  // Scoped to fee_creep so the surface stays about the section it sits under.
  const hiddenFeeChecks = useMemo<HiddenActionItem[]>(
    () => (hiddenData?.hidden ?? []).filter((h) => h.itemType === "fee_creep"),
    [hiddenData],
  );

  // Optimistically drop one or more fee-creep cards from the SWR cache so they
  // disappear at once, then record each server-side. Suppression is keyed by
  // fee_creep:{heldTicker} (identity only), so a choice survives NAV ticks but a
  // genuinely worse finding can resurface (lib/portfolio/action-item-resurface).
  const dropCards = (tickers: string[]) => {
    const drop = new Set(tickers);
    mutateFeeCreep((curr) => (curr ?? []).filter((f) => !drop.has(f.heldTicker)), {
      revalidate: false,
    });
  };

  // Archive ("I've seen this; file it") — the soft action; resurfaces on a
  // material jump in the saving. No reason, no feedback signal. Restore lives in
  // the "Hidden checks (N)" list, the single restore path.
  const archiveFeeCreep = (finding: FeeCreepFinding) => {
    setReasonPickerFor(null);
    dropCards([finding.heldTicker]);
    void mutateActionItemState({
      itemType: "fee_creep",
      itemKey: feeCreepKey(finding.heldTicker),
      state: "archived",
      savingsPp: finding.savingsPp,
    });
  };

  // Archive every currently shown fee check in one calm tap (batch is Archive
  // only — never "Not for me", which carries a per-item reason). Restore lives
  // in the "Hidden checks (N)" list.
  const archiveAllFeeChecks = (findings: FeeCreepFinding[]) => {
    if (findings.length === 0) return;
    setReasonPickerFor(null);
    const tickers = findings.map((f) => f.heldTicker);
    dropCards(tickers);
    for (const f of findings) {
      void mutateActionItemState({
        itemType: "fee_creep",
        itemKey: feeCreepKey(f.heldTicker),
        state: "archived",
        savingsPp: f.savingsPp,
      });
    }
  };

  // "Not for me" (reject) — optionally with a reason chip or free text. Writes a
  // Journal feedback entry server-side and is stickier than Archive.
  const rejectFeeCreep = (finding: FeeCreepFinding, reason: ReasonChip | string | null) => {
    setReasonPickerFor(null);
    setReasonText("");
    dropCards([finding.heldTicker]);
    void mutateActionItemState({
      itemType: "fee_creep",
      itemKey: feeCreepKey(finding.heldTicker),
      state: "not_for_me",
      reason: reason || null,
      savingsPp: finding.savingsPp,
      topic: `Fee check — ${finding.heldTicker}`,
    });
  };

  // Restore a single hidden item from the Hidden-checks list — the single
  // restore path now that the post-archive Undo toast is gone.
  const restoreHidden = (itemKey: string) => {
    void restoreActionItem(itemKey).then(() => mutateFeeCreep());
  };

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
            <BrandMark />
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
            <BrandMark />
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
          <BrandMark />
          <span>Macrotide</span>
        </div>
        {showMenu && (
          <button className="icon-btn" aria-label="More" onClick={onOpenSettings}>
            <Icon name="ellipsis-vertical" size={13} />
          </button>
        )}
      </div>

      <div className="portfolio-switch">
        <button data-active={activePfId === "all"} onClick={() => setActiveId("all")}>
          ☰ All
          <span className="pf-sub">{portfolios.length} PORTFOLIOS</span>
        </button>
        {portfolios.map((p) => (
          <button key={p.id} data-active={activePfId === p.id} onClick={() => setActiveId(p.id)}>
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
        {benchmark !== "none" && (
          <p
            style={{
              fontSize: 11,
              color: "var(--muted)",
              lineHeight: 1.5,
              padding: "8px 4px 0",
              maxWidth: 560,
            }}
          >
            How this is measured: holdings are converted to THB before they are summed, so a single
            line spans your Thai and foreign positions. The comparison assumes your current holdings
            were held throughout the window — it does not yet account for purchases or sales made
            during it. Benchmarks use price-return indices, which exclude dividends and so may
            understate an index's total return. Treat the gap as a guide, not a precise figure.
          </p>
        )}
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

      {/* ── Composite health score — always shown when there are holdings, ──
           regardless of whether a target model is selected. With no target the
           drift component is excluded and the remaining components renormalise
           onto 0–100 (see lib/portfolio/score.ts). */}
      {score && hasHoldings && (
        <div className="section" style={{ marginTop: 8 }}>
          <div className="section-header" style={{ padding: "0 4px" }}>
            <h3>Portfolio score</h3>
            {targetModel ? (
              <span className="link" onClick={onOpenModels} style={{ cursor: "pointer" }}>
                Target: {targetModel.name} →
              </span>
            ) : (
              <span className="link" onClick={onOpenModels} style={{ cursor: "pointer" }}>
                Set a target →
              </span>
            )}
          </div>

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
                // Drift with no target isn't scored — render it as a muted CTA row
                // rather than a 0/30 bar that reads like a failing grade.
                const notScored = c.key === "drift" && !score.hasTarget;
                const pct = c.score / c.max;
                const barColor = notScored
                  ? "var(--muted)"
                  : pct >= 0.8
                    ? "var(--gain)"
                    : pct >= 0.5
                      ? "var(--amber)"
                      : "var(--loss)";
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
                          color: notScored ? "var(--muted)" : barColor,
                          minWidth: 36,
                          textAlign: "right",
                        }}
                      >
                        {notScored ? "—" : `${c.score}/${c.max}`}
                      </span>
                    </div>
                    {/* Mini progress bar — hidden for the not-scored drift row */}
                    {!notScored && (
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
                    )}
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
              {score.hasTarget
                ? "Score = drift (30) + fees (25) + diversification (25) + cash (20). Deterministic, no AI — each rule is documented in lib/portfolio/score.ts."
                : "Drift isn't scored without a target — score is fees, diversification, and cash, rescaled to 100. Set a target to include plan tracking. Deterministic, no AI — each rule is documented in lib/portfolio/score.ts."}
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
                  window.dispatchEvent(
                    new CustomEvent("ai-prompt", {
                      detail: {
                        display: headline.prompt,
                        send: headline.prompt,
                        context: { screen: "portfolio", intent: "score_review" },
                      },
                    }),
                  );
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
                    const prompt = `My portfolio has drifted ${health.trackingGapPp.toFixed(1)}pp from my ${targetModel.name} target. Give me a step-by-step rebalance plan with specific amounts.`;
                    window.dispatchEvent(
                      new CustomEvent("ai-prompt", {
                        // Carry the gap + target the screen already computed so the
                        // Advisor can plan without re-deriving them via read_portfolio.
                        detail: {
                          display: prompt,
                          send: prompt,
                          context: {
                            screen: "portfolio",
                            intent: "rebalance",
                            subject: targetModel.name,
                            signals: { trackingGapPp: Number(health.trackingGapPp.toFixed(1)) },
                          },
                        },
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

      {feeCreepFindings.length > 0 && (
        <div className="section" style={{ marginTop: 14 }}>
          <div className="section-header" style={{ padding: "0 4px" }}>
            <h3>Fee check</h3>
          </div>
          <div
            className="card"
            style={{
              borderColor: "var(--amber)",
              background: "var(--amber-soft, color-mix(in srgb, var(--amber) 8%, transparent))",
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--amber)",
                letterSpacing: "0.04em",
                marginBottom: 6,
              }}
            >
              ● FEE CREEP — COMPARABLE EXPOSURE, LOWER COST
            </div>
            {/* Calm, no-deadline summary line (#74 §5) — never count-pressure. */}
            <div
              style={{
                fontSize: 12,
                color: "var(--ink-soft)",
                lineHeight: 1.5,
                marginBottom: 10,
              }}
            >
              {feeCheckView.summary}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Top findings (severity order) as full cards. */}
              {feeCheckView.top.map((f) => (
                <FeeCheckCard
                  key={f.heldTicker}
                  finding={f}
                  reasonOpen={reasonPickerFor === f.heldTicker}
                  reasonText={reasonText}
                  onOpenReason={(open) => {
                    setReasonPickerFor(open ? f.heldTicker : null);
                    setReasonText("");
                  }}
                  onReasonText={setReasonText}
                  onArchive={() => archiveFeeCreep(f)}
                  onReject={(reason) => rejectFeeCreep(f, reason)}
                />
              ))}

              {/* The lower-severity tail, default-collapsed behind "N more".
                  A subtle centered text link, not a chunky bordered block. */}
              {feeCheckView.moreCount > 0 && !showAllFeeChecks && (
                <button
                  type="button"
                  className="btn link sm"
                  style={{ alignSelf: "center" }}
                  onClick={() => setShowAllFeeChecks(true)}
                  aria-expanded={false}
                >
                  Show {feeCheckView.moreCount} more
                </button>
              )}
              {showAllFeeChecks &&
                feeCheckView.rest.map((f) => (
                  <FeeCheckCard
                    key={f.heldTicker}
                    finding={f}
                    reasonOpen={reasonPickerFor === f.heldTicker}
                    reasonText={reasonText}
                    onOpenReason={(open) => {
                      setReasonPickerFor(open ? f.heldTicker : null);
                      setReasonText("");
                    }}
                    onReasonText={setReasonText}
                    onArchive={() => archiveFeeCreep(f)}
                    onReject={(reason) => rejectFeeCreep(f, reason)}
                  />
                ))}
              {showAllFeeChecks && feeCheckView.moreCount > 0 && (
                <button
                  type="button"
                  className="btn link sm"
                  style={{ alignSelf: "center" }}
                  onClick={() => setShowAllFeeChecks(false)}
                  aria-expanded={true}
                >
                  Show fewer
                </button>
              )}
            </div>
            {/* Intrinsic-width actions, left-aligned — flex-wrap so they stack
                on a narrow (mobile) surface but never stretch full-width on a
                wide pane. Matches the app's default inline-flex button width. */}
            <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                className="btn sm primary"
                onClick={() => {
                  const top = feeCheckView.top[0] ?? feeCreepFindings[0];
                  const alt = top.alternatives[0];
                  const prompt = `I hold ${top.heldTicker} at a ${top.heldTer.toFixed(2)}% TER. ${alt.abbrName} offers comparable ${top.assetClass ?? "same-class"} exposure at ${(alt.ter ?? 0).toFixed(2)}%. Walk me through what it would take to switch, and whether the saving justifies the move.`;
                  window.dispatchEvent(
                    new CustomEvent("ai-prompt", {
                      // The fee comparison is already on screen — pass it so the
                      // Advisor reasons about the switch without re-reading holdings.
                      detail: {
                        display: prompt,
                        send: prompt,
                        context: {
                          screen: "portfolio",
                          intent: "fee_switch",
                          subject: top.heldTicker,
                          signals: {
                            heldTer: Number(top.heldTer.toFixed(2)),
                            alternative: alt.abbrName,
                            altTer: Number((alt.ter ?? 0).toFixed(2)),
                            assetClass: top.assetClass ?? "same-class",
                          },
                        },
                      },
                    }),
                  );
                }}
              >
                <Icon name="chat" size={12} /> Ask advisor
              </button>
              {/* Batch action — Archive only; never "Not for me" (which carries
                  a per-item reason). Clears the noise in one calm tap; restore
                  via the "Hidden checks (N)" list. */}
              {feeCreepFindings.length > 1 && (
                <button
                  className="btn sm ghost"
                  onClick={() => archiveAllFeeChecks(feeCreepFindings)}
                  aria-label="Archive all fee checks"
                >
                  <Icon name="archive" size={12} /> Archive all
                </button>
              )}
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
              Comparable exposure means same asset class. Lower fee, not necessarily better fund.
              Tax implications and switching costs apply.
            </div>
          </div>
        </div>
      )}

      {/* Hidden checks (N) — a quiet, restorable list of archived / rejected fee
          checks. Discoverable but unobtrusive: collapsed by default, no badge. */}
      {hiddenFeeChecks.length > 0 && (
        <div className="section" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn ghost sm"
            style={{ gap: 4, color: "var(--muted)" }}
            onClick={() => setShowHidden((v) => !v)}
            aria-expanded={showHidden}
          >
            <Icon name={showHidden ? "chevron-down" : "chevron-right"} size={12} />
            Hidden checks ({hiddenFeeChecks.length})
          </button>
          {showHidden && (
            <div className="card" style={{ marginTop: 6, padding: "6px 12px" }}>
              {hiddenFeeChecks.map((h) => {
                const ticker = h.itemKey.replace(/^fee_creep:/, "");
                const label = h.state === "not_for_me" ? "Not for me" : "Archived";
                const reasonLabel =
                  h.reason && h.reason in REASON_CHIP_LABELS
                    ? REASON_CHIP_LABELS[h.reason as ReasonChip]
                    : h.reason;
                return (
                  <div
                    key={h.itemKey}
                    className="row between"
                    style={{ padding: "6px 0", gap: 8, alignItems: "center" }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{ticker}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {label}
                        {reasonLabel ? ` · ${reasonLabel}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => restoreHidden(h.itemKey)}
                      aria-label={`Restore the fee check for ${ticker}`}
                    >
                      Restore
                    </button>
                  </div>
                );
              })}
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
          // Any holding can be viewed; only DB-backed holdings (with an id) can
          // be edited via the holdings API.
          const editable = h.id !== undefined;
          return (
            <div
              key={(h.id ?? h.ticker) + (h.source || "")}
              className="holding"
              style={{
                // Override .holding's grid: the row is now a flex container for
                // [view button, edit button]; the view button carries the
                // original 3-column grid so the swatch/name/value layout is
                // unchanged.
                display: "flex",
                gap: 4,
              }}
            >
              {/* Main click target — opens the read-only detail view. A real
                  <button> so it's keyboard-focusable; styled to inherit the
                  row's chrome and carry the row's grid. Sibling of the Edit
                  button (never nested) so the markup stays valid. Mirrors the
                  FundSelect row pattern. */}
              <button
                type="button"
                aria-label={`View details for ${h.ticker}`}
                onClick={() => setDetailHolding(h)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "32px 1fr auto",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                  background: "none",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  cursor: "pointer",
                }}
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
              </button>
              {editable && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Edit ${h.ticker}`}
                  title={`Edit ${h.ticker}`}
                  onClick={() => setHoldingSheet(h)}
                  style={{ flexShrink: 0, alignSelf: "center" }}
                >
                  <Icon name="pencil" size={12} />
                </button>
              )}
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

      <FundDetailSheet
        holding={detailHolding}
        onEdit={
          detailHolding?.id !== undefined
            ? () => {
                // Hand off from view to edit: close the detail, open the form.
                const h = detailHolding;
                setDetailHolding(null);
                setHoldingSheet(h);
              }
            : undefined
        }
        onClose={() => setDetailHolding(null)}
      />

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
