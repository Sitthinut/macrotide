"use client";

// FundSelect — the "Select" pillar's fund finder panel.
//
// Lets the user pick a target exposure (asset class, fund type, free-text search)
// and see matching Thai-registered funds ranked CHEAPEST FIRST by TER. Fee is the
// visual hero: the TER badge is the headline on every row, styled to make the cost
// of each fund immediately legible.
//
// Wired through GET /api/funds, which calls findFunds() — the same query the
// find_funds advisor tool uses. A small demo seed ensures the list is non-empty
// in demo mode before the daily SEC refresh has run.

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { FundWithTer } from "@/lib/db/queries/funds";
import { useResource } from "@/lib/fetchers/swr";

// ─── filter state ────────────────────────────────────────────────────────────

type AssetClassFilter = "equity" | "bond" | "alternative" | "cash" | "";
type FundTypeFilter = "" | "Foreign Investment" | "Fixed Income" | "Property Fund" | "General";

const ASSET_CLASS_OPTIONS: { value: AssetClassFilter; label: string }[] = [
  { value: "", label: "All classes" },
  { value: "equity", label: "Equity" },
  { value: "bond", label: "Bond" },
  { value: "alternative", label: "Alternative" },
  { value: "cash", label: "Cash" },
];

const FUND_TYPE_OPTIONS: { value: FundTypeFilter; label: string }[] = [
  { value: "", label: "All types" },
  { value: "Foreign Investment", label: "Foreign" },
  { value: "Fixed Income", label: "Fixed income" },
  { value: "Property Fund", label: "Property" },
  { value: "General", label: "General" },
];

// ─── fetcher ─────────────────────────────────────────────────────────────────

function buildUrl(assetClass: AssetClassFilter, fundType: FundTypeFilter, query: string): string {
  const params = new URLSearchParams();
  if (assetClass) params.set("assetClass", assetClass);
  if (fundType) params.set("fundType", fundType);
  if (query.trim()) params.set("query", query.trim());
  params.set("limit", "30");
  const qs = params.toString();
  return qs ? `/api/funds?${qs}` : "/api/funds";
}

function useFunds(assetClass: AssetClassFilter, fundType: FundTypeFilter, query: string) {
  const url = buildUrl(assetClass, fundType, query);
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

// ─── fund row ────────────────────────────────────────────────────────────────

function FundRow({
  fund,
  rank,
  onAskAdvisor,
}: {
  fund: FundWithTer;
  rank: number;
  onAskAdvisor: (abbr: string) => void;
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
            {fund.fundType ? ` · ${fund.fundType}` : ""}
          </div>
        )}
      </div>

      {/* Ask advisor shortcut */}
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

// ─── main component ───────────────────────────────────────────────────────────

export interface FundSelectProps {
  /** Called when user taps the chat icon on a fund row. */
  onAskAdvisor?: (prompt: string) => void;
}

export function FundSelect({ onAskAdvisor }: FundSelectProps) {
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("");
  const [fundType, setFundType] = useState<FundTypeFilter>("");
  const [queryInput, setQueryInput] = useState("");
  // Debounce the search query so we don't fire on every keystroke.
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 280);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const { data: funds, isLoading } = useFunds(assetClass, fundType, query);

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
            <Icon name="magnifying-glass" size={13} />
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
            <button
              key={opt.value}
              type="button"
              onClick={() => setAssetClass(opt.value)}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid",
                borderColor: assetClass === opt.value ? "var(--accent)" : "var(--line-soft)",
                background: assetClass === opt.value ? "var(--accent-soft)" : "var(--paper)",
                fontSize: 11.5,
                cursor: "pointer",
                color: assetClass === opt.value ? "var(--accent-ink)" : "var(--muted)",
                fontWeight: assetClass === opt.value ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Fund type chips */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {FUND_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFundType(opt.value)}
              style={{
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: fundType === opt.value ? "var(--accent)" : "var(--line-soft)",
                background: fundType === opt.value ? "var(--accent-soft)" : "var(--paper)",
                fontSize: 10.5,
                cursor: "pointer",
                color: fundType === opt.value ? "var(--accent-ink)" : "var(--muted)",
              }}
            >
              {opt.label}
            </button>
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
        </div>
      )}

      {/* Fund list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {!hasResults ? (
          <EmptyState query={query} isLoading={isLoading} />
        ) : (
          list.map((fund, i) => (
            <FundRow key={fund.projId} fund={fund} rank={i + 1} onAskAdvisor={handleAskAdvisor} />
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
          <span>Select</span>
          <span
            style={{
              marginLeft: 8,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--muted)",
              letterSpacing: "0.06em",
              verticalAlign: "middle",
            }}
          >
            fund finder
          </span>
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
