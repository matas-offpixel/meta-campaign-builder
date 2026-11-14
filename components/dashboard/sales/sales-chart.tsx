"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { anchoredDateIndexes, axisCeiling, axisTicks, dateStepDays, daySpan, formatCountTick, formatMoneyTick } from "@/components/dashboard/sales/chart-axes";
import { TILE_NAMES } from "@/components/dashboard/sales/tile-copy";
import {
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
  onIndex,
  pinnedDay = null,
}: {
  points: SalesChartPoint[];
  allocation: AllocationStep[];
  selected: SalesMetricId[];
  indexRequested: boolean;
  showAllocation: boolean;
  onIndex?: (next: boolean) => void;
  /** A day whose hover card stays open, for the chart frame. */
  pinnedDay?: string | null;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(960);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setPlotWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const units = selected.map((id) => salesMetric(id).unit);
  const indexForced = new Set(units).size >= 3;
  const plan = moneyOnTheLeft(planAxes(units, indexRequested));
  const narrow = plotWidth < 640;
  const intervals = narrow ? 3 : 6;
  const scales = axisScales(points, selected, plan, allocation, intervals);
  const drawn = selected.length === 0 ? [] : drawSeries(points, selected, plan, allocation, scales);
  const countCeiling = scales.rightUnit === "count" ? scales.rightCeiling : scales.leftCeiling;
  const band = showAllocation && plan.mode !== "index" && selected.includes("sold") ? allocationBand(points, allocation, countCeiling) : null;
  const grid = plan.mode === "index"
    ? Array.from({ length: intervals + 1 }, (_, index) => (100 / intervals) * index)
    : axisTicks(scales.leftPeak, intervals);
  const dates = dateLabels(points, plotWidth);
  const pinned = pinnedDay == null ? null : points.findIndex((point) => point.day === pinnedDay);
  const active = hoverIndex ?? (pinned != null && pinned >= 0 ? pinned : null);

  return (
    <figure className="mt-2">
      <div className="flex items-start justify-between gap-3 text-xs">
        <p className="text-muted-foreground">{captionAbove(plan, selected)}</p>
        {onIndex ? <IndexToggle checked={plan.mode === "index"} disabled={indexForced} onIndex={onIndex} className="hidden sm:flex" /> : null}
      </div>
      {selected.length === 0 ? <p className="px-2 py-8 text-center text-xs text-muted-foreground">{PICK_A_METRIC}</p> : (
        <>
          <div className="mt-4 flex items-start">
            <div className="relative h-72 w-12 shrink-0 text-[10px] text-muted-foreground">
              <span className="absolute -top-3 left-0 font-mono uppercase tracking-wide">{axisTitle(scales.leftUnit, selected)}</span>
              {grid.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-1 -translate-y-1/2 whitespace-nowrap"
                  style={{ top: `${(yAt(plan.mode === "index" ? tick / 100 : tick / (scales.leftCeiling || 1)) / CHART_PLOT) * 100}%` }}
                >
                  {plan.mode === "index" ? `${Math.round(tick)}%` : formatTick(scales.leftUnit, tick, narrow)}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div
                ref={plotRef}
                className="relative h-72 w-full"
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0 || points.length === 0) return;
                  const ratio = (event.clientX - rect.left) / rect.width;
                  const index = Math.round(ratio * (points.length - 1));
                  setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
                }}
                onPointerLeave={() => setHoverIndex(null)}
              >
                <svg viewBox={`0 0 ${CHART_PLOT} ${CHART_PLOT}`} preserveAspectRatio="none" role="img" aria-label="Sales and spend" className="absolute inset-0 h-full w-full">
                  {grid.map((tick, index) => {
                    const y = yAt(plan.mode === "index" ? tick / 100 : tick / (scales.leftCeiling || 1));
                    return (
                      <line
                        key={tick}
                        x1={PLOT_PAD}
                        x2={CHART_PLOT - PLOT_PAD}
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        className="text-border"
                        strokeOpacity={index === 0 ? 0.7 : 0.35}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
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
                  {active != null ? (
                    <line
                      x1={xAt(active, points.length)}
                      x2={xAt(active, points.length)}
                      y1={PLOT_PAD}
                      y2={CHART_PLOT - PLOT_PAD}
                      stroke="currentColor"
                      strokeDasharray="2 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </svg>
                {drawn.filter((series) => series.id === "sold").flatMap((series) =>
                  series.coords.filter((coord) => coord.count).map((coord) => (
                    <ChartDot key={`${coord.x}-${coord.y}`} x={coord.x} y={coord.y} color={series.color} />
                  )),
                )}
                {active != null ? <HoverCard point={points[active]} selected={selected} alignRight={active > points.length * 0.62} x={xAt(active, points.length)} /> : null}
              </div>
              <div className="relative mt-1 h-5 text-xs text-muted-foreground">
                {dates.map((tick) => {
                  const percent = (tick.x / CHART_PLOT) * 100;
                  return (
                    <span key={tick.day} className="absolute top-0" style={{ left: `${percent}%` }}>
                      <span className="absolute -top-1 left-0 h-1 w-px bg-current opacity-60" />
                      <span className="absolute top-0 whitespace-nowrap" style={{ transform: labelShift(percent) }}>{keepDate(tick.label)}</span>
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="relative h-72 w-12 shrink-0 text-[10px] text-muted-foreground">
              {scales.rightUnit && plan.mode !== "index" ? (
                <span className="absolute -top-3 right-0 text-right font-mono uppercase tracking-wide">{axisTitle(scales.rightUnit, selected)}</span>
              ) : null}
              {plan.mode !== "index" && scales.rightUnit
                ? axisTicks(scales.rightPeak, intervals).map((tick) => (
                  <span
                    key={tick}
                    className="absolute left-1 -translate-y-1/2 whitespace-nowrap"
                    style={{ top: `${(yAt(tick / (scales.rightCeiling || 1)) / CHART_PLOT) * 100}%` }}
                  >
                    {formatTick(scales.rightUnit!, tick, narrow)}
                  </span>
                ))
                : null}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{captionBelow(selected)}</p>
          {onIndex ? <IndexToggle checked={plan.mode === "index"} disabled={indexForced} onIndex={onIndex} className="mt-1 flex sm:hidden" /> : null}
        </>
      )}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
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

type Scales = {
  leftUnit: SalesUnit | "percent";
  leftPeak: number;
  leftCeiling: number;
  rightUnit: SalesUnit | null;
  rightPeak: number;
  rightCeiling: number;
  count: number | null;
};

function axisScales(
  points: SalesChartPoint[],
  selected: SalesMetricId[],
  plan: AxisPlan,
  allocation: AllocationStep[],
  intervals: number,
): Scales {
  if (plan.mode === "index") {
    return { leftUnit: "percent", leftPeak: 100, leftCeiling: 100, rightUnit: null, rightPeak: 0, rightCeiling: 1, count: null };
  }
  const leftUnit = plan.mode === "single" ? plan.unit : plan.left;
  const rightUnit = plan.mode === "dual" ? plan.right : null;
  const leftPeak = unitPeak(points, selected, leftUnit, allocation);
  const rightPeak = rightUnit ? unitPeak(points, selected, rightUnit, allocation) : 0;
  return {
    leftUnit,
    leftPeak,
    leftCeiling: axisCeiling(leftPeak, intervals),
    rightUnit,
    rightPeak,
    rightCeiling: rightUnit ? axisCeiling(rightPeak, intervals) : 1,
    count: selected.some((id) => salesMetric(id).unit === "count") ? unitPeak(points, selected, "count", allocation) : null,
  };
}

function unitPeak(points: SalesChartPoint[], selected: SalesMetricId[], unit: SalesUnit, allocation: AllocationStep[]): number {
  const ids = selected.filter((id) => salesMetric(id).unit === unit);
  const values = points.flatMap((point) => ids.map((id) => point.values[id] ?? 0));
  const peak = Math.max(1, ...values);
  if (unit === "count" && selected.includes("sold") && allocation.length > 0) {
    return Math.max(peak, ...allocation.map((step) => step.value));
  }
  return peak;
}

function formatTick(unit: SalesUnit | "percent", value: number, narrow: boolean): string {
  if (unit === "percent") return `${Math.round(value)}%`;
  if (unit === "count") return formatCountTick(value, narrow);
  return formatMoneyTick(value, narrow);
}

function captionAbove(plan: AxisPlan, selected: SalesMetricId[]): string {
  if (plan.mode === "index") return "Each line is drawn against its own peak (100%).";
  const left = selected.filter((id) => salesMetric(id).unit === (plan.mode === "single" ? plan.unit : plan.left));
  const right = plan.mode === "dual" ? selected.filter((id) => salesMetric(id).unit === plan.right) : [];
  const leftWords = plainAxis(left);
  if (right.length === 0) return `Left axis: ${leftWords}.`;
  return `Left axis: ${leftWords}. Right axis: ${plainAxis(right)}.`;
}

function plainAxis(ids: SalesMetricId[]): string {
  return ids.map((id) => {
    const name = TILE_NAMES[id].wide.toLowerCase();
    if (id === "sold") return "total sold (tickets)";
    if (salesMetric(id).unit === "money" || salesMetric(id).unit === "rate") return `${name} (£)`;
    return name;
  }).join(", ");
}

function moneyOnTheLeft(plan: AxisPlan): AxisPlan {
  if (plan.mode !== "dual") return plan;
  const rank = (unit: SalesUnit) => (unit === "money" ? 0 : unit === "rate" ? 1 : 2);
  if (rank(plan.left) <= rank(plan.right)) return plan;
  return { mode: "dual", left: plan.right, right: plan.left };
}

function axisTitle(unit: SalesUnit | "percent", selected: SalesMetricId[]): string {
  if (unit === "percent") return "% of own peak";
  const ids = selected.filter((id) => salesMetric(id).unit === unit);
  if (unit === "count") return countTitle(ids);
  return `${TILE_NAMES[ids[0] ?? "spend"].wide} (£)`;
}

function IndexToggle({
  checked,
  disabled,
  onIndex,
  className,
}: {
  checked: boolean;
  disabled: boolean;
  onIndex: (next: boolean) => void;
  className: string;
}) {
  return (
    <label className={`${className} shrink-0 items-center gap-1.5 text-muted-foreground`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onIndex(event.target.checked)} />
      Index each line to its own peak
    </label>
  );
}

function countTitle(ids: SalesMetricId[]): string {
  if (ids.length >= 3) return "Count";
  if (ids.length === 2) return `${TILE_NAMES[ids[0]].wide} · ${TILE_NAMES[ids[1]].wide}`;
  return TILE_NAMES[ids[0] ?? "sold"].wide;
}

function captionBelow(selected: SalesMetricId[]): string {
  const parts = ["Solid lines are volumes; the dashed line in the same colour is its cost."];
  if (selected.includes("sold")) parts.push("A dot is a real Internal Count; between two counts the line is a straight estimate.");
  if (selected.includes("tickets") || selected.includes("costPerTicket")) {
    parts.push("Sales and cost per ticket hold one value across the days between two Internal Counts.");
  }
  return parts.join(" ");
}

function dateLabels(points: SalesChartPoint[], plotWidth: number): { day: string; x: number; label: string }[] {
  if (points.length === 0) return [];
  const step = dateStepDays(daySpan(points.map((point) => point.day)), plotWidth);
  return anchoredDateIndexes(points.map((point) => point.day), step).map((index) => ({
    day: points[index].day,
    x: xAt(index, points.length),
    label: shortDay(points[index].day),
  }));
}

function HoverCard({
  point,
  selected,
  alignRight,
  x,
}: {
  point: SalesChartPoint;
  selected: SalesMetricId[];
  alignRight: boolean;
  x: number;
}) {
  return (
    <div
      className="pointer-events-none absolute z-10 w-44 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] shadow-sm"
      style={{ left: `${(x / CHART_PLOT) * 100}%`, top: 8, transform: alignRight ? "translateX(calc(-100% - 8px))" : "translateX(8px)" }}
    >
      <p className="font-medium">{keepDate(shortDay(point.day))}</p>
      {selected.map((id) => {
        const value = point.values[id];
        return (
          <p key={id} className="text-muted-foreground">
            {TILE_NAMES[id].wide} {value == null ? "—" : formatSalesNumber(salesMetric(id).unit, value)}
          </p>
        );
      })}
      {point.estimated && point.estimateNote ? <p className="text-muted-foreground">{point.estimateNote}</p> : null}
    </div>
  );
}

function drawSeries(
  points: SalesChartPoint[],
  selected: SalesMetricId[],
  plan: AxisPlan,
  allocation: AllocationStep[],
  scales: Scales,
): Drawn[] {
  return selected.map((id) => {
    const metric = salesMetric(id);
    const own = peakFor(points, selected, id, plan, allocation);
    const ceiling = plan.mode === "index" ? own : metric.unit === scales.rightUnit ? scales.rightCeiling : scales.leftCeiling;
    const coordAt = (index: number): Coord => {
      const point = points[index];
      return { x: xAt(index, points.length), y: yAt((point.values[id] as number) / ceiling), note: point.estimated ? point.estimateNote : null, count: point.count };
    };
    const runs = metricRuns(points, id).map((run) => run.map(coordAt));
    const coords = runs.flat();
    return {
      id,
      label: TILE_NAMES[id].wide,
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

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
