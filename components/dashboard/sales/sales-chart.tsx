"use client";

import type { ReactNode } from "react";

import {
  INDEX_TO_PEAK,
  PICK_A_METRIC,
  formatSalesNumber,
  planAxes,
  salesMetric,
  type AllocationStep,
  type AxisPlan,
  type SalesChartPoint,
  type SalesMetricId,
  type SalesUnit,
} from "@/lib/dashboard/sales-vs-spend";

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
  coords: { x: number; y: number; note: string | null }[];
};

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
      <svg viewBox="0 0 640 180" role="img" aria-label="Sales and spend" className="h-40 w-full">
        <rect x="8" y="8" width="624" height="140" fill="none" stroke="currentColor" className="text-border" />
        {band}
        {drawn.map((series) => (
          <g key={series.id}>
            <polyline
              fill="none"
              stroke={series.color}
              strokeWidth="1.6"
              strokeDasharray={series.dashed ? "4 3" : undefined}
              points={series.coords.map((coord) => `${coord.x},${coord.y}`).join(" ")}
            />
            {series.coords.filter((coord) => coord.note).map((coord, index) => (
              <circle key={index} cx={coord.x} cy={coord.y} r="2.5" fill={series.color}>
                <title>{coord.note}</title>
              </circle>
            ))}
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick.day} x={tick.x} y="168" textAnchor="middle" fontSize="10" fill="currentColor" className="text-muted-foreground">
            {tick.label}
          </text>
        ))}
      </svg>
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
        {band ? <li>Allocation</li> : null}
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
    const coords = points.map((point, index) => {
      const value = point.values[id];
      const x = xAt(index, points.length);
      const y = value == null ? yAt(0) : yAt(value / max);
      return { x, y, note: point.estimated ? point.estimateNote : null };
    }).filter((_, index) => points[index].values[id] != null);
    return {
      id,
      label: metric.label,
      dashed: metric.costOf != null,
      color: colorFor(metric.costOf ?? id),
      unit: metric.unit,
      coords,
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
  if (count <= 1) return 320;
  return 8 + (index / (count - 1)) * 624;
}

function yAt(fraction: number): number {
  const clamped = Math.max(0, Math.min(1, fraction));
  return 148 - clamped * 140;
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
