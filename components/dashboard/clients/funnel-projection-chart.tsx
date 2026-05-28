"use client";

/**
 * components/dashboard/clients/funnel-projection-chart.tsx
 *
 * Interactive predictive projection for the Funnel Pacing tab (PR-D of
 * issue #467). Sits below the sliding scale. Pure presentation over the
 * canonical-funnel data already on the page — NO new Supabase queries,
 * NO new Meta API calls, NO source-of-truth re-derivation. All numbers
 * come from `buildFunnelProjection`, which itself only reshapes fields
 * the canonical funnel already exposes.
 *
 * Visual language matches the venue Daily Trend chart
 * (`components/dashboard/events/event-trend-chart.tsx`): a hand-rolled
 * inline SVG (viewBox 600×150, `preserveAspectRatio="none"`,
 * `vectorEffect="non-scaling-stroke"`), pill toggles, a hairline +
 * HTML tooltip on hover. No charting library is introduced.
 *
 * The x-axis toggle re-lenses the same three projections:
 *   - "Time"  → x = days from today to event date
 *   - "Spend" → x = cumulative £ spent
 * The last choice persists in localStorage per event code.
 */

import {
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  buildFunnelProjection,
  type FunnelProjection,
  type ProjectionLine,
  type ProjectionLineKey,
  type ProjectionXAxis,
} from "@/lib/dashboard/funnel-projection";

const NUM = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const GBP_2DP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const LINE_STYLE: Record<
  ProjectionLineKey,
  { colour: string; dash?: string; swatchDash: string }
> = {
  current: { colour: "#2563eb", swatchDash: "" },
  required: { colour: "#71717a", dash: "6 3", swatchDash: "6 3" },
  suggested: { colour: "#10b981", dash: "2 3", swatchDash: "2 3" },
};

// ── localStorage-backed x-axis preference ─────────────────────────────────
// A tiny external store read via useSyncExternalStore: SSR-safe (server
// snapshot is always "time", so no hydration mismatch warning), and the
// toggle updates synchronously without a setState-in-effect.
const axisCache = new Map<string, ProjectionXAxis>();
const axisListeners = new Map<string, Set<() => void>>();

