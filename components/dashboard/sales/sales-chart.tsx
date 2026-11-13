"use client";

import type { ReactNode } from "react";

import {
  INDEX_TO_PEAK,
  PICK_A_METRIC,
  keepDate,
  formatSalesNumber,
  metricRuns,
  planAxes,
  salesMetric,
  type AllocationStep,
  type AxisPlan,
  type SalesChartPoint,
  type SalesMetricId,
  type SalesUnit,
} from "@/lib/dashboard/sales-vs-spend";

/** Plot geometry lives in this square. The SVG stretches it to the box; dots and dates stay outside that stretch. */
export const CHART_PLOT = 1000;
/** Inset so an 8px dot stays inside the box at 393. */
export const PLOT_PAD = 28;

const GROUP_COLOR = [
  "var(--foreground)",
  "var(--warning-foreground)",
  "var(--success)",
  "var(--destructive)",
  "var(--platform-ig)",
  "var(--primary-hover)",
  "var(--foreground)",
];

type Drawn = {
  id: SalesMetricId;
  label: string;
  dashed: boolean;
  color: string;
  unit: SalesUnit;
  coords: Coord[];
  /** Unbroken runs of coords. An empty day ends a run: one polyline each, never bridged. */
  runs: Coord[][];
};

type Coord = { x: number; y: number; note: string | null; count: boolean };

