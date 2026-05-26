"use client";

// FundDetailSheet — shows enrichment data for a single fund fetched from
// GET /api/funds/[projId]. Rendered as a sheet overlay (same pattern as
// HoldingSheet / PortfolioSheet).
//
// All five enrichment sections gracefully no-op when their arrays are empty,
// so the sheet looks clean in dev before the SEC ingest job has run.

import { useState } from "react";
import { Icon } from "@/components/Icon";
import type {
  FundAssetAllocationRow,
  FundPerformanceRow,
  FundPortfolioAssetTypeRow,
  FundPortfolioRow,
  FundTopHoldingRow,
} from "@/lib/db/queries/fund-enrichment";
import type { FundWithTer } from "@/lib/db/queries/funds";
import { useResource } from "@/lib/fetchers/swr";

// ─── API response type ────────────────────────────────────────────────────────

export type FundDetailResponse = FundWithTer & {
  performance: FundPerformanceRow[];
  assetAllocation: FundAssetAllocationRow[];
  topHoldings: FundTopHoldingRow[];
  portfolio: FundPortfolioRow[];
  portfolioAssetType: FundPortfolioAssetTypeRow[];
};

// ─── performance type label map ───────────────────────────────────────────────
// Thai performance_type_desc → short English label.

const PERF_TYPE_LABELS: Record<string, string> = {
  ความผันผวนของกองทุนรวม: "Fund Volatility",
  ความผันผวนของดัชนีชี้วัด: "Benchmark Volatility",
  ผลการดำเนินงานของกองทุนรวม: "Fund Return",
  ผลการดำเนินงานของดัชนีชี้วัด: "Benchmark Return",
  ผลการดำเนินงานเฉลี่ยของกองทุนรวมในกลุ่ม: "Peer Avg Return",
  ความผันผวนเฉลี่ยของกองทุนรวมในกลุ่ม: "Peer Avg Volatility",
};

function perfTypeLabel(raw: string): string {
  return PERF_TYPE_LABELS[raw] ?? raw;
}

// Period ordering — shorter periods first.
const PERIOD_ORDER: string[] = ["3M", "6M", "YTD", "1Y", "SI", "3Y", "5Y"];

function periodSortKey(period: string): number {
  const idx = PERIOD_ORDER.indexOf(period.toUpperCase());
  return idx >= 0 ? idx : 99;
}

// ─── formatting helpers ───────────────────────────────────────────────────────

function fmtPct(val: string | number | null | undefined, showSign = true): string {
  if (val == null) return "–";
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (Number.isNaN(n)) return val as string;
  const sign = showSign && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtNavPct(val: number | null | undefined): string {
  if (val == null) return "–";
  return `${val.toFixed(2)}%`;
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--muted)",
        marginBottom: 8,
        marginTop: 16,
        paddingBottom: 4,
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      {title}
    </div>
  );
}

// ─── 1. Performance & risk ────────────────────────────────────────────────────

