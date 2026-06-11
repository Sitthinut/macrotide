"use client";

// Interactive charts (recharts) — hover + tooltips, styled to the app's CSS
// variables. recharts must run client-side, hence the directive. Tiny inline
// sparklines stay hand-drawn SVG in components/charts.tsx; these are the
// charts where hovering to read an exact value is genuinely useful.

import { useId } from "react";
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatDay,
  formatMonthYear,
  formatTooltipDate,
  pickAxisTicks,
} from "@/lib/portfolio/adapter";
import type { AllocationSlice, SleeveDrift } from "@/lib/portfolio/health";
import { rebaseBenchmark } from "@/lib/portfolio/rebase";
import type { SeriesPoint } from "@/lib/static/types";

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--card-soft)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12,
  boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
};
const TOOLTIP_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: "0.04em",
  color: "var(--muted)",
  marginBottom: 4,
};

const fmtBaht = (n: number) => `฿${Math.round(n).toLocaleString("en-US")}`;
const fmtK = (n: number) => `฿${Math.round(n / 1000).toLocaleString("en-US")}k`;

// Grouped x-axis tick: the first tick of each month renders a brighter
// "MMM 'yy"; in-between ticks render just a muted day number — so multi-month /
// multi-year ranges stay readable without repeating the year on every label.
// Ticks are inset from the edges (see pickAxisTicks), so all anchor "middle"
// with even gaps and nothing clips. `ticks` is the full ordered list (so we can
// compare against the previous tick for month grouping); recharts supplies
// `index` as the position within it.
function AxisTick({
  x,
  y,
  payload,
  index = 0,
  ticks,
}: {
  x?: number | string;
  y?: number | string;
  payload?: { value?: string | number };
  index?: number;
  ticks: string[];
}) {
  if (x == null || y == null || payload?.value == null) return null;
  const iso = String(payload.value);
  const isMonthStart = index === 0 || iso.slice(0, 7) !== ticks[index - 1]?.slice(0, 7);
  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={9}
      textAnchor="middle"
      fontSize={10}
      fontFamily="var(--font-mono)"
      fill="var(--muted)"
      opacity={isMonthStart ? 1 : 0.55}
    >
      {isMonthStart ? formatMonthYear(iso) : formatDay(iso)}
    </text>
  );
}

// Reserved height for the x-axis band. recharts hands the tick a `y` already
// offset ~6px below the axis line, then our label adds dy=9 + descent, so the
// band must cover ~21px or the date clips at the SVG edge. 22 trims the old 30px
// default (the plot gains the difference) while keeping a small margin. Both
// NavChart return paths share it, and the two-line label/dot geometry derives the
// plot bottom from it.
const NAV_AXIS_H = 22;