export function SalesChart({
  points,
  allocation,
  selected,
  indexRequested,
  showAllocation,
}: {
  points: SalesChartPoint[];
  allocation: AllocationStep[];
  selected: SalesMetricId[];
  indexRequested: boolean;
  showAllocation: boolean;
}) {
  if (selected.length === 0) {
    return <p className="px-2 py-8 text-center text-xs text-muted-foreground">{PICK_A_METRIC}</p>;
  }
  const plan = planAxes(selected.map((id) => salesMetric(id).unit), indexRequested);
  const drawn = drawSeries(points, selected, plan, allocation);
  const band = showAllocation && selected.includes("sold") ? allocationBand(points, allocation, peakFor(points, selected, "sold", plan, allocation)) : null;
  const ticks = axisTicks(points);

  return (
    <figure className="mt-2">
      <AxisCaption plan={plan} selected={selected} points={points} allocation={allocation} />
      <div className="relative h-72 w-full border border-border">
        <svg viewBox={`0 0 ${CHART_PLOT} ${CHART_PLOT}`} preserveAspectRatio="none" role="img" aria-label="Sales and spend" className="absolute inset-0 h-full w-full">
          {band}
          {drawn.flatMap((series) => {
            const noted = series.runs.findIndex((run) => run.some((coord) => coord.note));
            return series.runs.map((run, index) => (
              <polyline
                key={index === 0 ? series.id : `${series.id}-${index}`}
                fill="none"
                stroke={series.color}
                strokeWidth="1.6"
                strokeLinecap={run.length === 1 ? "round" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={series.dashed ? "4 3" : undefined}
                points={(run.length === 1 ? [run[0], run[0]] : run).map((coord) => `${coord.x},${coord.y}`).join(" ")}
              >
                {series.id === "sold" && index === noted ? <title>{run.find((coord) => coord.note)?.note}</title> : null}
              </polyline>
            ));
          })}
        </svg>
        {drawn.filter((series) => series.id === "sold").flatMap((series) =>
          series.coords.filter((coord) => coord.count).map((coord) => (
            <ChartDot key={`${coord.x}-${coord.y}`} x={coord.x} y={coord.y} color={series.color} />
          )),
        )}
      </div>
      <ChartDateLabels ticks={ticks.map((tick) => ({ key: tick.day, x: tick.x, label: tick.label }))} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        {drawn.map((series) => (
          <li key={series.id} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={series.color}
                strokeWidth="1.6"
                strokeDasharray={series.dashed ? "3 2" : undefined}
              />
            </svg>
            {series.label}
          </li>
        ))}
        {band ? (
          <li className="flex items-center gap-1.5">
            <svg width="18" height="8" aria-hidden>
              <rect width="18" height="8" rx="1" fill="var(--foreground)" opacity="0.18" />
            </svg>
            Allocation
          </li>
        ) : null}
      </ul>
    </figure>
  );
}

function AxisCaption({
  plan,
  selected,
  points,
  allocation,
}: {
  plan: AxisPlan;
  selected: SalesMetricId[];
  points: SalesChartPoint[];
  allocation: AllocationStep[];
}) {
  if (plan.mode === "index") {
    return <p className="px-1 text-[11px] text-muted-foreground">{INDEX_TO_PEAK}</p>;
  }
  if (plan.mode === "single") {
    const sample = selected.find((id) => salesMetric(id).unit === plan.unit) ?? selected[0];
    const max = peakFor(points, selected, sample, plan, allocation);
    return <p className="px-1 text-[11px] text-muted-foreground">{formatSalesNumber(plan.unit, max)}</p>;
  }
  const leftId = selected.find((id) => salesMetric(id).unit === plan.left) ?? selected[0];
  const rightId = selected.find((id) => salesMetric(id).unit === plan.right) ?? selected[0];
  const leftMax = peakFor(points, selected, leftId, plan, allocation);
  const rightMax = peakFor(points, selected, rightId, plan, allocation);
  return (
    <p className="flex justify-between px-1 text-[11px] text-muted-foreground">
      <span>{formatSalesNumber(plan.left, leftMax)}</span>
      <span>{formatSalesNumber(plan.right, rightMax)}</span>
    </p>
  );
}

function drawSeries(points: SalesChartPoint[], selected: SalesMetricId[], plan: AxisPlan, allocation: AllocationStep[]): Drawn[] {
  return selected.map((id) => {
    const metric = salesMetric(id);
    const max = peakFor(points, selected, id, plan, allocation);
    const coordAt = (index: number): Coord => {
      const point = points[index];
      return { x: xAt(index, points.length), y: yAt((point.values[id] as number) / max), note: point.estimated ? point.estimateNote : null, count: point.count };
    };
    const runs = metricRuns(points, id).map((run) => run.map(coordAt));
    const coords = runs.flat();
    return {
      id,
      label: metric.label,
      dashed: metric.costOf != null,
      color: colorFor(metric.costOf ?? id),
      unit: metric.unit,
      coords,
      runs,
    };
  });
}

function allocationBand(points: SalesChartPoint[], steps: AllocationStep[], peak: number): ReactNode {
  if (steps.length === 0 || points.length === 0) return null;
  const plot = points.map((point, index) => {
    const step = [...steps].reverse().find((item) => item.day <= point.day) ?? steps[0];
    return { x: xAt(index, points.length), y: yAt(step.value / peak) };
  });
  const floor = yAt(0);
  const d = [`M ${plot[0].x} ${floor}`, ...plot.map((coord) => `L ${coord.x} ${coord.y}`), `L ${plot[plot.length - 1].x} ${floor}`, "Z"].join(" ");
  return <path d={d} fill="var(--foreground)" opacity="0.08" />;
}

function peakFor(
  points: SalesChartPoint[],
  selected: SalesMetricId[],
  id: SalesMetricId,
  plan: AxisPlan,
  allocation: AllocationStep[],
): number {
  if (plan.mode === "index") return Math.max(1, ...points.map((point) => point.values[id] ?? 0));
  const unit = salesMetric(id).unit;
  const max = unitMax(points, selected, unit);
  if (unit === "count" && selected.includes("sold") && allocation.length > 0) {
    return Math.max(max, ...allocation.map((step) => step.value));
  }
  return max;
}

function unitMax(points: SalesChartPoint[], selected: SalesMetricId[], unit: SalesUnit): number {
  const ids = selected.filter((id) => salesMetric(id).unit === unit);
  const values = points.flatMap((point) => ids.map((id) => point.values[id] ?? 0));
  return Math.max(1, ...values);
}

function colorFor(id: SalesMetricId): string {
  const order: SalesMetricId[] = ["spend", "sold", "tickets", "checkoutActions", "lpv", "clicks", "registrations"];
  const index = Math.max(0, order.indexOf(id));
  return GROUP_COLOR[index % GROUP_COLOR.length];
}

function xAt(index: number, count: number): number {
  if (count <= 1) return CHART_PLOT / 2;
  return PLOT_PAD + (index / (count - 1)) * (CHART_PLOT - PLOT_PAD * 2);
}

function yAt(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return PLOT_PAD + (1 - clamped) * (CHART_PLOT - PLOT_PAD * 2);
}

export function ChartDot({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <span
      className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${(x / CHART_PLOT) * 100}%`, top: `${(y / CHART_PLOT) * 100}%`, background: color }}
    />
  );
}

export function ChartDateLabels({ ticks }: { ticks: { key: string; x: number; label: string }[] }) {
  return (
    <div className="relative mt-1 h-4 text-xs text-muted-foreground">
      {ticks.map((tick) => {
        const percent = (tick.x / CHART_PLOT) * 100;
        return (
          <span
            key={tick.key}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: `${percent}%`, transform: labelShift(percent) }}
          >
            {keepDate(tick.label)}
          </span>
        );
      })}
    </div>
  );
}

function labelShift(percent: number): string {
  if (percent <= 4) return "translateX(0)";
  if (percent >= 96) return "translateX(-100%)";
  return "translateX(-50%)";
}

function axisTicks(points: SalesChartPoint[]): { day: string; x: number; label: string }[] {
  if (points.length === 0) return [];
  const picks = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return [...new Set(picks)].map((index) => ({
    day: points[index].day,
    x: xAt(index, points.length),
    label: shortDay(points[index].day),
  }));
}

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
