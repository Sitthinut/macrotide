"use client";

// FundSelect — the "Select" pillar's fund finder panel.
//
// Lets the user pick a target exposure (asset class, free-text search, index-only
// toggle, tax wrapper, and region) and see matching Thai-registered funds ranked
// CHEAPEST FIRST by TER. Fee is the visual hero: the TER badge is the headline on
// every row, styled to make the cost of each fund immediately legible.
//
// Wired through GET /api/funds, which calls findFunds() — the same query the
// find_funds advisor tool uses. A small demo seed ensures the list is non-empty
// in demo mode before the daily SEC refresh has run.

import { useEffect, useState } from "react";
import { FundDetailSheet } from "@/components/FundDetailSheet";
import { Icon } from "@/components/Icon";
import type { FundWithTer } from "@/lib/db/queries/funds";
import { useResource } from "@/lib/fetchers/swr";

// ─── filter state ────────────────────────────────────────────────────────────

type AssetClassFilter = "equity" | "bond" | "alternative" | "cash" | "";
type TaxIncentiveFilter = "SSF" | "ThaiESG" | "RMF" | "";
type RegionFilter = "foreign" | "domestic" | "mixed" | "";

const ASSET_CLASS_OPTIONS: { value: AssetClassFilter; label: string }[] = [
  { value: "", label: "All classes" },
  { value: "equity", label: "Equity" },
  { value: "bond", label: "Bond" },
  { value: "alternative", label: "Alternative" },
  { value: "cash", label: "Cash" },
];

const TAX_INCENTIVE_OPTIONS: { value: TaxIncentiveFilter; label: string; title: string }[] = [
  {
    value: "SSF",
    label: "SSF",
    title: "Super Savings Fund — deduct up to 30% of income (max 200,000 THB/yr)",
  },
  {
    value: "ThaiESG",
    label: "Thai ESG",
    title: "Thai ESG Fund — deduct up to 30% of income (max 300,000 THB/yr)",
  },
  {
    value: "RMF",
    label: "RMF",
    title: "Retirement Mutual Fund — deduct up to 30% of income (max 500,000 THB/yr)",
  },
];

const REGION_OPTIONS: { value: RegionFilter; label: string }[] = [
  { value: "foreign", label: "Foreign" },
  { value: "domestic", label: "Domestic" },
  { value: "mixed", label: "Mixed" },
];

// ─── fetcher ─────────────────────────────────────────────────────────────────

function buildUrl(
  assetClass: AssetClassFilter,
  query: string,
  indexOnly: boolean,
  taxIncentive: TaxIncentiveFilter,
  region: RegionFilter,
): string {
  const params = new URLSearchParams();
  if (assetClass) params.set("assetClass", assetClass);
  if (query.trim()) params.set("query", query.trim());
  if (indexOnly) params.set("indexOnly", "1");
  if (taxIncentive) params.set("taxIncentive", taxIncentive);
  if (region) params.set("region", region);
  params.set("limit", "30");
  const qs = params.toString();
  return qs ? `/api/funds?${qs}` : "/api/funds";
}

function useFunds(
  assetClass: AssetClassFilter,
  query: string,
  indexOnly: boolean,
  taxIncentive: TaxIncentiveFilter,
  region: RegionFilter,
) {
  const url = buildUrl(assetClass, query, indexOnly, taxIncentive, region);
  return useResource<FundWithTer[]>(url);
}

// ─── TER badge ───────────────────────────────────────────────────────────────
// TER is the controllable edge — it's the headline number on every row.

function TerBadge({ ter }: { ter: number | null }) {
  if (ter == null) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          background: "var(--surface)",
          border: "1px solid var(--line-soft)",
          borderRadius: 6,
          padding: "2px 7px",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        TER –
      </span>
    );
  }

  // Colour-code by fee level: green ≤ 0.5%, amber 0.5–1.5%, red > 1.5%.
  const color = ter <= 0.5 ? "var(--gain)" : ter <= 1.5 ? "var(--amber, #f59e0b)" : "var(--loss)";
  const bg =
    ter <= 0.5
      ? "var(--gain-soft, rgba(34,197,94,0.1))"
      : ter <= 1.5
        ? "var(--amber-soft, rgba(245,158,11,0.1))"
        : "var(--loss-soft, rgba(220,38,38,0.08))";

  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 600,
        color,
        background: bg,
        borderRadius: 6,
        padding: "2px 7px",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {ter.toFixed(2)}%
    </span>
  );
}