function EmptyState({ height, emptyHint }: { height: number; emptyHint?: string | null }) {
  return (
    <div
      style={{
        width: "100%",
        height,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
        NO HISTORY YET
      </div>
      {emptyHint && <div style={{ fontSize: 11, maxWidth: 320, lineHeight: 1.5 }}>{emptyHint}</div>}
    </div>
  );
}

// ===== NAV / performance chart (interactive line + optional benchmark) =====

const fmtSignedBaht = (n: number) =>
  `${n < 0 ? "−" : "+"}฿${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

interface TwoLinePoint {
  d: string;
  v: number;
  inv: number;
  bench: number | null;
  cash: number;
  lower: number;
  gainUp: number;
  gainDown: number;
}

export function NavChart({
  data,
  height = 160,
  accent = "var(--accent)",
  benchmarkData = null,
  benchmarkLabel = null,
  emptyHint = null,
  valueFormatter = fmtBaht,
  seriesLabel = "Portfolio",
  showReturnInTooltip = false,
  investedData = null,
  cashData = null,
  valuesHidden = false,
  baselineValue = 0,
  baselineInvested = 0,
}: {
  data: SeriesPoint[];
  height?: number;
  accent?: string;
  benchmarkData?: SeriesPoint[] | null;
  benchmarkLabel?: string | null;
  emptyHint?: string | null;
  /** Formats the main line's value in the tooltip. Defaults to whole-baht. */
  valueFormatter?: (n: number) => string;
  /** Tooltip label for the main series. Defaults to "Portfolio". */
  seriesLabel?: string;
  /**
   * Append the cumulative % change since the window's first point to the main
   * series' tooltip — so a single line reads as both an absolute value and a
   * return (the two are the same curve, just rescaled). Off for the portfolio.
   */
  showReturnInTooltip?: boolean;
  /**
   * Cumulative net-invested series on the same dates as `data`. When given the
   * chart renders the two-line wealth view: value line + a muted contribution
   * line, with the gap tinted as gain (accent) or loss. Dashed stroke stays
   * reserved for the benchmark overlay.
   */
  investedData?: SeriesPoint[] | null;
  /** In-transit settlement cash per date — disclosed in the tooltip when > 0. */
  cashData?: SeriesPoint[] | null;
  /** Privacy toggle: mask every ฿ figure in the tooltip (gain % stays). */
  valuesHidden?: boolean;
  /**
   * Window rebase: subtract these from value/benchmark and net-invested so a
   * clipped range answers "how did I do this period" from 0. The benchmark is
   * rebased onto the ABSOLUTE series first, then shifted by the same baseline,
   * so both treatments stay coherent. 0 = absolute (the lifetime story).
   */
  baselineValue?: number;
  baselineInvested?: number;
}) {
  const gradId = `nav-grad-${useId().replace(/:/g, "")}`;

  if (!data || data.length === 0) {
    return <EmptyState height={height} emptyHint={emptyHint} />;
  }

  // First finite value, for the "% since start" reading in the tooltip.
  const baseline = data.find((d) => Number.isFinite(d.v))?.v;

  // Overlay the benchmark aligned to the portfolio's own date labels, then
  // rebase it onto the portfolio's value at their first common date so both
  // lines share a scale. Tolerant of different lengths / non-overlapping trading
  // days (an exact-length check would drop the line whenever the two series
  // differed, which is almost always). Shared with PerfChart via rebaseBenchmark.
  const rebased = rebaseBenchmark(data, benchmarkData);
  const benchByLabel = rebased ? new Map(rebased.map((b) => [b.d, b.v])) : null;

  // ── Two-line wealth view (value + net invested + signed gain wedge) ──
  if (investedData && investedData.length > 0) {
    const investedByLabel = new Map(investedData.map((p) => [p.d, p.v]));
    const cashByLabel = cashData ? new Map(cashData.map((p) => [p.d, p.v])) : null;
    const windowed = baselineValue !== 0 || baselineInvested !== 0;
    const merged: TwoLinePoint[] = data.map((p) => {
      const v = p.v - baselineValue;
      const rawBench = benchByLabel?.get(p.d);
      const inv = (investedByLabel.get(p.d) ?? baselineInvested) - baselineInvested;
      const gain = v - inv;
      return {
        d: p.d,
        v,
        inv,
        bench: rawBench == null ? null : rawBench - baselineValue,
        cash: cashByLabel?.get(p.d) ?? 0,
        // The gain wedge as stacked areas: an invisible base up to the lower
        // line, then the |gap| tinted by sign — green above the invested line,
        // loss-red when the value dips underwater.
        lower: Math.min(v, inv),
        gainUp: Math.max(0, gain),
        gainDown: Math.max(0, -gain),
      };
    });
    const axisTicks = pickAxisTicks(merged);

    // Explicit Y domain from the REAL lines only — the wedge's stacked helper
    // series carry small gap-sized values that would otherwise drag dataMin
    // toward 0 and squash both lines against the top of the plot.
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const p of merged) {
      yMin = Math.min(yMin, p.lower, p.bench ?? p.lower);
      yMax = Math.max(yMax, p.v, p.inv, p.bench ?? p.v);
    }

    const renderTooltip = (props: {
      active?: boolean;
      label?: string | number;
      payload?: readonly { payload?: TwoLinePoint }[];
    }) => {
      if (!props.active || !props.payload?.[0]?.payload) return null;
      const p = props.payload[0].payload;
      const gain = p.v - p.inv;
      // Windowed: gain relative to the wealth you started the window with.
      // Absolute: gain relative to everything you've put in.
      const denom = windowed ? baselineValue : p.inv;
      const pct = denom > 0 ? (gain / denom) * 100 : null;
      const row = (label: string, text: string, color = "var(--ink)") => (
        <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
          <span style={{ color: "var(--muted)" }}>{label}</span>
          <span style={{ color, fontVariantNumeric: "tabular-nums" }}>{text}</span>
        </div>
      );
      return (
        <div style={TOOLTIP_STYLE}>
          <div style={TOOLTIP_LABEL}>{formatTooltipDate(String(props.label ?? p.d))}</div>
          {!valuesHidden &&
            row(
              windowed ? "Change" : "Value",
              windowed ? fmtSignedBaht(p.v) : fmtBaht(p.v),
              accent,
            )}
          {!valuesHidden && row("Net invested", windowed ? fmtSignedBaht(p.inv) : fmtBaht(p.inv))}
          {row(
            "Gain",
            `${valuesHidden ? "" : `${fmtSignedBaht(gain)}${pct === null ? "" : " · "}`}${
              pct === null ? (valuesHidden ? "—" : "") : `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
            }`,
            gain >= 0 ? "var(--gain)" : "var(--loss)",
          )}
          {p.bench != null &&
            !valuesHidden &&
            row(
              benchmarkLabel ?? "Benchmark",
              windowed ? fmtSignedBaht(p.bench) : fmtBaht(p.bench),
            )}
          {p.cash > 0 && !valuesHidden && (
            <div style={{ color: "var(--muted)", marginTop: 3, fontSize: 11 }}>
              incl. {fmtBaht(p.cash)} awaiting reinvestment
            </div>
          )}
        </div>
      );
    };

    const last = merged.at(-1);
    const valueAbove = !last || last.v >= last.inv;
    const n = merged.length;

    // Geometry of the plot area (top margin 10, x-axis band NAV_AXIS_H).
    const plotTop = 10;
    const plotH = height - plotTop - NAV_AXIS_H;
    const range = yMax - yMin;
    // Inset the y-domain by ~the active-dot radius (data units) so a line sitting
    // on the extreme — a flat cost-basis floor, or a ceiling — isn't flush with
    // the plot edge, where its hover dot would be clipped in half.
    const pad = range > 0 ? (5 / plotH) * range : Math.max(1, Math.abs(yMax) * 0.02);
    const domMin = yMin - pad;
    const domMax = yMax + pad;
    const yOf = (val: number) => plotTop + (domMax - val) * (plotH / (domMax - domMin));

    // The end-label hugs the invested line's last point and stays clear of the
    // line WITHIN THE LABEL'S OWN WIDTH — so a step-up under the text is avoided,
    // but one further left (where no text sits) is ignored. The clearance window
    // is the label's pixel width converted to data points, so it's the same
    // physical width at every range (not a fraction of the series). It also flips
    // to the side with room when the line is pinned to the floor or the ceiling.
    // SVG text grows UP from its baseline → a below-label needs more gap.
    const GAP_BELOW = 12;
    const GAP_ABOVE = 7;
    const LABEL_H = 9;
    const LABEL_W = 55; // ~ "INVESTED" at 9px mono + letter-spacing
    const BOTTOM_EDGE = height - NAV_AXIS_H;
    const investedEndLabel = (props: {
      x?: number | string;
      y?: number | string;
      index?: number;
    }) => {
      if (props.index !== n - 1 || props.x == null || props.y == null) return null;
      const lastX = Number(props.x);
      // px between category points → trailing points the label text spans.
      const pxPerPoint = n > 1 ? (lastX - 4) / (n - 1) : 0;
      const span = pxPerPoint > 0 ? Math.min(n, Math.max(2, Math.ceil(LABEL_W / pxPerPoint))) : n;
      // Clear against the INVESTED line only — the label belongs to it and must
      // hug it on whichever side, never jump across the wedge to the value line.
      const windowPts = merged.slice(n - span);
      const invLow = Math.min(...windowPts.map((p) => p.inv));
      const invHigh = Math.max(...windowPts.map((p) => p.inv));
      const yBelow = yOf(invLow) + GAP_BELOW;
      const yAbove = yOf(invHigh) - GAP_ABOVE;
      // Prefer the side away from the value line; flip only if it spills past an edge.
      let below = valueAbove;
      const belowFits = yBelow <= BOTTOM_EDGE;
      const aboveFits = yAbove - LABEL_H >= plotTop;
      if (below && !belowFits && aboveFits) below = false;
      else if (!below && !aboveFits && belowFits) below = true;
      const y = Math.min(height - 4, Math.max(LABEL_H, below ? yBelow : yAbove));
      return (
        <text
          x={lastX - 4}
          y={y}
          textAnchor="end"
          fontSize={9}
          fontFamily="var(--font-mono)"
          letterSpacing="0.06em"
          fill="var(--muted-2)"
        >
          INVESTED
        </text>
      );
    };

    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={merged} margin={{ top: 10, right: 6, bottom: 0, left: 4 }}>
          <XAxis
            dataKey="d"
            ticks={axisTicks}
            interval={0}
            height={NAV_AXIS_H}
            tickLine={false}
            axisLine={false}
            tick={(props) => <AxisTick {...props} ticks={axisTicks} />}
          />
          {/* allowDataOverflow honors this explicit domain — the wedge's stacked
              helper areas would otherwise drag the auto-domain down to the 0
              stack baseline and squash both lines into the top of the plot. */}
          <YAxis hide domain={[domMin, domMax]} allowDataOverflow />
          <Tooltip cursor={{ stroke: "var(--line)", strokeWidth: 1 }} content={renderTooltip} />
          {/* Signed gain wedge between the two lines (invisible base + |gap|). */}
          <Area
            type="monotone"
            dataKey="lower"
            stackId="up"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
            tooltipType="none"
            activeDot={false}
          />
          <Area
            type="monotone"
            dataKey="gainUp"
            stackId="up"
            stroke="none"
            fill={accent}
            fillOpacity={0.16}
            isAnimationActive={false}
            tooltipType="none"
            activeDot={false}
          />
          <Area
            type="monotone"
            dataKey="lower"
            stackId="down"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
            tooltipType="none"
            activeDot={false}
          />
          <Area
            type="monotone"
            dataKey="gainDown"
            stackId="down"
            stroke="none"
            fill="var(--loss)"
            fillOpacity={0.14}
            isAnimationActive={false}
            tooltipType="none"
            activeDot={false}
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={accent}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: accent }}
            isAnimationActive={false}
          />
          {/* Contribution line: thin, faint (muted-2), and DOTTED so it reads as
              a quiet reference baseline — distinct from the value line (solid)
              and the benchmark (dashed). */}
          <Line
            type="monotone"
            dataKey="inv"
            stroke="var(--muted-2)"
            strokeWidth={1.25}
            strokeDasharray="1 4"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 3, fill: "var(--muted-2)" }}
            isAnimationActive={false}
            label={investedEndLabel}
          />
          {benchmarkData && (
            <Line
              type="monotone"
              dataKey="bench"
              stroke="var(--muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  const merged = data.map((d) => ({
    d: d.d,
    v: d.v,
    bench: benchByLabel?.get(d.d) ?? null,
  }));
  const axisTicks = pickAxisTicks(merged);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={merged} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.22} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="d"
          ticks={axisTicks}
          interval={0}
          height={NAV_AXIS_H}
          tickLine={false}
          axisLine={false}
          tick={(props) => <AxisTick {...props} ticks={axisTicks} />}
        />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip
          cursor={{ stroke: "var(--line)", strokeWidth: 1 }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          labelFormatter={(label) => formatTooltipDate(String(label))}
          formatter={(value, name) => {
            if (name === "bench") return [fmtBaht(Number(value)), benchmarkLabel ?? "Benchmark"];
            const v = Number(value);
            let text = valueFormatter(v);
            if (showReturnInTooltip && baseline) {
              const pct = (v / baseline - 1) * 100;
              text = `${text} · ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
            }
            return [text, seriesLabel];
          }}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke={accent}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, fill: accent }}
          isAnimationActive={false}
        />
        {benchmarkData && (
          <Line
            type="monotone"
            dataKey="bench"
            stroke="var(--muted)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ===== Allocation donut (interactive — hover a slice for value + weight) =====
export function AllocationDonut({
  data,
  height = 150,
  innerRadius = 46,
  outerRadius = 66,
}: {
  data: AllocationSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
}) {
  if (!data || data.length === 0) {
    return <EmptyState height={height} emptyHint="Add holdings to see your allocation." />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          paddingAngle={1.5}
          stroke="var(--bg)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {data.map((slice) => (
            <Cell key={slice.key} fill={slice.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          formatter={(value, _name, item) => {
            const slice = item?.payload as AllocationSlice | undefined;
            return [`${fmtBaht(Number(value))} · ${(slice?.pct ?? 0).toFixed(1)}%`, slice?.label];
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ===== Drift bars (diverging — over/underweight vs target, hover for detail) =====
export function DriftBars({
  data,
  height = 150,
  tolerancePp = 1.5,
  maxRows = 6,
}: {
  data: SleeveDrift[];
  height?: number;
  /** Drift within ±tolerance is treated as "on target" (green). */
  tolerancePp?: number;
  maxRows?: number;
}) {
  if (!data || data.length === 0) {
    return <EmptyState height={height} emptyHint="Set a target model to see allocation drift." />;
  }
  const rows = data.slice(0, maxRows);
  const maxAbs = Math.max(2, ...rows.map((r) => Math.abs(r.drift)));
  const colorFor = (drift: number) => {
    if (Math.abs(drift) <= tolerancePp) return "var(--gain)";
    return drift > 0 ? "var(--amber)" : "var(--info)";
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <XAxis type="number" domain={[-maxAbs, maxAbs]} hide />
        <YAxis
          type="category"
          dataKey="ticker"
          tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "var(--font-mono)" }}
          tickLine={false}
          axisLine={false}
          width={70}
        />
        <ReferenceLine x={0} stroke="var(--line)" />
        <Tooltip
          cursor={{ fill: "var(--line-soft)" }}
          contentStyle={TOOLTIP_STYLE}
          labelStyle={TOOLTIP_LABEL}
          formatter={(_value, _name, item) => {
            const p = item?.payload as SleeveDrift;
            const sign = p.drift > 0 ? "+" : "";
            return [
              `${p.current.toFixed(1)}% now vs ${p.target.toFixed(1)}% target (${sign}${p.drift.toFixed(1)}pp)`,
              p.label,
            ];
          }}
        />
        <Bar dataKey="drift" radius={[2, 2, 2, 2]} isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.ticker} fill={colorFor(r.drift)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export { fmtBaht as fmtBahtChart, fmtK as fmtKChart };
