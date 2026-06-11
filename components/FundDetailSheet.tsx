"use client";

// FundDetailSheet — shows enrichment data for a single fund fetched from
// GET /api/funds/[projId]. Rendered as a sheet overlay (same pattern as
// HoldingSheet / PortfolioSheet).
//
// All five enrichment sections gracefully no-op when their arrays are empty,
// so the sheet looks clean in dev before the SEC ingest job has run.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { NavChart } from "@/components/InteractiveChartsLazy";
import { Modal } from "@/components/Modal";
import { KebabMenu } from "@/components/ui/KebabMenu";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import type {
  FeederLookThroughHoldingRow,
  FeederMasterMapRow,
} from "@/lib/db/queries/feeder-enrichment";
import type {
  FundAssetAllocationRow,
  FundPerformanceRow,
  FundPortfolioAssetTypeRow,
  FundPortfolioRow,
  FundTopHoldingRow,
} from "@/lib/db/queries/fund-enrichment";
import type { FundWithTer } from "@/lib/db/queries/funds";
import type { ShareClass } from "@/lib/db/queries/share-classes";
import { type SeriesRange, useFundSeries } from "@/lib/fetchers/portfolio";
import { useResource } from "@/lib/fetchers/swr";
import {
  fmtNavPct,
  fmtPct,
  formatYearMonth,
  perfTypeLabel,
  periodSortKey,
} from "@/lib/fund-detail-format";
import { seriesReturnPct } from "@/lib/portfolio/adapter";
import { buildHoldingDetailRows } from "@/lib/portfolio/holding-detail";
import {
  buildPortfolioGroups,
  type PortfolioDisplayRow,
  type PortfolioGroup,
} from "@/lib/portfolio/portfolio-display";
import type { Holding } from "@/lib/static/types";
import { useFlipUp } from "@/lib/useFlipUp";
import { useListboxKeyboard } from "@/lib/useListboxKeyboard";
import { useScrollFadeX } from "@/lib/useScrollFadeX";

// ─── API response type ────────────────────────────────────────────────────────

