"use client";

// Lazy boundary for the recharts charts. recharts is the heaviest client
// dependency and used to load in the initial app bundle for every screen,
// chart or no chart. These wrappers code-split it behind React.lazy and hold
// layout with a chart-sized skeleton while the chunk loads (once per session).
// Import charts from here, not from ./InteractiveCharts, in app code.

import { lazy, Suspense } from "react";
import type {
  AllocationDonut as AllocationDonutImpl,
  DriftBars as DriftBarsImpl,
  NavChart as NavChartImpl,
} from "./InteractiveCharts";

const LazyNavChart = lazy(() =>
  import("./InteractiveCharts").then((m) => ({ default: m.NavChart })),
);
const LazyAllocationDonut = lazy(() =>
  import("./InteractiveCharts").then((m) => ({ default: m.AllocationDonut })),
);
const LazyDriftBars = lazy(() =>
  import("./InteractiveCharts").then((m) => ({ default: m.DriftBars })),
);

function ChartFallback({ height }: { height?: number }) {
  return <div className="skeleton" aria-hidden style={{ height: height ?? 130 }} />;
}

export function NavChart(props: Parameters<typeof NavChartImpl>[0]) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <LazyNavChart {...props} />
    </Suspense>
  );
}

export function AllocationDonut(props: Parameters<typeof AllocationDonutImpl>[0]) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <LazyAllocationDonut {...props} />
    </Suspense>
  );
}

export function DriftBars(props: Parameters<typeof DriftBarsImpl>[0]) {
  return (
    <Suspense fallback={<ChartFallback height={props.height} />}>
      <LazyDriftBars {...props} />
    </Suspense>
  );
}