function readAxisFromStorage(key: string): ProjectionXAxis {
  try {
    const v = window.localStorage.getItem(key);
    if (v === "time" || v === "spend") return v;
  } catch {
    /* localStorage unavailable */
  }
  return "time";
}
function getAxisSnapshot(key: string): ProjectionXAxis {
  if (!axisCache.has(key)) axisCache.set(key, readAxisFromStorage(key));
  return axisCache.get(key)!;
}
function setAxisPreference(key: string, next: ProjectionXAxis) {
  axisCache.set(key, next);
  try {
    window.localStorage.setItem(key, next);
  } catch {
    /* ignore persistence failures */
  }
  axisListeners.get(key)?.forEach((listener) => listener());
}
function subscribeAxis(key: string, cb: () => void) {
  let set = axisListeners.get(key);
  if (!set) {
    set = new Set();
    axisListeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

const VB_W = 600;
const VB_H = 150;
const PAD_T = 10;
const PAD_R = 10;
const PAD_B = 10;
const PAD_L = 10;
const PLOT_W = VB_W - PAD_L - PAD_R;
const PLOT_H = VB_H - PAD_T - PAD_B;

export interface FunnelProjectionChartProps {
  capacity: number;
  ticketsSold: number;
  spent: number;
  allocated: number | null;
  spentPerDay: number | null;
  liveCostPerTicket: number | null;
  benchmarkCostPerTicket: number;
  daysToEvent: number | null;
  daysSinceFirstSpend: number | null;
  eventDate: string | null;
  warning: "additional_needed" | "pace_covered" | null;
  warningAmount: number | null;
  /** localStorage key suffix — usually the venue event code. */
  eventCode: string;
}

export function FunnelProjectionChart(props: FunnelProjectionChartProps) {
  const projection = useMemo(
    () =>
      buildFunnelProjection({
        capacity: props.capacity,
        ticketsSold: props.ticketsSold,
        spent: props.spent,
        allocated: props.allocated,
        spentPerDay: props.spentPerDay,
        liveCostPerTicket: props.liveCostPerTicket,
        benchmarkCostPerTicket: props.benchmarkCostPerTicket,
        daysToEvent: props.daysToEvent,
        daysSinceFirstSpend: props.daysSinceFirstSpend,
        eventDate: props.eventDate,
        warning: props.warning,
        warningAmount: props.warningAmount,
      }),
    [props],
  );

  const storageKey = `funnel-projection-xaxis-${props.eventCode}`;
  const xAxis = useSyncExternalStore(
    (cb) => subscribeAxis(storageKey, cb),
    () => getAxisSnapshot(storageKey),
    () => "time" as ProjectionXAxis,
  );
  const chooseAxis = (next: ProjectionXAxis) =>
    setAxisPreference(storageKey, next);

  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-testid="funnel-pacing-projection"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Projection
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Forward projection
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Where current spend takes you by event date, versus the pace
            needed to sell out — at this event&apos;s live efficiency and at
            benchmark efficiency.
          </p>
        </div>
        {projection.available ? (
          <AxisToggle xAxis={xAxis} onChange={chooseAxis} />
        ) : null}
      </div>

      {projection.available ? (
        <>
          <ProjectionBanner projection={projection} />
          <ProjectionPlot projection={projection} xAxis={xAxis} />
          <Legend projection={projection} />
        </>
      ) : (
        <UnavailableState projection={projection} />
      )}
    </article>
  );
}

function AxisToggle({
  xAxis,
  onChange,
}: {
  xAxis: ProjectionXAxis;
  onChange: (next: ProjectionXAxis) => void;
}) {
  const options: { value: ProjectionXAxis; label: string }[] = [
    { value: "time", label: "Time" },
    { value: "spend", label: "Spend" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Projection x-axis"
      className="inline-flex shrink-0 gap-1 rounded-full border border-border p-0.5"
    >
      {options.map((opt) => {
        const active = xAxis === opt.value;
        return (
          <button
            key={opt.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ProjectionBanner({ projection }: { projection: FunnelProjection }) {
  if (!projection.campaignLive) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Campaign not yet live — projection based on benchmark efficiency
          only.
        </span>
      </div>
    );
  }
  if (projection.warning === "additional_needed") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <span>
          Current pace falls short of sellout by event date
          {projection.warningAmount != null
            ? ` by ${GBP.format(projection.warningAmount)}`
            : ""}
          .
          {projection.requiredPerDay != null
            ? ` Increase daily spend to ${GBP.format(projection.requiredPerDay)} to recover.`
            : ""}
        </span>
      </div>
    );
  }
  if (projection.warning === "pace_covered") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
        <span>Current pace is sufficient to sell out by event date.</span>
      </div>
    );
  }
  return null;
}

function UnavailableState({ projection }: { projection: FunnelProjection }) {
  const reason =
    projection.ticketsRemaining <= 0
      ? "Sold out — nothing left to project."
      : projection.daysToEvent <= 0
        ? "Event date has passed."
        : "No event date set — projection unavailable.";
  return (
    <div className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
      {reason}
    </div>
  );
}

interface HoverState {
  /** Fraction along the primary line's sample points [0..1]. */
  index: number;
  chartWidth: number;
}

function ProjectionPlot({
  projection,
  xAxis,
}: {
  projection: FunnelProjection;
  xAxis: ProjectionXAxis;
}) {
  const captionId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  // The "primary" line drives hover read-out: Current pace when live,
  // else the first available (benchmark) line.
  const primary =
    projection.lines.find((l) => l.key === "current") ??
    projection.lines[0] ??
    null;

  // ── Scales ───────────────────────────────────────────────────────────
  const yMax = useMemo(() => {
    const endpoints = projection.lines.map((l) => l.endpointTickets);
    return Math.max(projection.capacity, ...endpoints, 1) * 1.06;
  }, [projection]);

  const xDomain = useMemo(() => {
    if (xAxis === "time") return { min: 0, max: projection.daysToEvent };
    const endpointSpends = projection.lines.map((l) => l.endpointSpend);
    const max = Math.max(
      projection.requiredTotalSpend ?? 0,
      projection.sellout.spend ?? 0,
      ...endpointSpends,
      projection.spent + 1,
    );
    return { min: projection.spent, max: max * 1.02 };
  }, [xAxis, projection]);

  const xScale = (line: ProjectionLine, pointIndex: number): number => {
    const p = line.points[pointIndex]!;
    const value = xAxis === "time" ? p.day : p.spend;
    const span = xDomain.max - xDomain.min || 1;
    return PAD_L + ((value - xDomain.min) / span) * PLOT_W;
  };
  const xScaleValue = (value: number): number => {
    const span = xDomain.max - xDomain.min || 1;
    return PAD_L + ((value - xDomain.min) / span) * PLOT_W;
  };
  const yScale = (tickets: number): number =>
    PAD_T + PLOT_H - (tickets / yMax) * PLOT_H;

  // ── Markers ──────────────────────────────────────────────────────────
  const capacityYVB = yScale(projection.capacity);
  const eventMarkerX =
    xAxis === "time"
      ? xScaleValue(projection.daysToEvent)
      : projection.requiredTotalSpend != null
        ? xScaleValue(projection.requiredTotalSpend)
        : null;
  const selloutX =
    projection.sellout.day != null
      ? xAxis === "time"
        ? xScaleValue(projection.sellout.day)
        : projection.sellout.spend != null
          ? xScaleValue(projection.sellout.spend)
          : null
      : null;

  // ── Hover handling ───────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!primary) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = e.clientX - rect.left;
    const vbX = (x / rect.width) * VB_W;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < primary.points.length; i++) {
      const dist = Math.abs(xScale(primary, i) - vbX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }
    setHover({ index: nearest, chartWidth: rect.width });
  };

  const hovered =
    hover && primary ? primary.points[hover.index] ?? null : null;

  const toPercent = (xVB: number) => `${(xVB / VB_W) * 100}%`;

  // Date for a given day offset, derived from the resolved eventDate so
  // it never drifts from the server's "today".
  const dateForDay = (day: number): string => {
    if (!projection.eventDate) return "";
    const eventMs = Date.parse(`${projection.eventDate}T00:00:00Z`);
    if (Number.isNaN(eventMs)) return "";
    const ms = eventMs - (projection.daysToEvent - day) * 86_400_000;
    return new Date(ms).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  };

  return (
    <figure className="mt-4">
      <div className="flex">
        <div className="relative h-[150px] w-12 flex-shrink-0" aria-hidden>
          {[1, 0.66, 0.33, 0].map((fraction) => (
            <span
              key={fraction}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ top: `${PAD_T + PLOT_H - fraction * PLOT_H}px` }}
            >
              {NUM.format(Math.round(yMax * fraction))}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            ref={plotRef}
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
              aria-labelledby={captionId}
              className="overflow-visible"
            >
              {/* baseline */}
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={PAD_T + PLOT_H}
                y2={PAD_T + PLOT_H}
                stroke="currentColor"
                strokeOpacity={0.15}
                vectorEffect="non-scaling-stroke"
              />
              {/* capacity / sellout horizontal */}
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={capacityYVB}
                y2={capacityYVB}
                stroke="#a1a1aa"
                strokeWidth={1}
                strokeDasharray="4 3"
                vectorEffect="non-scaling-stroke"
              />
              {/* event-date vertical */}
              {eventMarkerX != null && (
                <line
                  x1={eventMarkerX}
                  x2={eventMarkerX}
                  y1={PAD_T}
                  y2={PAD_T + PLOT_H}
                  stroke="#a1a1aa"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* sellout drop-line (current pace crossing) */}
              {selloutX != null && (
                <line
                  x1={selloutX}
                  x2={selloutX}
                  y1={capacityYVB}
                  y2={PAD_T + PLOT_H}
                  stroke={LINE_STYLE.current.colour}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* projection lines */}
              {projection.lines.map((line) => {
                const style = LINE_STYLE[line.key];
                const pts = line.points
                  .map((_, i) => `${xScale(line, i)},${yScale(line.points[i]!.tickets)}`)
                  .join(" ");
                return (
                  <polyline
                    key={line.key}
                    points={pts}
                    fill="none"
                    stroke={style.colour}
                    strokeWidth={2}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              {/* hover marker on primary line */}
              {hovered && (
                <circle
                  cx={xScale(primary!, hover!.index)}
                  cy={yScale(hovered.tickets)}
                  r={3}
                  fill={LINE_STYLE[primary!.key].colour}
                  stroke="var(--background, #ffffff)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* capacity label */}
            <span
              className="pointer-events-none absolute right-0 -translate-y-1/2 rounded bg-muted px-1 text-[9px] font-medium tabular-nums text-muted-foreground"
              style={{ top: `${capacityYVB}px` }}
            >
              Capacity {NUM.format(projection.capacity)}
            </span>

            {/* event-date label */}
            {eventMarkerX != null && (
              <span
                className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground"
                style={{ left: toPercent(eventMarkerX) }}
              >
                {xAxis === "time"
                  ? `Event ${projection.eventDate ? dateForDay(projection.daysToEvent) : ""}`
                  : "Event date"}
              </span>
            )}

            {/* sellout label */}
            {selloutX != null && (
              <span
                className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded px-1 text-[9px] font-medium"
                style={{
                  left: toPercent(selloutX),
                  top: `${capacityYVB - 14}px`,
                  color: LINE_STYLE.current.colour,
                }}
              >
                {xAxis === "time"
                  ? `Sellout ${projection.sellout.date ? formatIso(projection.sellout.date) : ""}`
                  : `Sellout ${projection.sellout.spend != null ? GBP.format(projection.sellout.spend) : ""}`}
              </span>
            )}

            {/* hover hairline + tooltip */}
            {hover &&
              hovered &&
              primary &&
              (() => {
                const vbX = xScale(primary, hover.index);
                const pixelX = (vbX / VB_W) * hover.chartWidth;
                const flipLeft = pixelX > hover.chartWidth * 0.6;
                const remaining = Math.max(
                  0,
                  projection.capacity - hovered.tickets,
                );
                const budgetRemaining =
                  projection.allocated != null
                    ? projection.allocated - hovered.spend
                    : null;
                const impliedCpt =
                  hovered.tickets > 0 ? hovered.spend / hovered.tickets : null;
                return (
                  <>
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-foreground/30"
                      style={{ left: `${pixelX}px` }}
                      aria-hidden
                    />
                    <div
                      className="pointer-events-none absolute z-20 min-w-[180px] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] text-card-foreground shadow-lg"
                      style={
                        flipLeft
                          ? { right: `${hover.chartWidth - pixelX + 8}px`, top: 4 }
                          : { left: `${pixelX + 8}px`, top: 4 }
                      }
                    >
                      <p className="mb-1 font-medium">
                        {xAxis === "time"
                          ? dateForDay(hovered.day)
                          : `${GBP.format(hovered.spend)} spent`}
                      </p>
                      <ul className="space-y-0.5">
                        <TooltipRow
                          label="Projected tickets"
                          value={NUM.format(Math.round(hovered.tickets))}
                        />
                        <TooltipRow
                          label="Remaining"
                          value={`${NUM.format(Math.round(remaining))} / ${NUM.format(projection.capacity)}`}
                        />
                        <TooltipRow
                          label="Spent"
                          value={GBP.format(hovered.spend)}
                        />
                        <TooltipRow
                          label="Budget left"
                          value={
                            budgetRemaining == null
                              ? "—"
                              : GBP.format(budgetRemaining)
                          }
                        />
                        <TooltipRow
                          label="Implied CPT"
                          value={
                            impliedCpt == null ? "—" : GBP_2DP.format(impliedCpt)
                          }
                        />
                      </ul>
                    </div>
                  </>
                );
              })()}
          </div>

          {/* x-axis end labels */}
          <div className="pointer-events-none mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
            <span>
              {xAxis === "time" ? "Today" : GBP.format(projection.spent)}
            </span>
            <span>
              {xAxis === "time"
                ? projection.eventDate
                  ? formatIso(projection.eventDate)
                  : `Day ${projection.daysToEvent}`
                : GBP.format(xDomain.max)}
            </span>
          </div>
        </div>
      </div>

      <figcaption id={captionId} className="mt-3 text-xs text-muted-foreground">
        {buildCaption(projection)}
      </figcaption>
    </figure>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto tabular-nums">{value}</span>
    </li>
  );
}

function Legend({ projection }: { projection: FunnelProjection }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {projection.lines.map((line) => {
        const style = LINE_STYLE[line.key];
        return (
          <span
            key={line.key}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <svg width="18" height="6" aria-hidden className="shrink-0">
              <line
                x1="0"
                y1="3"
                x2="18"
                y2="3"
                stroke={style.colour}
                strokeWidth={2}
                strokeDasharray={style.swatchDash || undefined}
              />
            </svg>
            {line.label}
            {line.dailySpend != null ? (
              <span className="tabular-nums">
                {" "}
                ({GBP.format(line.dailySpend)}/day)
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function formatIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function buildCaption(projection: FunnelProjection): string {
  const parts: string[] = [];
  const eventLabel = projection.eventDate
    ? formatIso(projection.eventDate)
    : `${projection.daysToEvent} days out`;
  parts.push(`Forward projection to event date (${eventLabel}).`);

  const current = projection.lines.find((l) => l.key === "current");
  if (current) {
    const reaches = current.reachesCapacity;
    parts.push(
      `Current pace (solid): at ${GBP.format(current.dailySpend ?? 0)}/day and ${GBP_2DP.format(current.costPerTicket)}/ticket, projected to ${NUM.format(Math.round(current.endpointTickets))} of ${NUM.format(projection.capacity)} tickets — ${reaches ? "sells out before event date" : "short of sellout"}.`,
    );
  } else {
    parts.push("Current pace hidden — campaign not yet live.");
  }

  if (projection.requiredPerDay != null) {
    parts.push(
      `Required pace (dashed): ${GBP.format(projection.requiredPerDay)}/day sells out exactly on event date at this event's live efficiency.`,
    );
  }
  if (projection.suggestedDaily != null) {
    parts.push(
      `Suggested (dotted): ${GBP.format(projection.suggestedDaily)}/day at benchmark efficiency.`,
    );
  }
  return parts.join(" ");
}
