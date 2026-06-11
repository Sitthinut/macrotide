"use client";

// FundSelect — the "Select" pillar's fund finder panel.
//
// Lets the user pick a target exposure (asset class, free-text search, index-only
// toggle, tax wrapper, and region) and see matching Thai-registered funds ranked
// CHEAPEST FIRST by TER. Fee is the visual hero: the TER badge is the headline on
// every row, styled to make the cost of each fund immediately legible.
//
// Wired through GET /api/fund-classes, which calls findShareClasses() — the
// screener lists priceable SHARE CLASSES (e.g. MDIVA-A, MDIVA-D), since NAV,
// fees, and tax wrapper are all per class. A small demo seed ensures the list is
// non-empty in demo mode before the daily SEC refresh has run.

import { useEffect, useRef, useState } from "react";
import { FundDetailSheet } from "@/components/FundDetailSheet";
import { Icon } from "@/components/Icon";
import { Skeleton } from "@/components/ui/Skeleton";
import type { ShareClassListItem, TrackedIndexFamily } from "@/lib/db/queries/funds";
import { prefetchResource, useResource } from "@/lib/fetchers/swr";
import { matchIndexFamily } from "@/lib/search/index-alias";
import { useFlipUp } from "@/lib/useFlipUp";
import { useListboxKeyboard } from "@/lib/useListboxKeyboard";

// ─── filter state ────────────────────────────────────────────────────────────

type AssetClassFilter = "equity" | "bond" | "alternative" | "cash" | "";
type TaxIncentiveFilter = "SSF" | "ThaiESG" | "RMF" | "";
type RegionFilter = "foreign" | "domestic" | "mixed" | "";
type IndexTypeFilter = "index" | "active" | "";

const INDEX_TYPE_OPTIONS: { value: IndexTypeFilter; label: string; title: string }[] = [
  {
    value: "index",
    label: "Index",
    title: "Passive/index-tracking funds only (management style PN or PM)",
  },
  {
    value: "active",
    label: "Active",
    title: "Actively managed funds (everything that isn't a pure index fund)",
  },
];

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
  indexType: IndexTypeFilter,
  taxIncentive: TaxIncentiveFilter,
  region: RegionFilter,
  trackingIndex: string,
): string {
  const params = new URLSearchParams();
  if (assetClass) params.set("assetClass", assetClass);
  if (query.trim()) params.set("query", query.trim());
  if (indexType) params.set("indexType", indexType);
  if (taxIncentive) params.set("taxIncentive", taxIncentive);
  if (region) params.set("region", region);
  if (trackingIndex) params.set("trackingIndex", trackingIndex);
  params.set("limit", "30");
  const qs = params.toString();
  return qs ? `/api/fund-classes?${qs}` : "/api/fund-classes";
}

function useFunds(
  assetClass: AssetClassFilter,
  query: string,
  indexType: IndexTypeFilter,
  taxIncentive: TaxIncentiveFilter,
  region: RegionFilter,
  trackingIndex: string,
) {
  const url = buildUrl(assetClass, query, indexType, taxIncentive, region, trackingIndex);
  // keepPreviousData: typing or toggling a filter keeps the previous results
  // on screen while the narrowed list loads, instead of flashing to empty.
  return useResource<ShareClassListItem[]>(url, { keepPreviousData: true });
}

/** How many top rows get their detail + series warmed for instant opens. */
const PREFETCH_ROWS = 6;

// ─── TER colour ──────────────────────────────────────────────────────────────
// TER is the controllable edge — the headline number on every row. Shown as
// plain text (like the 1Y return), fee-level colored: green ≤ 0.5%, amber
// 0.5–1.5%, red > 1.5%; muted when unpublished.
function terColor(ter: number | null): string {
  if (ter == null) return "var(--muted)";
  return ter <= 0.5 ? "var(--gain)" : ter <= 1.5 ? "var(--amber, #f59e0b)" : "var(--loss)";
}

function terBg(ter: number | null): string {
  if (ter == null) return "var(--card-soft)";
  return ter <= 0.5
    ? "var(--gain-soft, rgba(34,197,94,0.1))"
    : ter <= 1.5
      ? "var(--amber-soft, rgba(245,158,11,0.1))"
      : "var(--loss-soft, rgba(220,38,38,0.08))";
}

// Grey, bold label ("TER" / "1Y") sitting left of its value.
const METRIC_LABEL_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  fontWeight: 600,
  color: "var(--muted)",
  letterSpacing: "0.04em",
  textAlign: "right",
  whiteSpace: "nowrap",
};

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