// ─── compact fund badges ──────────────────────────────────────────────────────

function MiniTag({
  label,
  title,
  color = "var(--accent)",
  bg = "var(--accent-soft)",
  clamp = false,
}: {
  label: string;
  title?: string;
  color?: string;
  bg?: string;
  clamp?: boolean;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: 9.5,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        color,
        background: bg,
        borderRadius: 4,
        padding: "1px 5px",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        // A long feeder master-fund name would otherwise overflow the card and
        // trigger a horizontal scrollbar. Clamp it with an ellipsis (the full
        // name stays in the title tooltip); minWidth:0 lets it shrink as a flex
        // item, and it wraps to its own line when it can't fit alongside others.
        ...(clamp ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" } : null),
      }}
    >
      {label}
    </span>
  );
}

function FundBadges({ fund }: { fund: FundWithTer }) {
  const isIndex = fund.managementStyle === "PN" || fund.managementStyle === "PM";
  const tax = fund.taxIncentiveType;
  const isFeeder = fund.isFeederFund;

  if (!isIndex && !tax && !isFeeder) return null;

  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, minWidth: 0 }}>
      {isIndex && (
        <MiniTag
          label="INDEX"
          title={`Management style: ${fund.managementStyle} — passive/index-tracking`}
          color="var(--gain)"
          bg="var(--gain-soft, rgba(34,197,94,0.1))"
        />
      )}
      {tax && (
        <MiniTag
          label={tax}
          title={
            tax === "SSF"
              ? "Super Savings Fund — tax deductible up to 30% of income"
              : tax === "ThaiESG"
                ? "Thai ESG Fund — tax deductible up to 30% of income"
                : "Retirement Mutual Fund — tax deductible up to 30% of income"
          }
          color="var(--accent)"
          bg="var(--accent-soft)"
        />
      )}
      {isFeeder && (
        <MiniTag
          label={fund.feederMasterFund ? `FEEDER → ${fund.feederMasterFund}` : "FEEDER"}
          title={
            fund.feederMasterFund
              ? `Feeder fund — invests in ${fund.feederMasterFund}`
              : "Feeder fund — invests in an offshore master fund"
          }
          color="var(--muted)"
          bg="var(--surface)"
          clamp
        />
      )}
    </span>
  );
}

// ─── fund row ────────────────────────────────────────────────────────────────

function FundRow({
  fund,
  rank,
  onAskAdvisor,
  onSelect,
}: {
  fund: FundWithTer;
  rank: number;
  onAskAdvisor: (abbr: string) => void;
  onSelect: (projId: string) => void;
}) {
  const abbr = fund.abbrName ?? fund.projId;
  const name = fund.englishName ?? fund.thaiName ?? abbr;
  const amc = fund.amcName;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "11px 14px",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      {/* Main click target — opens the fund detail sheet. A button so it is
          keyboard-focusable; styled to be visually invisible (the row itself
          carries the visual chrome). Sibling of the advisor button — never
          nested, so the markup stays valid. */}
      <button
        type="button"
        aria-label={`View details for ${abbr}`}
        onClick={() => onSelect(fund.projId)}
        style={{
          display: "flex",
          alignItems: "flex-start",
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
        {/* Rank badge — emphasises the cheapest-first ordering */}
        <div
          style={{
            minWidth: 22,
            height: 22,
            borderRadius: 11,
            background: rank === 1 ? "var(--accent)" : "var(--surface)",
            color: rank === 1 ? "var(--accent-fg, #fff)" : "var(--muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            marginTop: 1,
            flexShrink: 0,
          }}
        >
          {rank}
        </div>

        {/* Fund identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 7,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--ink)",
              }}
            >
              {abbr}
            </span>
            {/* TER is the headline — placed right next to the ticker */}
            <TerBadge ter={fund.ter} />
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={name}
          >
            {name}
          </div>
          {amc && (
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.02em",
                marginTop: 1,
                opacity: 0.7,
              }}
            >
              {amc}
            </div>
          )}
          {/* Compact property badges: index, tax wrapper, feeder */}
          <FundBadges fund={fund} />
        </div>
      </button>

      {/* Ask advisor shortcut — sibling of the main button, not nested. */}
      <button
        type="button"
        className="icon-btn"
        title={`Ask advisor about ${abbr}`}
        aria-label={`Ask advisor about ${abbr}`}
        onClick={() => onAskAdvisor(abbr)}
        style={{ marginTop: 2, flexShrink: 0 }}
      >
        <Icon name="chat" size={13} />
      </button>
    </div>
  );
}

