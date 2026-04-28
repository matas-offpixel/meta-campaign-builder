"use client";

import { useMemo, useState } from "react";

import type { TimelineRow } from "@/lib/db/event-daily-timeline";

/**
 * components/dashboard/events/event-trend-chart.tsx
 *
 * Multi-metric trend chart shared by the event report block and the
 * WC venue portal embed: pill toggles double as the legend, a hairline
 * + tooltip follows hover, and each metric gets its own normalised Y
 * scale so trends are comparable even when absolute values aren't.
 *
 * Self-hides when fewer than two distinct days of data exist — a
 * single point can't draw a line and the empty plot would imply data
 * we don't have. Callers don't need to gate the render themselves.
 *
 * Props are intentionally pre-resolved (a sorted timeline) so this
 * component is a pure presentation layer; the orchestrator does the
 * fetch + sync.
 */

export type TrendGranularity = "daily" | "weekly";

export interface TrendChartPoint {
  date: string;
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
}

export interface TrendChartDay extends TrendChartPoint {
  cpt: number | null;
  roas: number | null;
  cpc: number | null;
}

type MetricKey = "spend" | "tickets" | "cpt" | "roas" | "linkClicks" | "cpc";

interface MetricDef {
  key: MetricKey;
  label: string;
  /** Hex colour shared between the SVG line + the HTML pill swatch so
   *  the legend never drifts from the plotted line. */
  colour: string;
  format: (n: number) => string;
}

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", colour: "#27272a", format: (n) => GBP2.format(n) },
  { key: "tickets", label: "Tickets", colour: "#10b981", format: (n) => NUM.format(n) },
  { key: "cpt", label: "CPT", colour: "#f59e0b", format: (n) => GBP2.format(n) },
  { key: "roas", label: "ROAS", colour: "#8b5cf6", format: (n) => `${n.toFixed(2)}×` },
  { key: "linkClicks", label: "Clicks", colour: "#0ea5e9", format: (n) => NUM.format(n) },
  { key: "cpc", label: "CPC", colour: "#f43f5e", format: (n) => GBP2.format(n) },
];

interface Props {
  timeline?: TimelineRow[];
  points?: TrendChartPoint[];
  /** Optional className override for layout adjustments. */
  className?: string;
  title?: string;
  defaultGranularity?: TrendGranularity;
  showGranularityToggle?: boolean;
}

function timelineToPoints(timeline: TimelineRow[]): TrendChartPoint[] {
  return timeline.map((r) => ({
    date: r.date,
    spend: r.ad_spend != null ? Number(r.ad_spend) : null,
    tickets: r.tickets_sold != null ? Number(r.tickets_sold) : null,
    revenue: r.revenue != null ? Number(r.revenue) : null,
    linkClicks: r.link_clicks != null ? Number(r.link_clicks) : null,
  }));
}

interface PointAccumulator {
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
}

function addNullable(
  current: number | null,
  value: number | null,
): number | null {
  return value != null ? (current ?? 0) + value : current;
}

function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function deriveMetrics(date: string, v: PointAccumulator): TrendChartDay {
  const cpt =
    v.spend !== null && v.spend > 0 && v.tickets !== null && v.tickets > 0
      ? v.spend / v.tickets
      : null;
  const roas =
    v.revenue !== null && v.revenue > 0 && v.spend !== null && v.spend > 0
      ? v.revenue / v.spend
      : null;
  const cpc =
    v.spend !== null &&
    v.spend > 0 &&
    v.linkClicks !== null &&
    v.linkClicks > 0
      ? v.spend / v.linkClicks
      : null;
  return {
    date,
    spend: v.spend,
    tickets: v.tickets,
    revenue: v.revenue,
    linkClicks: v.linkClicks,
    cpt,
    roas,
    cpc,
  };
}

export function aggregateTrendChartPoints(
  points: TrendChartPoint[],
  granularity: TrendGranularity,
): TrendChartDay[] {
  const map = new Map<string, PointAccumulator>();
  for (const point of points) {
    const key = granularity === "weekly" ? isoWeekStart(point.date) : point.date;
    const cur =
      map.get(key) ??
      ({ spend: null, tickets: null, revenue: null, linkClicks: null } as PointAccumulator);
    cur.spend = addNullable(cur.spend, point.spend);
    cur.tickets = addNullable(cur.tickets, point.tickets);
    cur.revenue = addNullable(cur.revenue, point.revenue);
    cur.linkClicks = addNullable(cur.linkClicks, point.linkClicks);
    map.set(key, cur);
  }

  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => deriveMetrics(date, v));
}