// Short asset-class label for the badge row.
const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: "Equity",
  bond: "Bond",
  alternative: "Alt",
  cash: "Cash",
};

// Class-character tags — distribution, index style, tax wrapper. Shown inline to
// the right of the fund name (these qualify the specific share class).
function FundClassTags({ cls }: { cls: ShareClassListItem }) {
  const isIndex = cls.indexType === "index";
  const tax = cls.taxIncentiveType;
  const dist = cls.distributionPolicy;

  if (!dist && !isIndex && !tax) return null;

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, flexShrink: 0 }}>
      {dist === "accumulating" && (
        <MiniTag
          label="ACC"
          title="Accumulating — reinvests income, no cash distributions"
          color="var(--accent)"
          bg="var(--accent-soft)"
        />
      )}
      {dist === "dividend" && (
        <MiniTag
          label="DIV"
          title="Dividend — pays out income as cash distributions"
          color="var(--accent)"
          bg="var(--accent-soft)"
        />
      )}
      {isIndex && (
        <MiniTag
          label="INDEX"
          title={`Management style: ${cls.managementStyle} — passive/index-tracking`}
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
    </span>
  );
}

// Fund-type tags — asset class + feeder master. Their own row below the name.
function FundTypeTags({ cls }: { cls: ShareClassListItem }) {
  const isFeeder = cls.isFeederFund;
  const assetLabel = cls.assetClass ? (ASSET_CLASS_LABELS[cls.assetClass] ?? null) : null;

  if (!isFeeder && !assetLabel) return null;

  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 3, minWidth: 0 }}>
      {assetLabel && (
        <MiniTag
          label={assetLabel}
          title={`Asset class: ${assetLabel}`}
          color="var(--muted)"
          bg="var(--card-soft)"
        />
      )}
      {isFeeder && (
        <MiniTag
          label={cls.feederMasterFund ? `FEEDER → ${cls.feederMasterFund}` : "FEEDER"}
          title={
            cls.feederMasterFund
              ? `Feeder fund — invests in ${cls.feederMasterFund}`
              : "Feeder fund — invests in an offshore master fund"
          }
          color="var(--muted)"
          bg="var(--card-soft)"
          clamp
        />
      )}
    </span>
  );
}

// ─── fund row ────────────────────────────────────────────────────────────────

function FundRow({
  cls,
  rank,
  onSelect,
}: {
  cls: ShareClassListItem;
  rank: number;
  onSelect: (ticker: string) => void;
}) {
  // The class ticker (e.g. "MDIVA-A") is the priceable identity and the headline.
  const ticker = cls.ticker;
  const name = cls.englishName ?? cls.thaiName ?? cls.abbrName ?? ticker;
  const amc = cls.amcName;

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
        aria-label={`View details for ${ticker}`}
        onClick={() => onSelect(ticker)}
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
          {/* Ticker + class-character tags (Acc/Div, Index, tax) on one line */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--ink)",
              }}
            >
              {ticker}
            </span>
            <FundClassTags cls={cls} />
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
          {/* Type tags: asset class + feeder master */}
          <FundTypeTags cls={cls} />
        </div>

        {/* Numbers, right-aligned: a two-column grid so the grey 'TER'/'1Y'
            labels line up over each other and the values share an edge. TER's
            value sits in a fee-level-colored badge; 1Y is gain/loss text. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto auto",
            columnGap: 6,
            rowGap: 3,
            alignItems: "center",
            justifyContent: "end",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          <span style={METRIC_LABEL_STYLE}>TER</span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              color: terColor(cls.ter),
              background: terBg(cls.ter),
              borderRadius: 6,
              padding: "2px 7px",
              whiteSpace: "nowrap",
              justifySelf: "end",
            }}
            title="Total expense ratio (annual fee)"
          >
            {cls.ter != null ? `${cls.ter.toFixed(2)}%` : "–"}
          </span>
          {cls.y1Pct != null && (
            <>
              <span style={METRIC_LABEL_STYLE}>1Y</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: cls.y1Pct >= 0 ? "var(--gain)" : "var(--loss)",
                  whiteSpace: "nowrap",
                  justifySelf: "end",
                  // Match the TER badge's 7px right padding so the two % align.
                  paddingRight: 7,
                }}
                title={`Trailing 1-year return${cls.navAsOf ? ` (as of ${cls.navAsOf})` : ""}`}
              >
                {cls.y1Pct >= 0 ? "+" : ""}
                {cls.y1Pct.toFixed(2)}%
              </span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

// ─── empty + loading states ───────────────────────────────────────────────────

function FundListSkeleton() {
  return (
    <div aria-hidden style={{ padding: "2px 14px" }}>
      {Array.from({ length: 7 }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 0",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
            <Skeleton width="52%" height={13} />
            <Skeleton width="34%" height={10} />
          </div>
          <Skeleton width={62} height={22} radius={6} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ query, isLoading }: { query: string; isLoading: boolean }) {
  if (isLoading) return <FundListSkeleton />;
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

function FeeLegend({ ordering }: { ordering: string }) {
  // Tap "TER ⓘ" to toggle the one-line explainer — works on touch, where the
  // TER badges' hover tooltips never show.
  const [explain, setExplain] = useState(false);
  return (
    <div
      style={{
        borderTop: "1px solid var(--line-soft)",
        borderBottom: "1px solid var(--line-soft)",
        background: "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px" }}>
        <button
          type="button"
          onClick={() => setExplain((v) => !v)}
          aria-expanded={explain}
          title="What is TER?"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
          }}
        >
          TER
          {/* Accent ⓘ = the one interactive thing in the legend row. */}
          <span style={{ color: "var(--accent)", display: "inline-flex" }}>
            <Icon name="info" size={12} />
          </span>
        </button>
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
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.label}</span>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{ordering}</span>
      </div>
      {explain && (
        <div
          style={{ padding: "0 14px 7px", fontSize: 11.5, color: "var(--muted)", lineHeight: 1.45 }}
        >
          TER (Total Expense Ratio) is the all-in annual fee published by the SEC. Lower is better —
          it compounds against you every year.
        </div>
      )}
    </div>
  );
}