// ─── empty + loading states ───────────────────────────────────────────────────

function EmptyState({ query, isLoading }: { query: string; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div
        style={{
          padding: "24px 16px",
          textAlign: "center",
          color: "var(--muted)",
          fontSize: 13,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.02em",
        }}
      >
        Searching…
      </div>
    );
  }
  return (
    <div
      style={{
        padding: "28px 16px",
        textAlign: "center",
        color: "var(--muted)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 6 }}>No funds found</div>
      {query && (
        <div style={{ fontSize: 12 }}>Try a shorter search term, or clear the filters above.</div>
      )}
      {!query && (
        <div style={{ fontSize: 12 }}>
          The fund catalog is populated by the daily SEC refresh job. Seed data is available in demo
          mode.
        </div>
      )}
    </div>
  );
}

// ─── fee legend ──────────────────────────────────────────────────────────────

function FeeLegend() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        borderTop: "1px solid var(--line-soft)",
        borderBottom: "1px solid var(--line-soft)",
        background: "var(--surface)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "var(--muted)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.04em",
        }}
      >
        TER
      </span>
      {[
        { label: "≤ 0.5%", color: "var(--gain)" },
        { label: "≤ 1.5%", color: "var(--amber, #f59e0b)" },
        { label: "> 1.5%", color: "var(--loss)" },
      ].map((s) => (
        <span key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              background: s.color,
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{s.label}</span>
        </span>
      ))}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: "var(--muted)" }}>cheapest first</span>
    </div>
  );
}

// ─── chip button helper ───────────────────────────────────────────────────────

