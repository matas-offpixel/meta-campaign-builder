"use client";

import { useMemo, useState } from "react";

import {
  paidLinkClicksOf,
  paidSpendOf,
} from "@/lib/dashboard/paid-spend";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import {
  aggregateTrendChartPoints,
  hasCumulativeTicketPoints,
  summarizeTrendChartPoints,
  type TrendChartPoint,
  type TrendGranularity,
  type TrendSummary,
} from "@/lib/dashboard/trend-chart-data";

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
  kind?: string | null;
  defaultGranularity?: TrendGranularity;
  showGranularityToggle?: boolean;
}

function timelineToPoints(timeline: TimelineRow[]): TrendChartPoint[] {
  return timeline.map((r) => ({
    date: r.date,
    spend:
      r.ad_spend != null || r.tiktok_spend != null ? paidSpendOf(r) : null,
    tickets: r.tickets_sold != null ? Number(r.tickets_sold) : null,
    revenue: r.revenue != null ? Number(r.revenue) : null,
    linkClicks:
      r.link_clicks != null || r.tiktok_clicks != null
        ? paidLinkClicksOf(r)
        : null,
  }));
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

function pillMetricValue(summary: TrendSummary, key: MetricKey): number | null {
  return summary[key];
}

export function EventTrendChart(props: Props) {
  if (props.kind === "brand_campaign" && props.timeline) {
    return (
      <AwarenessTrendChart
        timeline={props.timeline}
        className={props.className}
        title={props.title}
        defaultGranularity={props.defaultGranularity ?? "daily"}
        showGranularityToggle={props.showGranularityToggle ?? true}
      />
    );
  }
  return <LegacyTrendChart {...props} />;
}

function LegacyTrendChart({
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
  const hasCumulativeTickets = useMemo(
    () => hasCumulativeTicketPoints(sourcePoints),
    [sourcePoints],
  );
  const days = useMemo(
    () => aggregateTrendChartPoints(sourcePoints, granularity),
    [sourcePoints, granularity],
  );
  const summary = useMemo(
    () => summarizeTrendChartPoints(days, hasCumulativeTickets),
    [days, hasCumulativeTickets],
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
            const latest = pillMetricValue(summary, m.key);
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
                      className="pointer-events-none absolute z-20 min-w-[150px] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] text-card-foreground shadow-lg"
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

type AwarenessMetricKey = "spend" | "impressions" | "clicks" | "videoViews";
type PlatformKey = "all" | "meta" | "google" | "tiktok";

const AWARENESS_METRICS: {
  key: AwarenessMetricKey;
  label: string;
  colour: string;
  format: (n: number) => string;
}[] = [
  { key: "spend", label: "Spend", colour: "#27272a", format: (n) => GBP2.format(n) },
  { key: "impressions", label: "Impressions", colour: "#2563eb", format: (n) => NUM.format(n) },
  { key: "clicks", label: "Clicks", colour: "#0ea5e9", format: (n) => NUM.format(n) },
  { key: "videoViews", label: "Video Views", colour: "#8b5cf6", format: (n) => NUM.format(n) },
];

const PLATFORM_META: Record<Exclude<PlatformKey, "all">, { label: string; colour: string }> = {
  meta: { label: "Meta", colour: "#2563eb" },
  google: { label: "Google Ads", colour: "#ea4335" },
  tiktok: { label: "TikTok", colour: "#111827" },
};

function AwarenessTrendChart({
  timeline,
  className,
  title,
  defaultGranularity,
  showGranularityToggle,
}: {
  timeline: TimelineRow[];
  className?: string;
  title?: string;
  defaultGranularity: TrendGranularity;
  showGranularityToggle: boolean;
}) {
  const [granularity, setGranularity] =
    useState<TrendGranularity>(defaultGranularity);
  const [platform, setPlatform] = useState<PlatformKey>("all");
  const [metrics, setMetrics] = useState<AwarenessMetricKey[]>(["spend"]);
  const [hover, setHover] = useState<{ index: number; chartWidth: number } | null>(null);
  const rows = useMemo(
    () => buildAwarenessRows(timeline, granularity),
    [timeline, granularity],
  );
  const platforms = (["meta", "google", "tiktok"] as const).filter((p) =>
    rows.some((r) => hasPlatformSignal(r[p])),
  );
  const platformOptions: PlatformKey[] =
    platforms.length > 1 ? ["all", ...platforms] : platforms;
  const activePlatform =
    platform === "all" && platforms.length === 1 ? platforms[0]! : platform;
  const visibleSeries: Exclude<PlatformKey, "all">[] =
    activePlatform === "all"
      ? platforms
      : ([activePlatform] as Exclude<PlatformKey, "all">[]);
  const metricDefs = metrics
    .map((metric) => AWARENESS_METRICS.find((m) => m.key === metric))
    .filter((m): m is (typeof AWARENESS_METRICS)[number] => m != null);
  const titleLabel =
    title ?? `${granularity === "weekly" ? "Weekly" : "Daily"} trend`;

  if (rows.length < 2 || platforms.length === 0) return null;

  const VB_W = 600;
  const VB_H = 150;
  const PAD_T = 8;
  const PAD_R = 8;
  const PAD_B = 8;
  const PAD_L = 8;
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;
  const xAt = (i: number) =>
    rows.length === 1 ? PAD_L + plotW / 2 : PAD_L + (i / (rows.length - 1)) * plotW;
  const max = Math.max(
    1,
    ...metricDefs.flatMap((m) => rows.map((r) => maxMetricValue(r, visibleSeries, m.key))),
  );
  const yAt = (v: number) => PAD_T + plotH - (v / (max * 1.1)) * plotH;
  const labelEvery = Math.max(1, Math.ceil(rows.length / 6));
  const labelRows = rows.filter(
    (_, i) => i === 0 || i === rows.length - 1 || i % labelEvery === 0,
  );

  return (
    <div className={`rounded-md border border-border bg-card ${className ?? ""}`}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-sm tracking-wide">{titleLabel}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] text-muted-foreground">
              {rows.length} {granularity === "weekly" ? "week" : "day"}
              {rows.length === 1 ? "" : "s"}
            </p>
            {showGranularityToggle ? (
              <div className="flex gap-1 border-l border-border pl-2">
                {(["daily", "weekly"] as const).map((value) => (
                  <Pill
                    key={value}
                    active={granularity === value}
                    onClick={() => setGranularity(value)}
                  >
                    {value}
                  </Pill>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {platformOptions.map((p) => (
            <Pill key={p} active={activePlatform === p} onClick={() => setPlatform(p)}>
              {p === "all" ? "All" : PLATFORM_META[p].label}
            </Pill>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AWARENESS_METRICS.map((m) => (
            <Pill
              key={m.key}
              active={metrics.includes(m.key)}
              onClick={() => setMetrics((current) => toggleAwarenessMetric(current, m.key))}
            >
              {metrics.includes(m.key) ? "✓ " : ""}
              {m.label}
            </Pill>
          ))}
        </div>
      </div>
      <div className="flex p-4">
        <div className="relative h-[150px] w-12 flex-shrink-0" aria-hidden>
          {[1, 0.66, 0.33, 0].map((fraction) => (
            <span
              key={fraction}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ top: `${PAD_T + plotH - fraction * plotH}px` }}
            >
              {formatAwarenessAxis(metricDefs, max * fraction)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="relative h-[150px]"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width === 0) return;
              const vbX = ((e.clientX - rect.left) / rect.width) * VB_W;
              let nearest = 0;
              let dist = Infinity;
              rows.forEach((_, i) => {
                const d = Math.abs(xAt(i) - vbX);
                if (d < dist) {
                  dist = d;
                  nearest = i;
                }
              });
              setHover({ index: nearest, chartWidth: rect.width });
            }}
            onMouseLeave={() => setHover(null)}
          >
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" width="100%" height={150}>
              <line x1={PAD_L} x2={VB_W - PAD_R} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="currentColor" strokeOpacity={0.15} />
              {metricDefs.map((m) =>
                visibleSeries.map((p) => (
                  <polyline
                    key={`${p}-${m.key}`}
                    points={rows
                      .map((r, i) => `${xAt(i)},${yAt(r[p][m.key])}`)
                      .join(" ")}
                    fill="none"
                    stroke={activePlatform === "all" ? PLATFORM_META[p].colour : m.colour}
                    strokeDasharray={activePlatform === "all" ? metricDash(m.key) : undefined}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                )),
              )}
            </svg>
            {hover ? (
              <div
                className="pointer-events-none absolute z-20 min-w-[170px] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] text-card-foreground shadow-lg"
                style={{ left: Math.min((xAt(hover.index) / VB_W) * hover.chartWidth + 8, hover.chartWidth - 180), top: 4 }}
              >
                <p className="mb-1 font-medium">
                  {chartTooltipDate(rows[hover.index]!.date, granularity)}
                </p>
                {metricDefs.flatMap((m) =>
                  visibleSeries.map((p) => (
                    <p key={`${p}-${m.key}`} className="flex gap-2">
                      <span style={{ color: activePlatform === "all" ? PLATFORM_META[p].colour : m.colour }}>●</span>
                      <span className="text-muted-foreground">
                        {activePlatform === "all" ? `${PLATFORM_META[p].label} · ` : ""}
                        {m.label}
                      </span>
                      <span className="ml-auto tabular-nums">
                        {m.format(rows[hover.index]![p][m.key])}
                      </span>
                    </p>
                  )),
                )}
              </div>
            ) : null}
          </div>
          <div className="pointer-events-none mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            {labelRows.map((d) => (
              <span key={d.date}>{chartShortDate(d.date, granularity)}</span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {activePlatform === "all"
              ? visibleSeries.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLATFORM_META[p].colour }} />
                    {PLATFORM_META[p].label}
                  </span>
                ))
              : metricDefs.map((m) => (
                  <span key={m.key} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.colour }} />
                    {m.label}
                  </span>
                ))}
          </div>
          {activePlatform === "all" && metricDefs.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              {metricDefs.map((m) => (
                <span key={m.key} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-4 rounded-full bg-muted-foreground/60" />
                  {m.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground/40"
      }`}
    >
      {children}
    </button>
  );
}

function toggleAwarenessMetric(
  current: AwarenessMetricKey[],
  metric: AwarenessMetricKey,
): AwarenessMetricKey[] {
  if (current.includes(metric)) {
    return current.length === 1 ? current : current.filter((m) => m !== metric);
  }
  return [...current, metric].slice(-4);
}

function metricDash(metric: AwarenessMetricKey): string | undefined {
  if (metric === "spend") return undefined;
  if (metric === "impressions") return "6 3";
  if (metric === "clicks") return "2 3";
  return "8 3 2 3";
}

function maxMetricValue(
  row: ReturnType<typeof buildAwarenessRows>[number],
  platforms: Exclude<PlatformKey, "all">[],
  metric: AwarenessMetricKey,
): number {
  return platforms.reduce((max, platform) => Math.max(max, row[platform][metric]), 0);
}

function formatAwarenessAxis(
  metrics: Array<(typeof AWARENESS_METRICS)[number]>,
  value: number,
): string {
  return metrics.length === 1 && metrics[0]?.key === "spend"
    ? GBP2.format(value)
    : NUM.format(Math.round(value));
}

function platformValues(
  row: TimelineRow,
  platform: Exclude<PlatformKey, "all">,
): Record<AwarenessMetricKey, number> {
  if (platform === "meta") {
    return {
      spend: Number(row.ad_spend ?? 0),
      impressions: Number((row as { impressions?: number | null }).impressions ?? 0),
      clicks: Number(row.link_clicks ?? 0),
      videoViews: Number((row as { meta_video_views?: number | null }).meta_video_views ?? 0),
    };
  }
  if (platform === "google") {
    return {
      spend: Number(row.google_ads_spend ?? 0),
      impressions: Number(row.google_ads_impressions ?? 0),
      clicks: Number(row.google_ads_clicks ?? 0),
      videoViews: Number(row.google_ads_video_views ?? 0),
    };
  }
  return {
    spend: Number(row.tiktok_spend ?? 0),
    impressions: Number(row.tiktok_impressions ?? 0),
    clicks: Number(row.tiktok_clicks ?? 0),
    videoViews: Number(row.tiktok_video_views ?? 0),
  };
}

function hasPlatformSignal(values: Record<AwarenessMetricKey, number>): boolean {
  return Object.values(values).some((value) => value > 0);
}

function buildAwarenessRows(timeline: TimelineRow[], granularity: TrendGranularity) {
  const daily = timeline
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date,
      meta: platformValues(r, "meta"),
      google: platformValues(r, "google"),
      tiktok: platformValues(r, "tiktok"),
    }));
  if (granularity === "daily") return daily;
  const byWeek = new Map<string, (typeof daily)[number]>();
  for (const row of daily) {
    const week = weekStart(row.date);
    const cur =
      byWeek.get(week) ??
      ({
        date: week,
        meta: zeroAwareness(),
        google: zeroAwareness(),
        tiktok: zeroAwareness(),
      } satisfies (typeof daily)[number]);
    for (const platform of ["meta", "google", "tiktok"] as const) {
      for (const metric of ["spend", "impressions", "clicks", "videoViews"] as const) {
        cur[platform][metric] += row[platform][metric];
      }
    }
    byWeek.set(week, cur);
  }
  return [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function zeroAwareness(): Record<AwarenessMetricKey, number> {
  return { spend: 0, impressions: 0, clicks: 0, videoViews: 0 };
}

function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const dow = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (dow - 1));
  return date.toISOString().slice(0, 10);
}