// ─── facet dropdowns ──────────────────────────────────────────────────────────

/** One choice in a facet dropdown. */
interface FacetOption {
  value: string;
  /** Menu row content. */
  label: React.ReactNode;
  /** Short trigger-pill text when selected (defaults to `value`). */
  pill?: string;
  title?: string;
}

// One facet as a compact dropdown pill — the mobile-calm alternative to a chip
// per option (five pills replace ~14 always-visible chips). Unset, the pill
// shows the facet NAME ("Class", "Tracks"); set, it shows the chosen value in
// the accent style, so state stays glanceable. Reuses the app's shared
// dropdown behavior (.combobox__list + useFlipUp + useListboxKeyboard), same
// as the benchmark picker.
function FacetDropdown({
  name,
  clearLabel,
  menuLabel,
  title,
  value,
  onChange,
  options,
}: {
  /** Facet name shown on the unset pill ("Class", "Region", …). */
  name: string;
  /** First menu option, clearing the facet ("All classes", "Any index", …). */
  clearLabel: string;
  /** aria-label for the listbox. */
  menuLabel: string;
  /** Trigger tooltip. */
  title?: string;
  /** Selected option value, or "" for no filter. */
  value: string;
  onChange: (value: string) => void;
  options: FacetOption[];
}) {
  const [open, setOpen] = useState(false);
  // Anchor the menu's RIGHT edge to the pill when the pill sits in the right
  // half of the viewport — a left-anchored menu (width up to 340px) would run
  // off-screen on a phone for the rightmost pills.
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { up, measure } = useFlipUp(ref);

  // Measure placement BEFORE the list renders so it never flips or slides
  // after opening.
  const prepare = () => {
    measure();
    const r = ref.current?.getBoundingClientRect();
    setAlignRight(!!r && r.left > window.innerWidth / 2);
  };
  function toggle() {
    if (!open) prepare();
    setOpen((o) => !o);
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // On open, move focus into the list (the selected option, or the first).
  useEffect(() => {
    if (!open) return;
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const selected = opts.find((o) => o.getAttribute("aria-selected") === "true");
    (selected ?? opts[0])?.focus();
  }, [open]);

  const onKeyDown = useListboxKeyboard({
    open,
    setOpen,
    listRef,
    triggerRef,
    onBeforeOpen: prepare,
  });

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const active = !!value;
  const pillText = active ? (options.find((o) => o.value === value)?.pill ?? value) : name;

  return (
    <div ref={ref} onKeyDown={onKeyDown} style={{ position: "relative", display: "inline-flex" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${menuLabel}: ${active ? pillText : "any"}`}
        onClick={toggle}
        title={title}
        style={{
          // Compact chip-styled trigger (xs chip look + a caret). Fixed height
          // so every pill and the clear button share one baseline.
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          height: 24,
          boxSizing: "border-box",
          padding: "0 8px",
          borderRadius: 6,
          border: "1px solid",
          borderColor: active ? "var(--accent)" : "var(--line-soft)",
          background: active ? "var(--accent-soft)" : "var(--paper)",
          fontSize: 11.5,
          cursor: "pointer",
          color: active ? "var(--accent-ink)" : "var(--muted)",
          fontWeight: active ? 600 : 400,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {pillText}
        <span aria-hidden="true" style={{ fontSize: 9, lineHeight: 1 }}>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={menuLabel}
          className="combobox__list facet-menu"
          data-up={up || undefined}
          style={alignRight ? { left: "auto", right: 0 } : undefined}
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="combobox__option"
            onClick={() => pick("")}
          >
            {clearLabel}
          </button>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="combobox__option"
              title={o.title}
              style={
                o.value === value
                  ? { background: "var(--accent-soft)", display: "flex", gap: 8 }
                  : { display: "flex", gap: 8 }
              }
              onClick={() => pick(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The "Tracks" facet: every index family with at least one active index-style
// tracker (live from /api/funds/index-families — most-tracked first, each row
// showing its tracker count).
function TracksFacet({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const { data: families } = useResource<TrackedIndexFamily[]>("/api/funds/index-families");
  return (
    <FacetDropdown
      name="Tracking"
      clearLabel="Any index"
      menuLabel="Tracked index"
      title="Index funds tracking the chosen index, ranked cheapest first"
      value={value}
      onChange={onChange}
      options={(families ?? []).map((f) => ({
        value: f.indexFamily,
        label: (
          <>
            <span style={{ flex: 1 }}>{f.indexFamily}</span>
            <span
              style={{ color: "var(--muted)", fontSize: 10.5, fontFamily: "var(--font-mono)" }}
              title={`${f.trackers} index fund${f.trackers === 1 ? "" : "s"} tracking it`}
            >
              {f.trackers}
            </span>
          </>
        ),
      }))}
    />
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export interface FundSelectProps {
  /** Called when user taps the chat icon on a fund row. */
  onAskAdvisor?: (prompt: string) => void;
}

export function FundSelect({ onAskAdvisor }: FundSelectProps) {
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("");
  const [indexType, setIndexType] = useState<IndexTypeFilter>("");
  const [taxIncentive, setTaxIncentive] = useState<TaxIncentiveFilter>("");
  const [region, setRegion] = useState<RegionFilter>("");
  // "Tracks" facet: canonical index family ("S&P 500") — index-style funds
  // tracking it, ranked cheapest-first by the browse ordering. "" = off.
  const [trackingIndex, setTrackingIndex] = useState("");
  const [queryInput, setQueryInput] = useState("");
  // Debounce the search query so we don't fire on every keystroke.
  const [query, setQuery] = useState("");
  // Selected share-class ticker for the detail sheet. The detail route resolves
  // a class ticker and defaults its chart to that exact class.
  const [detailTicker, setDetailTicker] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 280);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const { data: funds, isLoading } = useFunds(
    assetClass,
    query,
    indexType,
    taxIncentive,
    region,
    trackingIndex,
  );

  // When the search text IS an index name ("sp500", "S&P 500"…), offer the
  // precise facet: text search ranks by relevance and misses feeders whose own
  // name never mentions the index — the facet catches them all, cheapest first.
  const suggestedFamily = matchIndexFamily(query);
  const showTrackSuggestion = !!suggestedFamily && suggestedFamily !== trackingIndex;
  const applyTrackSuggestion = () => {
    if (!suggestedFamily) return;
    setTrackingIndex(suggestedFamily);
    setQueryInput("");
    setQuery("");
  };

  // One-tap reset of everything (facets + search text).
  const anyFilterActive =
    !!assetClass || !!indexType || !!region || !!taxIncentive || !!trackingIndex || !!queryInput;
  const clearAllFilters = () => {
    setAssetClass("");
    setIndexType("");
    setRegion("");
    setTaxIncentive("");
    setTrackingIndex("");
    setQueryInput("");
    setQuery("");
  };

  // Warm the top rows' detail + 1y NAV series in the SWR cache so the first
  // detail-sheet open paints instantly instead of paying a cold fetch. The
  // session-scoped set keeps filter hopping from re-issuing the same warms.
  const prefetched = useRef(new Set<string>());
  useEffect(() => {
    if (!funds) return;
    for (const cls of funds.slice(0, PREFETCH_ROWS)) {
      if (prefetched.current.has(cls.ticker)) continue;
      prefetched.current.add(cls.ticker);
      const id = encodeURIComponent(cls.ticker);
      prefetchResource(`/api/funds/${id}`);
      prefetchResource(`/api/funds/${id}/series?range=1y`);
    }
  }, [funds]);

  const handleAskAdvisor = (ticker: string) => {
    const prompt = `Tell me about ${ticker} — is it a good low-fee option for my portfolio, and are there cheaper alternatives?`;
    if (onAskAdvisor) {
      onAskAdvisor(prompt);
    } else {
      // Tag the fund in focus so the Advisor can look it up directly.
      window.dispatchEvent(
        new CustomEvent("ai-prompt", {
          detail: {
            display: prompt,
            send: prompt,
            context: { screen: "funds", intent: "fund_lookup", subject: ticker },
          },
        }),
      );
    }
  };

  const list = funds ?? [];
  const hasResults = list.length > 0;

  return (
    <>
      <FundDetailSheet
        projId={detailTicker}
        onAskAdvisor={handleAskAdvisor}
        onClose={() => setDetailTicker(null)}
      />
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

          {/* Tracked-index suggestion — one tap from a fuzzy text search to the
              exact facet (clears the text; browse ordering = cheapest first). */}
          {showTrackSuggestion && (
            <button
              type="button"
              onClick={applyTrackSuggestion}
              style={{
                display: "block",
                width: "100%",
                marginBottom: 8,
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--accent)",
                background: "var(--accent-soft)",
                color: "var(--accent-ink)",
                fontSize: 11.5,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Show every fund tracking <strong>{suggestedFamily}</strong>, cheapest first →
            </button>
          )}

          {/* One pill per facet — every option lives in its dropdown, so the
              block stays a single slim row even on a phone. flexWrap as the
              rare-overflow fallback (long pill values): a scroll container
              would clip the popups. */}
          <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
            <FacetDropdown
              name="Class"
              clearLabel="All classes"
              menuLabel="Asset class"
              value={assetClass}
              onChange={(v) => setAssetClass(v as AssetClassFilter)}
              options={ASSET_CLASS_OPTIONS.filter((o) => o.value).map((o) => ({
                value: o.value,
                label: o.label,
                pill: o.label,
              }))}
            />
            {/* Index/active — the star facet for passive investors. */}
            <FacetDropdown
              name="Style"
              clearLabel="Any style"
              menuLabel="Management style"
              value={indexType}
              onChange={(v) => setIndexType(v as IndexTypeFilter)}
              options={INDEX_TYPE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                pill: o.label,
                title: o.title,
              }))}
            />
            <FacetDropdown
              name="Region"
              clearLabel="Any region"
              menuLabel="Region"
              value={region}
              onChange={(v) => setRegion(v as RegionFilter)}
              options={REGION_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                pill: o.label,
              }))}
            />
            <FacetDropdown
              name="Tax"
              clearLabel="Any tax saving"
              menuLabel="Tax wrapper"
              value={taxIncentive}
              onChange={(v) => setTaxIncentive(v as TaxIncentiveFilter)}
              options={TAX_INCENTIVE_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                pill: o.label,
                title: o.title,
              }))}
            />
            {/* Tracking restricts to index-style funds by itself, so it
                composes with (and doesn't need) the Style facet. */}
            <TracksFacet value={trackingIndex} onChange={setTrackingIndex} />
            {anyFilterActive && (
              // Clear-all as an icon pill — the app's dismiss affordance is the
              // close icon in a small bordered button, sized here to match the
              // facet pills.
              <button
                type="button"
                onClick={clearAllFilters}
                aria-label="Clear all filters"
                title="Reset all filters and the search text"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: 24,
                  boxSizing: "border-box",
                  padding: "0 7px",
                  borderRadius: 6,
                  border: "1px solid var(--line-soft)",
                  background: "var(--paper)",
                  color: "var(--muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        </div>

        {/* Legend bar — search results are relevance-ranked, browse is fee-ranked */}
        <FeeLegend ordering={query.trim() ? "best match first" : "cheapest first"} />

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
            {list.length} class{list.length === 1 ? "" : "es"} ·{" "}
            {list.filter((f) => f.ter != null).length} with TER data
            {list.filter((f) => f.indexType === "index").length > 0 && (
              <> · {list.filter((f) => f.indexType === "index").length} index</>
            )}
          </div>
        )}

        {/* Fund list. minHeight ≥ the facet menu (320px + breathing room): on
            desktop the panel is content-height, so an empty result would
            otherwise collapse the container and clip an open dropdown at its
            overflow boundary (and the panel would jump between empty and
            non-empty states). */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 360 }}>
          {!hasResults ? (
            <EmptyState query={query} isLoading={isLoading} />
          ) : (
            list.map((cls, i) => (
              <FundRow key={cls.ticker} cls={cls} rank={i + 1} onSelect={setDetailTicker} />
            ))
          )}
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