function ChipButton({
  label,
  active,
  onClick,
  title,
  size = "sm",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
  size?: "sm" | "xs";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: size === "xs" ? "3px 8px" : "4px 10px",
        borderRadius: size === "xs" ? 6 : 8,
        border: "1px solid",
        borderColor: active ? "var(--accent)" : "var(--line-soft)",
        background: active ? "var(--accent-soft)" : "var(--paper)",
        fontSize: size === "xs" ? 10.5 : 11.5,
        cursor: "pointer",
        color: active ? "var(--accent-ink)" : "var(--muted)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export interface FundSelectProps {
  /** Called when user taps the chat icon on a fund row. */
  onAskAdvisor?: (prompt: string) => void;
}

export function FundSelect({ onAskAdvisor }: FundSelectProps) {
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("");
  const [indexOnly, setIndexOnly] = useState(false);
  const [taxIncentive, setTaxIncentive] = useState<TaxIncentiveFilter>("");
  const [region, setRegion] = useState<RegionFilter>("");
  const [queryInput, setQueryInput] = useState("");
  // Debounce the search query so we don't fire on every keystroke.
  const [query, setQuery] = useState("");
  // Selected fund for the detail sheet.
  const [detailProjId, setDetailProjId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 280);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const { data: funds, isLoading } = useFunds(assetClass, query, indexOnly, taxIncentive, region);

  const handleAskAdvisor = (abbr: string) => {
    const prompt = `Tell me about ${abbr} — is it a good low-fee option for my portfolio, and are there cheaper alternatives?`;
    if (onAskAdvisor) {
      onAskAdvisor(prompt);
    } else {
      window.dispatchEvent(new CustomEvent("ai-prompt", { detail: prompt }));
    }
  };

  const list = funds ?? [];
  const hasResults = list.length > 0;

  return (
    <>
      <FundDetailSheet projId={detailProjId} onClose={() => setDetailProjId(null)} />
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {/* Filters */}
        <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid var(--line-soft)" }}>
          {/* Free-text search */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--muted)",
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Icon name="search" size={13} />
            </span>
            <input
              className="sheet-input"
              type="search"
              placeholder="Search by name, index, theme… (e.g. S&P 500, gold)"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              style={{ paddingLeft: 30, width: "100%", boxSizing: "border-box" }}
            />
          </div>

          {/* Asset class chips */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 6 }}>
            {ASSET_CLASS_OPTIONS.map((opt) => (
              <ChipButton
                key={opt.value}
                label={opt.label}
                active={assetClass === opt.value}
                onClick={() => setAssetClass(opt.value)}
              />
            ))}
          </div>

          {/* Index-only toggle + region chips on one row */}
          <div
            style={{
              display: "flex",
              gap: 5,
              flexWrap: "wrap",
              marginBottom: 6,
              alignItems: "center",
            }}
          >
            {/* Index-only toggle — the star filter for passive investors */}
            <ChipButton
              label="Index funds only"
              active={indexOnly}
              onClick={() => setIndexOnly((v) => !v)}
              title="Restrict to passive/index-tracking funds (management style PN or PM)"
              size="xs"
            />
            <span
              style={{
                width: 1,
                height: 14,
                background: "var(--line-soft)",
                margin: "0 2px",
                display: "inline-block",
                alignSelf: "center",
              }}
            />
            {REGION_OPTIONS.map((opt) => (
              <ChipButton
                key={opt.value}
                label={opt.label}
                active={region === opt.value}
                onClick={() => setRegion((v) => (v === opt.value ? "" : opt.value))}
                size="xs"
              />
            ))}
          </div>

          {/* Tax wrapper chips */}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
            <span
              style={{
                fontSize: 10,
                color: "var(--muted)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.04em",
                marginRight: 2,
              }}
            >
              Tax
            </span>
            {TAX_INCENTIVE_OPTIONS.map((opt) => (
              <ChipButton
                key={opt.value}
                label={opt.label}
                active={taxIncentive === opt.value}
                onClick={() => setTaxIncentive((v) => (v === opt.value ? "" : opt.value))}
                title={opt.title}
                size="xs"
              />
            ))}
          </div>
        </div>

        {/* Legend bar */}
        <FeeLegend />

        {/* Results count */}
        {hasResults && (
          <div
            style={{
              padding: "6px 14px",
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.04em",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            {list.length} fund{list.length === 1 ? "" : "s"} ·{" "}
            {list.filter((f) => f.ter != null).length} with TER data
            {list.filter((f) => f.managementStyle === "PN" || f.managementStyle === "PM").length >
              0 && (
              <>
                {" "}
                ·{" "}
                {
                  list.filter((f) => f.managementStyle === "PN" || f.managementStyle === "PM")
                    .length
                }{" "}
                index
              </>
            )}
          </div>
        )}

        {/* Fund list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!hasResults ? (
            <EmptyState query={query} isLoading={isLoading} />
          ) : (
            list.map((fund, i) => (
              <FundRow
                key={fund.projId}
                fund={fund}
                rank={i + 1}
                onAskAdvisor={handleAskAdvisor}
                onSelect={setDetailProjId}
              />
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: "8px 14px",
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.45,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          TER (Total Expense Ratio) is the all-in annual fee published by the SEC. Lower is better —
          it compounds against you every year.
        </div>
      </div>
    </>
  );
}

// ─── screen wrapper ───────────────────────────────────────────────────────────
// A standalone screen that can be dropped into the mobile nav or desktop panels.

export interface FundSelectScreenProps {
  onOpenSettings?: () => void;
  showMenu?: boolean;
}

export function FundSelectScreen({ onOpenSettings, showMenu = true }: FundSelectScreenProps) {
  return (
    <div className="screen" style={{ display: "flex", flexDirection: "column" }}>
      <div className="topbar">
        <div className="brand" style={{ flex: 1 }}>
          <span>Explore</span>
        </div>
        {showMenu && onOpenSettings && (
          <button className="icon-btn" aria-label="More" onClick={onOpenSettings}>
            <Icon name="ellipsis-vertical" size={13} />
          </button>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <FundSelect />
      </div>
    </div>
  );
}