function PerformanceSection({ rows }: { rows: FundPerformanceRow[] }) {
  if (rows.length === 0) return null;

  // Pivot: group by performanceTypeDesc, columns are referencePeriod.
  const typeMap = new Map<string, Map<string, string | null>>();
  const periods = new Set<string>();

  for (const row of rows) {
    periods.add(row.referencePeriod);
    if (!typeMap.has(row.performanceTypeDesc)) {
      typeMap.set(row.performanceTypeDesc, new Map());
    }
    typeMap.get(row.performanceTypeDesc)?.set(row.referencePeriod, row.performanceValue ?? null);
  }

  const sortedPeriods = [...periods].sort((a, b) => periodSortKey(a) - periodSortKey(b));

  // Show performance rows first, then volatility rows.
  const RETURN_KEYWORDS = ["ผลการดำเนินงาน"];
  const sortedTypes = [...typeMap.keys()].sort((a, b) => {
    const aIsReturn = RETURN_KEYWORDS.some((k) => a.includes(k)) ? 0 : 1;
    const bIsReturn = RETURN_KEYWORDS.some((k) => b.includes(k)) ? 0 : 1;
    return aIsReturn - bIsReturn;
  });

  const cellStyle: React.CSSProperties = {
    padding: "4px 6px",
    textAlign: "right",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    borderBottom: "1px solid var(--line-soft)",
    whiteSpace: "nowrap",
  };

  const headerCellStyle: React.CSSProperties = {
    ...cellStyle,
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: 10,
    textTransform: "uppercase",
  };

  return (
    <>
      <SectionHeader title="Performance & Risk" />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th
                style={{
                  ...headerCellStyle,
                  textAlign: "left",
                  minWidth: 140,
                }}
              >
                Metric
              </th>
              {sortedPeriods.map((p) => (
                <th key={p} style={headerCellStyle}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTypes.map((typeDesc) => {
              const periodVals = typeMap.get(typeDesc) ?? new Map<string, string | null>();
              const label = perfTypeLabel(typeDesc);
              const isVol = typeDesc.includes("ความผันผวน");
              return (
                <tr key={typeDesc}>
                  <td
                    style={{
                      ...cellStyle,
                      textAlign: "left",
                      color: "var(--ink-soft)",
                      fontFamily: "var(--font-sans)",
                      fontSize: 11.5,
                    }}
                  >
                    {label}
                  </td>
                  {sortedPeriods.map((p) => {
                    const raw = periodVals.get(p) ?? null;
                    const n = raw != null ? parseFloat(raw) : null;
                    const color =
                      isVol || n == null
                        ? "var(--ink-soft)"
                        : n >= 0
                          ? "var(--gain)"
                          : "var(--loss)";
                    return (
                      <td key={p} style={{ ...cellStyle, color }}>
                        {fmtPct(raw, !isVol)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── 2. Asset allocation ──────────────────────────────────────────────────────

function AssetAllocationSection({ rows }: { rows: FundAssetAllocationRow[] }) {
  if (rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + (r.assetRatio ?? 0), 0);

  return (
    <>
      <SectionHeader title="Asset Allocation" />
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((row) => {
          const pct = row.assetRatio ?? 0;
          const barWidth = total > 0 ? Math.min(100, (pct / total) * 100) : 0;
          return (
            <div key={row.assetSeq}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {row.assetName ?? "—"}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--ink)",
                    fontWeight: 500,
                  }}
                >
                  {fmtNavPct(row.assetRatio)}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${barWidth}%`,
                    background: "var(--accent)",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── 3. Top-5 holdings ────────────────────────────────────────────────────────

function TopHoldingsSection({ rows }: { rows: FundTopHoldingRow[] }) {
  if (rows.length === 0) return null;

  return (
    <>
      <SectionHeader title="Top Holdings" />
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {rows.map((row) => (
          <li
            key={row.assetSeq}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 0",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <span
              style={{
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                background: row.assetSeq === 1 ? "var(--accent)" : "var(--card-soft)",
                color: row.assetSeq === 1 ? "var(--accent-ink)" : "var(--muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9.5,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {row.assetSeq}
            </span>
            <span
              style={{
                flex: 1,
                fontSize: 12,
                color: "var(--ink-soft)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.assetName ?? undefined}
            >
              {row.assetName ?? "—"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--ink)",
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {fmtNavPct(row.assetRatio)}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

// ─── 4. Full portfolio ────────────────────────────────────────────────────────

const PORTFOLIO_PREVIEW = 10;

function PortfolioSection({ rows }: { rows: FundPortfolioRow[] }) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, PORTFOLIO_PREVIEW);
  const hidden = rows.length - PORTFOLIO_PREVIEW;

  // derive the period label from the first row
  const period = rows[0]?.period;
  const periodLabel = period ? `${period.slice(0, 4)}/${period.slice(4)}` : null;

  return (
    <>
      <SectionHeader
        title={`Portfolio${periodLabel ? ` (${periodLabel})` : ""} · ${rows.length} holdings`}
      />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  padding: "3px 4px",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  borderBottom: "1px solid var(--line-soft)",
                }}
              >
                Name / Issuer
              </th>
              <th
                style={{
                  textAlign: "left",
                  padding: "3px 4px",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  borderBottom: "1px solid var(--line-soft)",
                  whiteSpace: "nowrap",
                }}
              >
                ISIN
              </th>
              <th
                style={{
                  textAlign: "right",
                  padding: "3px 4px",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  borderBottom: "1px solid var(--line-soft)",
                  whiteSpace: "nowrap",
                }}
              >
                %NAV
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={`${row.period}-${row.assetliabId}`}>
                <td
                  style={{
                    padding: "4px 4px",
                    color: "var(--ink-soft)",
                    fontSize: 11.5,
                    borderBottom: "1px solid var(--line-soft)",
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={[row.assetliabDesc, row.issuer].filter(Boolean).join(" · ") || undefined}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.assetliabDesc ?? row.issuer ?? "—"}
                  </span>
                  {row.issuer && row.assetliabDesc && (
                    <span
                      style={{
                        fontSize: 10.5,
                        color: "var(--muted)",
                        fontFamily: "var(--font-mono)",
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.issuer}
                    </span>
                  )}
                </td>
                <td
                  style={{
                    padding: "4px 4px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--muted)",
                    borderBottom: "1px solid var(--line-soft)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.isinCode ?? "—"}
                </td>
                <td
                  style={{
                    padding: "4px 4px",
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--ink)",
                    borderBottom: "1px solid var(--line-soft)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtNavPct(row.percentNav)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!expanded && hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 6,
            background: "none",
            border: "none",
            padding: "4px 0",
            cursor: "pointer",
            fontSize: 11.5,
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
          }}
        >
          Show all {rows.length} holdings ↓
        </button>
      )}
      {expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          style={{
            marginTop: 6,
            background: "none",
            border: "none",
            padding: "4px 0",
            cursor: "pointer",
            fontSize: 11.5,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
          }}
        >
          Show less ↑
        </button>
      )}
    </>
  );
}

// ─── 5. Asset-type breakdown (portfolioAssetType) ─────────────────────────────

function PortfolioAssetTypeSection({ rows }: { rows: FundPortfolioAssetTypeRow[] }) {
  if (rows.length === 0) return null;

  const total = rows.reduce((s, r) => s + (r.percentNav ?? 0), 0);

  // derive the period label from the first row
  const period = rows[0]?.period;
  const periodLabel = period ? `${period.slice(0, 4)}/${period.slice(4)}` : null;

  return (
    <>
      <SectionHeader title={`Asset-Type Breakdown${periodLabel ? ` (${periodLabel})` : ""}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((row) => {
          const pct = row.percentNav ?? 0;
          const barWidth = total > 0 ? Math.min(100, (pct / total) * 100) : 0;
          return (
            <div key={row.assetliabCode}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {row.assetliabDesc ?? row.assetliabCode}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--ink)",
                    fontWeight: 500,
                  }}
                >
                  {fmtNavPct(row.percentNav)}
                </span>
              </div>
              <div
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "var(--line)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${barWidth}%`,
                    background: "var(--info)",
                    borderRadius: 2,
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      style={{
        padding: "32px 0",
        textAlign: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.04em",
      }}
    >
      Loading…
    </div>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <div
      style={{
        padding: "24px 0",
        textAlign: "center",
        color: "var(--loss)",
        fontSize: 12.5,
      }}
    >
      {message ?? "Could not load fund data."}
    </div>
  );
}

// ─── Fund identity header (inside the sheet) ──────────────────────────────────

function FundHeader({ fund }: { fund: FundDetailResponse }) {
  const abbr = fund.abbrName ?? fund.projId;
  const name = fund.englishName ?? fund.thaiName ?? abbr;
  const amc = fund.amcName;

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: "var(--ink)",
          }}
        >
          {abbr}
        </span>
        {fund.ter != null && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 600,
              color:
                fund.ter <= 0.5
                  ? "var(--gain)"
                  : fund.ter <= 1.5
                    ? "var(--amber, #d89a1f)"
                    : "var(--loss)",
              background:
                fund.ter <= 0.5
                  ? "var(--gain-soft, rgba(16,168,107,0.1))"
                  : fund.ter <= 1.5
                    ? "var(--amber-soft, rgba(216,154,31,0.1))"
                    : "var(--loss-soft, rgba(209,69,69,0.08))",
              borderRadius: 6,
              padding: "2px 7px",
            }}
          >
            TER {fund.ter.toFixed(2)}%
          </span>
        )}
      </div>
      {name !== abbr && (
        <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>{name}</div>
      )}
      {amc && (
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.02em",
            marginTop: 1,
          }}
        >
          {amc}
        </div>
      )}
    </div>
  );
}

// ─── Detail body (fetches + renders all sections) ─────────────────────────────

function FundDetailBody({ projId }: { projId: string }) {
  const { data, isLoading, error } = useResource<FundDetailResponse>(
    projId ? `/api/funds/${encodeURIComponent(projId)}` : null,
  );

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message={error?.message} />;

  const hasAnyEnrichment =
    data.performance.length > 0 ||
    data.assetAllocation.length > 0 ||
    data.topHoldings.length > 0 ||
    data.portfolio.length > 0 ||
    data.portfolioAssetType.length > 0;

  return (
    <div>
      <FundHeader fund={data} />

      {!hasAnyEnrichment && (
        <div
          style={{
            marginTop: 20,
            padding: "14px 16px",
            background: "var(--card-soft)",
            borderRadius: 10,
            fontSize: 12.5,
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          Enrichment data not yet available for this fund. It will appear after the next SEC
          ingestion run.
        </div>
      )}

      <PerformanceSection rows={data.performance} />
      <AssetAllocationSection rows={data.assetAllocation} />
      <TopHoldingsSection rows={data.topHoldings} />
      <PortfolioSection rows={data.portfolio} />
      <PortfolioAssetTypeSection rows={data.portfolioAssetType} />
    </div>
  );
}

// ─── Public sheet component ───────────────────────────────────────────────────

export interface FundDetailSheetProps {
  /** The SEC proj_id of the fund to show. null/undefined = closed. */
  projId: string | null;
  onClose: () => void;
}

export function FundDetailSheet({ projId, onClose }: FundDetailSheetProps) {
  if (!projId) return null;

  return (
    <div
      className="sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="sheet" style={{ maxWidth: 640 }}>
        {/* Sheet header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              color: "var(--muted)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Fund Detail
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close fund detail"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <FundDetailBody projId={projId} />
      </div>
    </div>
  );
}
