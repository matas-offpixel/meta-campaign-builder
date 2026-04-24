"use client";

import { useMemo, useState } from "react";

import type { TimelineRow } from "@/lib/db/event-daily-timeline";

/**
 * components/dashboard/events/event-trend-chart.tsx
 *
 * Multi-metric daily trend chart for the event report block. Mirrors
 * the interaction model of the WC client portal's `CptTrendChart`
 * (`components/share/client-portal-venue-table.tsx`): pill toggles
 * double as the legend, a hairline + tooltip on hover, and each metric
 * gets its own normalised Y scale so trends are comparable even when
 * absolute values aren't.
 *
 * Self-hides when fewer than two distinct days of data exist — a
 * single point can't draw a line and the empty plot would imply data
 * we don't have. Callers don't need to gate the render themselves.
 *
 * Props are intentionally pre-resolved (a sorted timeline) so this
 * component is a pure presentation layer; the orchestrator does the
 * fetch + sync.
 */

interface ChartDay {
  date: string;
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
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
  timeline: TimelineRow[];
  /** Optional className override for layout adjustments. */
  className?: string;
}

/**
 * Convert the merged timeline into the chart's internal day shape.
 * Sorted ASC by date for direct consumption by the polyline geometry.
 * Nulls propagate so polylines are split across missing days rather
 * than drawing fake straight lines through the gaps.
 */
function timelineToChart(timeline: TimelineRow[]): ChartDay[] {
  // Timeline arrives DESC; render needs ASC so the line reads
  // left-to-right chronologically.
  const asc = [...timeline].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  return asc.map((r) => {
    const spend = r.ad_spend != null ? Number(r.ad_spend) : null;
    const tickets = r.tickets_sold != null ? Number(r.tickets_sold) : null;
    const revenue = r.revenue != null ? Number(r.revenue) : null;
    const linkClicks = r.link_clicks != null ? Number(r.link_clicks) : null;
    const cpt =
      spend != null && spend > 0 && tickets != null && tickets > 0
        ? spend / tickets
        : null;
    const roas =
      revenue != null && revenue > 0 && spend != null && spend > 0
        ? revenue / spend
        : null;
    const cpc =
      spend != null && spend > 0 && linkClicks != null && linkClicks > 0
        ? spend / linkClicks
        : null;
    return {
      date: r.date,
      spend,
      tickets,
      revenue,
      linkClicks,
      cpt,
      roas,
      cpc,
    };
  });
}

function chartShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function chartTooltipDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function latestMetricValue(days: ChartDay[], key: MetricKey): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

export function EventTrendChart({ timeline, className }: Props) {
  const days = useMemo(() => timelineToChart(timeline), [timeline]);
  const [active, setActive] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(["spend", "tickets", "cpt"]),
  );
  const [hover, setHover] = useState<{
    index: number;
    chartWidth: number;
  } | null>(null);

  if (days.length < 2) return null;

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
          <h3 className="font-heading text-sm tracking-wide">Daily trend</h3>
          <p className="text-[10px] text-muted-foreground">
            {days.length} day{days.length === 1 ? "" : "s"} · click pills to
            toggle
          </p>
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
              aria-label="Daily metric trend chart"
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
                        {chartTooltipDate(day.date)}
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
              <span key={d.date}>{chartShortDate(d.date)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