export type FundDetailResponse = FundWithTer & {
  performance: FundPerformanceRow[];
  assetAllocation: FundAssetAllocationRow[];
  topHoldings: FundTopHoldingRow[];
  portfolio: FundPortfolioRow[];
  portfolioAssetType: FundPortfolioAssetTypeRow[];
  /** Master fund mapping if this is a feeder fund. Null when not a feeder or not yet mapped. */
  masterMap: FeederMasterMapRow | null;
  /** Master fund's underlying holdings (feeder look-through). Empty when not available. */
  lookThroughHoldings: FeederLookThroughHoldingRow[];
  /** Priceable share classes of this fund (one per SEC share class). */
  shareClasses: ShareClass[];
  /** Ticker of the class to show first (the opened class, else a heuristic default). */
  selectedClassTicker: string | null;
};

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
  // Custom scrollbar (os-theme-macrotide) + a subtle opacity-fade cue on the
  // horizontal table scroller. See useScrollFadeX: the OS instance nests fine
  // below the Modal.Body's own OS viewport and tears down on unmount.
  const perfScrollRef = useScrollFadeX("Performance and risk table");

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
      <div ref={perfScrollRef} style={{ overflowX: "auto", paddingBottom: 10 }}>
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
          const barWidth = total > 0 ? Math.max(0, Math.min(100, (pct / total) * 100)) : 0;
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
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const scrollRef = useScrollFadeX("Portfolio holdings table");
  if (rows.length === 0) return null;

  // Group holdings by SEC asset category (a subheader per category); within a
  // group, anonymous derivative ladders (FX forwards) still collapse to net rows.
  const groups = buildPortfolioGroups(rows);
  const totalHoldings = groups.reduce((sum, g) => sum + g.rows.length, 0);

  // Preview: the first PORTFOLIO_PREVIEW holdings across groups (each kept under
  // its category header) until expanded.
  let budget = expanded ? Number.POSITIVE_INFINITY : PORTFOLIO_PREVIEW;
  // `multi` tracks the FULL group size (before the preview slice) so the group
  // total %NAV shows whenever the category aggregates >1 holding, even if the
  // preview only renders one of its rows.
  const shownGroups: (PortfolioGroup & { multi: boolean })[] = [];
  for (const g of groups) {
    if (budget <= 0) break;
    const groupRows = expanded ? g.rows : g.rows.slice(0, budget);
    budget -= groupRows.length;
    shownGroups.push({ ...g, rows: groupRows, multi: g.rows.length > 1 });
  }
  const hidden = totalHoldings - shownGroups.reduce((s, g) => s + g.rows.length, 0);

  // derive the period label from the first row
  const period = rows[0]?.period;
  const periodLabel = formatYearMonth(period);

  const cellBorder = "1px solid var(--line-soft)";

  // Column headers kept for screen readers but visually hidden — the ticker /
  // ISIN / %NAV values are self-describing, so the visible header row was just
  // chrome stacked under the section title.
  const srOnly: React.CSSProperties = {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
    border: 0,
  };

  // Render one holding row, plus its member rows when an expanded collapse group.
  const renderRow = (row: PortfolioDisplayRow) => {
    const isGroup = (row.members?.length ?? 0) > 0;
    const isOpen = isGroup && openGroups.has(row.key);
    const toggle = () =>
      setOpenGroups((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      });
    const main = (
      <tr key={row.key}>
        <td
          style={{
            // Label starts at 14px whether or not there's a toggle — the arrow
            // sits in the indent gutter (fixed 12px slot) instead of pushing it.
            padding: isGroup ? "4px 4px 4px 2px" : "4px 4px 4px 14px",
            color: "var(--ink-soft)",
            fontSize: 11.5,
            borderBottom: cellBorder,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            cursor: isGroup ? "pointer" : undefined,
          }}
          title={[row.label, row.issuer, row.category].filter(Boolean).join(" · ") || undefined}
          onClick={isGroup ? toggle : undefined}
        >
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
            {isGroup && (
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  textAlign: "center",
                  marginRight: 2,
                  color: "var(--muted)",
                }}
              >
                {isOpen ? "▾" : "▸"}
              </span>
            )}
            {row.label}
          </span>
          {row.issuer && (
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
            borderBottom: cellBorder,
            whiteSpace: "nowrap",
          }}
        >
          {row.isin ?? "—"}
        </td>
        <td
          style={{
            padding: "4px 4px",
            textAlign: "right",
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            fontWeight: 500,
            color: "var(--ink)",
            borderBottom: cellBorder,
            whiteSpace: "nowrap",
          }}
        >
          {fmtNavPct(row.percentNav)}
        </td>
      </tr>
    );
    if (!isOpen || !row.members) return [main];
    const memberRows = row.members.map((m) => (
      <tr key={`${row.key}-${m.id}`} style={{ background: "var(--surface-2, transparent)" }}>
        <td
          style={{
            padding: "3px 4px 3px 28px",
            color: "var(--muted)",
            fontSize: 10.5,
            borderBottom: cellBorder,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {m.issueCode ?? m.issuer ?? m.assetliabDesc ?? "—"}
        </td>
        <td style={{ borderBottom: cellBorder }} />
        <td
          style={{
            padding: "3px 4px",
            textAlign: "right",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--muted)",
            borderBottom: cellBorder,
            whiteSpace: "nowrap",
          }}
        >
          {fmtNavPct(m.percentNav)}
        </td>
      </tr>
    ));
    return [main, ...memberRows];
  };

  return (
    <>
      <SectionHeader
        title={`Portfolio${periodLabel ? ` (${periodLabel})` : ""} · ${totalHoldings} holdings`}
      />
      <div ref={scrollRef} style={{ overflowX: "auto", paddingBottom: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              <th scope="col" style={srOnly}>
                Name / Issuer
              </th>
              <th scope="col" style={srOnly}>
                ISIN
              </th>
              <th scope="col" style={srOnly}>
                %NAV
              </th>
            </tr>
          </thead>
          <tbody>
            {shownGroups.flatMap((g, gi) => [
              // Category subheader — real columns so the label lines up with the
              // holding names (left) and the group total with the %NAV column
              // (right). Sans (inherited): var(--font-mono) has no Thai glyphs and
              // falls back to an ugly serif. The total shows only when the category
              // aggregates >1 holding (else it just repeats the single row's %NAV).
              <tr key={`cat-${g.category}`}>
                <td
                  style={{
                    padding: gi === 0 ? "4px 4px 4px" : "12px 4px 4px",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--muted)",
                    borderBottom: cellBorder,
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.category}
                </td>
                <td
                  style={{
                    padding: gi === 0 ? "4px 4px 4px" : "12px 4px 4px",
                    borderBottom: cellBorder,
                  }}
                />
                <td
                  style={{
                    padding: gi === 0 ? "4px 4px 4px" : "12px 4px 4px",
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--muted)",
                    borderBottom: cellBorder,
                    whiteSpace: "nowrap",
                  }}
                >
                  {g.multi ? fmtNavPct(g.totalPct) : ""}
                </td>
              </tr>,
              ...g.rows.flatMap(renderRow),
            ])}
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
          Show all {totalHoldings} holdings ↓
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
  const periodLabel = formatYearMonth(period);

  return (
    <>
      <SectionHeader title={`Asset-Type Breakdown${periodLabel ? ` (${periodLabel})` : ""}`} />
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {rows.map((row) => {
          const pct = row.percentNav ?? 0;
          const barWidth = total > 0 ? Math.max(0, Math.min(100, (pct / total) * 100)) : 0;
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

// ─── 6. Feeder fund look-through ──────────────────────────────────────────────

const LOOK_THROUGH_PREVIEW = 20;

function LookThroughSection({
  masterMap,
  rows,
}: {
  masterMap: FeederMasterMapRow | null;
  rows: FeederLookThroughHoldingRow[];
}) {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useScrollFadeX("Look-through holdings table");
  if (!masterMap && rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, LOOK_THROUGH_PREVIEW);
  const hidden = rows.length - LOOK_THROUGH_PREVIEW;

  const asOfDate = rows[0]?.asOfDate;
  const masterLabel = masterMap?.masterName ?? masterMap?.masterIsin ?? "Master Fund";

  return (
    <>
      <SectionHeader
        title={`Look-Through Holdings${asOfDate && asOfDate !== "unknown" ? ` (as of ${asOfDate})` : ""}`}
      />
      {masterMap && (
        <div
          style={{
            fontSize: 11.5,
            color: "var(--ink-soft)",
            marginBottom: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          Master fund: <span style={{ color: "var(--ink)", fontWeight: 500 }}>{masterLabel}</span>
          {masterMap.masterIsin && masterMap.masterName && (
            <span style={{ color: "var(--muted)" }}>
              {" · "}
              {masterMap.masterIsin}
            </span>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <div
          style={{
            padding: "10px 0",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          Master fund holdings not yet fetched. Enable{" "}
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              background: "var(--card-soft)",
              padding: "1px 4px",
              borderRadius: 4,
            }}
          >
            EXTERNAL_INGEST_FEEDER_HOLDINGS=1
          </code>{" "}
          and re-run the catalog refresh.
        </div>
      ) : (
        <>
          <div ref={scrollRef} style={{ overflowX: "auto", paddingBottom: 10 }}>
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
                    #
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
                    }}
                  >
                    Name
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
                    Ticker
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
                    Weight
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.rank}>
                    <td
                      style={{
                        padding: "4px 4px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "var(--muted)",
                        borderBottom: "1px solid var(--line-soft)",
                        whiteSpace: "nowrap",
                        minWidth: 22,
                      }}
                    >
                      {row.rank}
                    </td>
                    <td
                      style={{
                        padding: "4px 4px",
                        color: "var(--ink-soft)",
                        fontSize: 11.5,
                        borderBottom: "1px solid var(--line-soft)",
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={row.name}
                    >
                      <span
                        style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}
                      >
                        {row.name}
                      </span>
                      {row.assetClass && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--muted)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {row.assetClass}
                        </span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "4px 4px",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--ink-soft)",
                        borderBottom: "1px solid var(--line-soft)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.ticker ||
                        (row.isin ? (
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>{row.isin}</span>
                        ) : (
                          "—"
                        ))}
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
                      {fmtNavPct(row.weightPct)}
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
      )}
    </>
  );
}

// ─── Loading / error states ───────────────────────────────────────────────────

function LoadingState() {
  // Sheet-shaped placeholder: title block, range pills, chart, info rows.
  return (
    <div aria-hidden>
      <Skeleton width="58%" height={18} />
      <Skeleton width="36%" height={12} style={{ marginTop: 8 }} />
      <div style={{ display: "flex", gap: 6, marginTop: 18 }}>
        {[44, 44, 44, 44].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          <Skeleton key={i} width={w} height={22} radius={11} />
        ))}
      </div>
      <Skeleton height={140} style={{ marginTop: 12 }} />
      <SkeletonRows rows={3} height={44} padding="16px 0 0" />
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

// Class switcher for the fund header: the ticker stays the title, with a small
// chevron that opens a popover list of sibling classes. Keeps the original
// headline style instead of a boxy native <select>.
function ClassPicker({
  classes,
  selectedTicker,
  headlineTicker,
  headlineFont,
  onSelect,
}: {
  classes: ShareClass[];
  selectedTicker: string | null;
  headlineTicker: string;
  headlineFont: React.CSSProperties;
  onSelect: (ticker: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { up, measure } = useFlipUp(ref);
  const onKeyDown = useListboxKeyboard({
    open,
    setOpen,
    listRef,
    triggerRef,
    onBeforeOpen: measure,
  });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Move focus into the list on open (the selected option, or the first).
  useEffect(() => {
    if (!open) return;
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const selected = opts.find((o) => o.getAttribute("aria-selected") === "true");
    (selected ?? opts[0])?.focus();
  }, [open]);

  return (
    <div ref={ref} onKeyDown={onKeyDown} style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Share class — ${headlineTicker}, change`}
        onClick={() => {
          if (!open) measure();
          setOpen((o) => !o);
        }}
        style={{
          ...headlineFont,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
        }}
      >
        {headlineTicker}
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" }}
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: up ? "auto" : "calc(100% + 4px)",
            bottom: up ? "calc(100% + 4px)" : "auto",
            left: 0,
            zIndex: 20,
            minWidth: 200,
            maxHeight: 260,
            overflowY: "auto",
            background: "var(--bg)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            padding: 4,
          }}
        >
          {classes.map((c) => (
            <button
              key={c.ticker}
              type="button"
              role="option"
              aria-selected={c.ticker === selectedTicker}
              onClick={() => {
                onSelect(c.ticker);
                setOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 10px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                fontSize: 12.5,
                fontFamily: "var(--font-mono)",
                color: "var(--ink)",
                background: c.ticker === selectedTicker ? "var(--accent-soft)" : "transparent",
              }}
            >
              {classOptionLabel(c)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FundHeader({
  fund,
  shareClasses,
  selectedTicker,
  onSelectClass,
}: {
  fund: FundDetailResponse;
  shareClasses: ShareClass[];
  selectedTicker: string | null;
  onSelectClass: (ticker: string) => void;
}) {
  const headlineTicker = selectedTicker ?? fund.abbrName ?? fund.projId;
  const name = fund.englishName ?? fund.thaiName ?? fund.abbrName ?? fund.projId;
  const amc = fund.amcName;
  const multi = shareClasses.length > 1;

  // Per-class facts: TER and distribution come from the selected class, falling
  // back to the parent's derived TER for single-class funds.
  const selected = shareClasses.find((c) => c.ticker === selectedTicker) ?? null;
  const ter = selected?.currentTer ?? fund.ter;
  const dist = selected?.distributionPolicy;

  const headlineFont: React.CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "var(--ink)",
  };

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {multi ? (
          // The class IS what you're viewing — keep the ticker as the title and
          // hang a chevron menu off it to switch classes.
          <ClassPicker
            classes={shareClasses}
            selectedTicker={selectedTicker}
            headlineTicker={headlineTicker}
            headlineFont={headlineFont}
            onSelect={onSelectClass}
          />
        ) : (
          <span style={headlineFont}>{headlineTicker}</span>
        )}
        {ter != null && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              fontWeight: 600,
              color:
                ter <= 0.5 ? "var(--gain)" : ter <= 1.5 ? "var(--amber, #d89a1f)" : "var(--loss)",
              background:
                ter <= 0.5
                  ? "var(--gain-soft, rgba(16,168,107,0.1))"
                  : ter <= 1.5
                    ? "var(--amber-soft, rgba(216,154,31,0.1))"
                    : "var(--loss-soft, rgba(209,69,69,0.08))",
              borderRadius: 6,
              padding: "2px 7px",
            }}
          >
            TER {ter.toFixed(2)}%
          </span>
        )}
        {dist && (
          <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
            {dist === "accumulating" ? "Accumulating" : "Dividend"}
          </span>
        )}
      </div>
      {name !== headlineTicker && (
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

// ─── Holding fallback (non-catalog positions: stocks, indices, cash) ──────────
// Shown when a holding has no matching catalog fund, so there's no SEC
// enrichment to render. Displays the holding's own stored data so tapping a
// stock/index/cash row still opens a useful read-only view instead of an error.

function HoldingFallbackBody({ holding }: { holding: Holding }) {
  const rows = buildHoldingDetailRows(holding);
  return (
    <div>
      <div style={{ marginBottom: 4 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: "var(--ink)",
          }}
        >
          {holding.ticker}
        </span>
        {holding.thai && (
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>{holding.thai}</div>
        )}
      </div>

      <SectionHeader title="Holding" />
      <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
            }}
          >
            <dt
              style={{
                fontSize: 11.5,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
              }}
            >
              {row.label}
            </dt>
            <dd
              style={{
                margin: 0,
                fontSize: 12.5,
                color: "var(--ink)",
                textAlign: "right",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>

      <div
        style={{
          marginTop: 16,
          fontSize: 11.5,
          color: "var(--muted)",
          lineHeight: 1.5,
        }}
      >
        This position isn't a fund in the SEC catalog, so factsheet enrichment (performance,
        allocation, holdings) isn't available. Use Edit to update its details.
      </div>
    </div>
  );
}

// ─── Detail body (fetches + renders all sections) ─────────────────────────────

// Range pills for the NAV chart, mapping a short UI label to a SeriesRange the
// /series route understands.
const NAV_RANGES: { lbl: string; range: SeriesRange }[] = [
  { lbl: "1M", range: "1mo" },
  { lbl: "3M", range: "3mo" },
  { lbl: "6M", range: "6mo" },
  { lbl: "1Y", range: "1y" },
  { lbl: "All", range: "max" },
];

const fmtNav = (n: number) =>
  `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const fmtAum = (n: number) => {
  if (n >= 1e9) return `฿${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `฿${(n / 1e6).toFixed(1)}M`;
  return `฿${Math.round(n).toLocaleString("en-US")}`;
};

// NAV and AUM are genuinely different curves; "return" is just NAV rescaled
// (same shape), so it isn't a separate tab — the NAV tooltip reads both the
// price and the % change since the window start.
type ChartMode = "nav" | "aum";
const CHART_MODES: { key: ChartMode; lbl: string }[] = [
  { key: "nav", lbl: "Price" },
  { key: "aum", lbl: "Fund size" },
];

// Short label for a share-class option: ticker + distribution + investor type.
// Used by the class selector in the fund header.
function classOptionLabel(c: ShareClass): string {
  const bits: string[] = [c.ticker];
  if (c.distributionPolicy === "accumulating") bits.push("Acc");
  else if (c.distributionPolicy === "dividend") bits.push("Div");
  if (c.investorType === "institutional") bits.push("Institutional");
  else if (c.investorType === "insurance") bits.push("Insurance-linked");
  return bits.join(" · ");
}

/**
 * NAV / fund-size (AUM) history for one share class. The displayed class is
 * controlled by the header's class selector (`ticker`); NAV mode's tooltip also
 * reads the cumulative % return since the window start. Renders its own empty
 * state when no history is cached yet — graceful for new / sparsely-crawled funds.
 */
function FundNavChartSection({ ticker }: { ticker: string | null }) {
  const [range, setRange] = useState<SeriesRange>("1y");
  const [mode, setMode] = useState<ChartMode>("nav");
  const { data, isLoading } = useFundSeries(ticker, range);

  const series = data?.series ?? [];
  const chartData =
    mode === "aum"
      ? series.flatMap((p) => (p.aum != null ? [{ d: p.d, v: p.aum }] : []))
      : series.map((p) => ({ d: p.d, v: p.v }));

  const emptyHint = isLoading
    ? "Loading fund history…"
    : mode === "aum"
      ? "Fund-size history isn't available for this fund yet."
      : "Price history isn't available for this fund yet.";

  const periodReturn = seriesReturnPct(chartData);

  return (
    <section style={{ marginTop: 16 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="range-pills">
          {NAV_RANGES.map((r) => (
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
        <div className="range-pills">
          {CHART_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              data-active={mode === m.key}
              onClick={() => setMode(m.key)}
            >
              {m.lbl}
            </button>
          ))}
        </div>
      </div>
      {periodReturn != null && (
        <span
          className={`delta-pill${periodReturn < 0 ? " down" : ""}`}
          style={{ fontSize: 13, marginTop: 4 }}
        >
          {fmtPct(periodReturn)}
        </span>
      )}
      <NavChart
        data={chartData}
        height={140}
        accent="var(--accent)"
        valueFormatter={mode === "aum" ? fmtAum : fmtNav}
        seriesLabel={mode === "aum" ? "Fund size" : "Price"}
        showReturnInTooltip={mode === "nav"}
        emptyHint={emptyHint}
      />
    </section>
  );
}

function FundDetailBody({ projId, holding }: { projId: string; holding?: Holding | null }) {
  const { data, isLoading, error } = useResource<FundDetailResponse>(
    projId ? `/api/funds/${encodeURIComponent(projId)}` : null,
  );
  // The selected share class, lifted here so the header selector drives the
  // chart. Null until the user picks one → falls back to the server's default.
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  if (isLoading) return <LoadingState />;
  // No catalog match (a stock/index/cash holding, or a 404). When we opened this
  // from a holding, degrade to the holding's own data rather than erroring.
  if (error || !data) {
    if (holding) return <HoldingFallbackBody holding={holding} />;
    return <ErrorState message={error?.message} />;
  }

  const hasAnyEnrichment =
    data.performance.length > 0 ||
    data.assetAllocation.length > 0 ||
    data.topHoldings.length > 0 ||
    data.portfolio.length > 0 ||
    data.portfolioAssetType.length > 0 ||
    data.masterMap != null ||
    data.lookThroughHoldings.length > 0;

  const shareClasses = data.shareClasses ?? [];
  const activeTicker = selectedTicker ?? data.selectedClassTicker ?? null;

  return (
    <div>
      <FundHeader
        fund={data}
        shareClasses={shareClasses}
        selectedTicker={activeTicker}
        onSelectClass={setSelectedTicker}
      />

      <FundNavChartSection ticker={activeTicker} />

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
      {(data.masterMap != null || data.lookThroughHoldings.length > 0) && (
        <LookThroughSection masterMap={data.masterMap} rows={data.lookThroughHoldings} />
      )}
    </div>
  );
}

// ─── Public sheet component ───────────────────────────────────────────────────

export interface FundDetailSheetProps {
  /**
   * What to look up. Either the SEC proj_id of a fund (Explore) or a portfolio
   * holding (whose bare ticker is matched against the catalog's abbr_name).
   * null/undefined = closed.
   */
  projId?: string | null;
  /**
   * The held position, when opened from the Portfolio screen. Its ticker drives
   * the catalog lookup; if no fund matches, the sheet falls back to the
   * holding's own data instead of showing an error.
   */
  holding?: Holding | null;
  /**
   * When set (holding view only), renders an Edit affordance that hands off to
   * the holding edit flow. Omit for the read-only Explore usage.
   */
  onEdit?: () => void;
  /** When set (holding view), the kebab offers "Position" → the position page. */
  onHistory?: () => void;
  /**
   * When set, the sheet shows an "Ask Advisor" action that hands the shown class
   * ticker back to the caller (Explore wires this to the Advisor screen). Omit to
   * hide it (e.g. the holding view).
   */
  onAskAdvisor?: (ticker: string) => void;
  onClose: () => void;
}

export function FundDetailSheet({
  projId,
  holding,
  onEdit,
  onHistory,
  onAskAdvisor,
  onClose,
}: FundDetailSheetProps) {
  // A holding looks up the catalog by its ticker (= abbr_name); Explore passes a
  // proj_id directly. One of the two is set when the sheet is open.
  const lookupId = projId ?? holding?.ticker ?? null;
  const open = lookupId != null;

  // Hand the fund to the Advisor. Prefer the caller's handler (Explore wires a
  // richer one); otherwise fall back to the app-wide `ai-prompt` event — the
  // same channel the rest of the app uses — so the holding view works without
  // threading a prop through the Portfolio screen.
  const askAdvisor = (ticker: string) => {
    if (onAskAdvisor) {
      onAskAdvisor(ticker);
      return;
    }
    const prompt = `Tell me about ${ticker} — is it a good low-fee option for my portfolio, and are there cheaper alternatives?`;
    window.dispatchEvent(
      new CustomEvent("ai-prompt", {
        detail: {
          display: prompt,
          send: prompt,
          context: { screen: "funds", intent: "fund_lookup", subject: ticker },
        },
      }),
    );
  };

  return (
    <Modal open={open} onClose={onClose} variant="detail" labelledBy="fund-detail-title">
      <Modal.Header
        title={holding ? "Holding detail" : "Fund detail"}
        id="fund-detail-title"
        action={
          // Ask + (holding) Edit, both 28px icon-btns so they line up with the ✕.
          lookupId ? (
            <>
              <button
                type="button"
                className="icon-btn"
                title="Ask Advisor"
                aria-label={`Ask Advisor about ${lookupId}`}
                onClick={() => askAdvisor(lookupId)}
                style={{ marginTop: -4 }}
              >
                <Icon name="chat" size={15} />
              </button>
              {onEdit && (
                <div style={{ marginTop: -4 }}>
                  <KebabMenu
                    label="Holding actions"
                    size={18}
                    triggerClassName="icon-btn"
                    items={[
                      ...(onHistory ? [{ label: "Position", onClick: onHistory }] : []),
                      { label: "Edit holding", onClick: onEdit },
                    ]}
                  />
                </div>
              )}
            </>
          ) : undefined
        }
      />
      <Modal.Body>{open && <FundDetailBody projId={lookupId} holding={holding} />}</Modal.Body>
    </Modal>
  );
}