function chartShortDate(iso: string, granularity: TrendGranularity): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const label = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return granularity === "weekly" ? `w/c ${label}` : label;
}

function chartTooltipDate(iso: string, granularity: TrendGranularity): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const label = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return granularity === "weekly" ? `Week commencing ${label}` : label;
}

function latestMetricValue(days: TrendChartDay[], key: MetricKey): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

export function EventTrendChart({
  timeline,
  points,
  className,
  title,
  defaultGranularity = "daily",
  showGranularityToggle = true,
}: Props) {
  const [granularity, setGranularity] =
    useState<TrendGranularity>(defaultGranularity);
  const sourcePoints = useMemo(
    () => points ?? timelineToPoints(timeline ?? []),
    [points, timeline],
  );
  const sourceDateCount = useMemo(
    () => new Set(sourcePoints.map((point) => point.date)).size,
    [sourcePoints],
  );
  const days = useMemo(
    () => aggregateTrendChartPoints(sourcePoints, granularity),
    [sourcePoints, granularity],
  );
  const [active, setActive] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(["spend", "tickets", "cpt"]),
  );
  const [hover, setHover] = useState<{
    index: number;
    chartWidth: number;
  } | null>(null);

  if (sourceDateCount < 2) return null;

  const titleLabel =
    title ?? `${granularity === "weekly" ? "Weekly" : "Daily"} trend`;

  const toggle = (key: MetricKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Refuse to deselect the only remaining metric — an empty
        // axis frame reads as a bug rather than an intentional state.
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Stretchable plot geometry. Text labels live in HTML below the SVG
  // so the stretched viewport doesn't squish them horizontally.
  const VB_W = 600;
  const VB_H = 150;
  const PAD_T = 8;
  const PAD_R = 8;
  const PAD_B = 8;
  const PAD_L = 8;
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;

  const xAt = (i: number): number =>
    days.length === 1
      ? PAD_L + plotW / 2
      : PAD_L + (i / (days.length - 1)) * plotW;

  type SeriesPoint = { x: number; y: number; v: number };
  type Series = {
    metric: MetricDef;
    metricMax: number;
    yMax: number;
    segments: SeriesPoint[][];
    points: SeriesPoint[];
  };
  const series: Series[] = METRICS.filter((m) => active.has(m.key)).map((m) => {
    const raw = days.map((d) => d[m.key]);
    const nonNull = raw.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    const metricMax = nonNull.length > 0 ? Math.max(...nonNull) : 0;
    const yMax = metricMax > 0 ? metricMax * 1.1 : 1;
    const segments: SeriesPoint[][] = [];
    const points: SeriesPoint[] = [];
    let cur: SeriesPoint[] = [];
    raw.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cur.length > 0) {
          segments.push(cur);
          cur = [];
        }
        return;
      }
      const y = PAD_T + plotH - (v / yMax) * plotH;
      const point: SeriesPoint = { x: xAt(i), y, v };
      cur.push(point);
      points.push(point);
    });
    if (cur.length > 0) segments.push(cur);
    return { metric: m, metricMax, yMax, segments, points };
  });

  // Y-axis ticks anchor to the *primary* metric (the leftmost active
  // pill in METRICS order). When a second series is active its
  // absolute values won't line up with these labels — that's an
  // inherent trade-off of independently-normalised series.
  const Y_TICK_COUNT = 4;
  const primary = series[0];
  const yTicks = primary
    ? Array.from({ length: Y_TICK_COUNT }, (_, i) => {
        const fraction = (Y_TICK_COUNT - 1 - i) / (Y_TICK_COUNT - 1);
        const value = primary.metricMax * fraction;
        const yPx = PAD_T + plotH - (value / primary.yMax) * plotH;
        return { value, yPx };
      })
    : [];

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || days.length === 0) return;
    const x = e.clientX - rect.left;
    const vbX = (x / rect.width) * VB_W;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < days.length; i++) {
      const dist = Math.abs(xAt(i) - vbX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    setHover({ index: nearest, chartWidth: rect.width });
  };

  // Cap visible date labels at ~6 regardless of point count so the
  // axis stays readable on mobile. Always anchor first + last.
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  const labelDays = days.filter(
    (_, i) => i === 0 || i === days.length - 1 || i % labelEvery === 0,
  );

  return (
    <div className={`rounded-md border border-border bg-card ${className ?? ""}`}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-sm tracking-wide">{titleLabel}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] text-muted-foreground">
              {days.length} {granularity === "weekly" ? "week" : "day"}
              {days.length === 1 ? "" : "s"} · click pills to toggle
            </p>
            {showGranularityToggle && (
              <div className="flex gap-1 border-l border-border pl-2">
                {(["daily", "weekly"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGranularity(value)}
                    aria-pressed={granularity === value}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize transition-colors ${
                      granularity === value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-muted-foreground hover:border-foreground/40"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {METRICS.map((m) => {
            const isActive = active.has(m.key);
            const latest = latestMetricValue(days, m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggle(m.key)}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:border-foreground/40"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: m.colour }}
                  aria-hidden="true"
                />
                {m.label}
                {latest !== null && (
                  <span
                    className={`tabular-nums ${
                      isActive ? "opacity-70" : "text-muted-foreground"
                    }`}
                  >
                    {m.format(latest)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex p-4">
        <div
          className="relative h-[150px] w-12 flex-shrink-0"
          aria-hidden={primary ? undefined : true}
        >
          {primary &&
            yTicks.map((t) => (
              <span
                key={t.value}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: `${t.yPx}px` }}
              >
                {primary.metric.format(t.value)}
              </span>
            ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-[150px]"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              width="100%"
              height={150}
              role="img"
              aria-label={`${titleLabel} metric trend chart`}
              className="overflow-visible"
            >
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={PAD_T + plotH}
                y2={PAD_T + plotH}
                stroke="currentColor"
                strokeOpacity={0.15}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {series.map((s) =>
                s.segments.map((seg, i) => (
                  <polyline
                    key={`${s.metric.key}-${i}`}
                    points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={s.metric.colour}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )),
              )}
              {series.map((s) =>
                s.points.map((p, i) => (
                  <circle
                    key={`${s.metric.key}-pt-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={2.5}
                    fill={s.metric.colour}
                    stroke="var(--background, #ffffff)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )),
              )}
            </svg>
            {hover &&
              (() => {
                const idx = hover.index;
                const day = days[idx];
                if (!day) return null;
                const vbX = xAt(idx);
                const pixelX = (vbX / VB_W) * hover.chartWidth;
                // Tooltip flips left of the hairline once we cross 60%
                // of the chart width — past-centre threshold avoids a
                // flicker on points hovering near the midpoint.
                const flipLeft = pixelX > hover.chartWidth * 0.6;
                return (
                  <>
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-foreground/30"
                      style={{ left: `${pixelX}px` }}
                      aria-hidden="true"
                    />
                    <div
                      className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-popover px-2.5 py-2 text-[11px] text-popover-foreground shadow-md"
                      style={
                        flipLeft
                          ? {
                              right: `${hover.chartWidth - pixelX + 8}px`,
                              top: 4,
                            }
                          : { left: `${pixelX + 8}px`, top: 4 }
                      }
                    >
                      <p className="mb-1 font-medium">
                        {chartTooltipDate(day.date, granularity)}
                      </p>
                      <ul className="space-y-0.5">
                        {series.map((s) => {
                          const v = day[s.metric.key];
                          return (
                            <li
                              key={s.metric.key}
                              className="flex items-center gap-2"
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: s.metric.colour }}
                                aria-hidden="true"
                              />
                              <span className="text-muted-foreground">
                                {s.metric.label}
                              </span>
                              <span className="ml-auto tabular-nums">
                                {v !== null && Number.isFinite(v)
                                  ? s.metric.format(v)
                                  : "—"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </>
                );
              })()}
          </div>
          <div className="pointer-events-none mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            {labelDays.map((d) => (
              <span key={d.date}>{chartShortDate(d.date, granularity)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
