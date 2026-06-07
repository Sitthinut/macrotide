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
      dy={12}
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
