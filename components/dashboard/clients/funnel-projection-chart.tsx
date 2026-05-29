"use client";

/**
 * components/dashboard/clients/funnel-projection-chart.tsx
 *
 * Interactive forward-projection chart for the Funnel Pacing tab.
 * Originally PR-D of issue #467; upgraded in the visual-overhaul PR with
 * gradient area fills, a taller plot (≥320px desktop), status-coloured
 * current-pace line, more prominent sellout / event markers, and an
 * optional scrubber override that redraws the current-pace line live.
 *
 * Pure presentation over the canonical-funnel data already on the page —
 * NO new Supabase queries, NO new Meta API calls. All numbers come from
 * `buildFunnelProjection`, which only reshapes canonical fields. No
 * charting library is introduced; the SVG is hand-rolled to match the
 * venue Daily Trend chart's visual language.
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
import { toneColors } from "@/lib/dashboard/pacing-presentation";

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

interface LineStyle {
  colour: string;
  dash?: string;
  swatchDash: string;
}

/**
 * Line styles. `current` colour is resolved at render time from the
 * projection's warning state (emerald when on/ahead of pace, red when
 * short). Required = neutral dashed, Suggested = blue dotted accent.
 */
function lineStyles(currentColour: string): Record<ProjectionLineKey, LineStyle> {
  return {
    current: { colour: currentColour, swatchDash: "" },
    required: { colour: "#71717a", dash: "6 3", swatchDash: "6 3" },
    suggested: { colour: "#2563eb", dash: "2 3", swatchDash: "2 3" },
  };
}

// ── localStorage-backed x-axis preference ─────────────────────────────────
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
const VB_H = 300;
const PAD_T = 16;
const PAD_R = 12;
const PAD_B = 16;
const PAD_L = 12;
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
  /**
   * When the spend scrubber is engaged, this overrides the daily spend
   * used for the Current-pace line so it redraws live as the operator
   * drags. `null`/undefined → use the live `spentPerDay`.
   */
  projectedDailyOverride?: number | null;
}

export function FunnelProjectionChart(props: FunnelProjectionChartProps) {
  const overrideActive =
    props.projectedDailyOverride != null &&
    props.spentPerDay != null &&
    Math.abs(props.projectedDailyOverride - props.spentPerDay) > 0.5;

  const projection = useMemo(
    () =>
      buildFunnelProjection({
        capacity: props.capacity,
        ticketsSold: props.ticketsSold,
        spent: props.spent,
        allocated: props.allocated,
        spentPerDay:
          props.projectedDailyOverride != null
            ? props.projectedDailyOverride
            : props.spentPerDay,
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

  // Current-pace line colour: red when short of sellout, emerald otherwise.
  const currentColour =
    projection.warning === "additional_needed"
      ? toneColors("below").hex
      : toneColors("above").hex;
  const styles = lineStyles(currentColour);

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
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
            {overrideActive ? " Current line reflects the scrubber position." : ""}
          </p>
        </div>
        {projection.available ? (
          <AxisToggle xAxis={xAxis} onChange={chooseAxis} />
        ) : null}
      </div>

      {projection.available ? (
        <>
          <ProjectionBanner projection={projection} />
          <ProjectionPlot
            projection={projection}
            xAxis={xAxis}
            styles={styles}
          />
          <Legend projection={projection} styles={styles} />
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
      <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
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
  index: number;
  chartWidth: number;
}

function ProjectionPlot({
  projection,
  xAxis,
  styles,
}: {
  projection: FunnelProjection;
  xAxis: ProjectionXAxis;
  styles: Record<ProjectionLineKey, LineStyle>;
}) {
  const captionId = useId();
  const gradId = useId();
  const plotRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const primary =
    projection.lines.find((l) => l.key === "current") ??
    projection.lines[0] ??
    null;

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

  // Build a closed area path (line points → down to baseline → back) so
  // each line gets a subtle gradient fill underneath for depth.
  const areaPath = (line: ProjectionLine): string => {
    const pts = line.points.map(
      (_, i) => `${xScale(line, i)},${yScale(line.points[i]!.tickets)}`,
    );
    if (pts.length === 0) return "";
    const firstX = xScale(line, 0);
    const lastX = xScale(line, line.points.length - 1);
    const baseY = PAD_T + PLOT_H;
    return `M ${firstX},${baseY} L ${pts.join(" L ")} L ${lastX},${baseY} Z`;
  };

  return (
    <figure className="mt-4">
      <div className="flex">
        <div
          className="relative h-[260px] w-12 flex-shrink-0 sm:h-[320px]"
          aria-hidden
        >
          {[1, 0.66, 0.33, 0].map((fraction) => (
            <span
              key={fraction}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
              style={{ top: `${(PAD_T + PLOT_H - fraction * PLOT_H) / VB_H * 100}%` }}
            >
              {NUM.format(Math.round(yMax * fraction))}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            ref={plotRef}
            className="relative h-[260px] sm:h-[320px]"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHover(null)}
          >
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              preserveAspectRatio="none"
              width="100%"
              height="100%"
              role="img"
              aria-labelledby={captionId}
              className="overflow-visible"
            >
              <defs>
                {projection.lines.map((line) => {
                  const style = styles[line.key];
                  return (
                    <linearGradient
                      key={line.key}
                      id={`${gradId}-${line.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={style.colour}
                        stopOpacity={line.key === "current" ? 0.22 : 0.08}
                      />
                      <stop
                        offset="100%"
                        stopColor={style.colour}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  );
                })}
              </defs>

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

              {/* gradient area fills (drawn behind lines) */}
              {projection.lines.map((line) => (
                <path
                  key={`area-${line.key}`}
                  d={areaPath(line)}
                  fill={`url(#${gradId}-${line.key})`}
                  stroke="none"
                />
              ))}

              {/* capacity / sellout horizontal */}
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={capacityYVB}
                y2={capacityYVB}
                stroke="#a1a1aa"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />

              {/* event-date vertical (bold) */}
              {eventMarkerX != null && (
                <line
                  x1={eventMarkerX}
                  x2={eventMarkerX}
                  y1={PAD_T}
                  y2={PAD_T + PLOT_H}
                  stroke="#52525b"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
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
                  stroke={styles.current.colour}
                  strokeWidth={1.5}
                  strokeDasharray="3 2"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* projection lines */}
              {projection.lines.map((line) => {
                const style = styles[line.key];
                const pts = line.points
                  .map(
                    (_, i) =>
                      `${xScale(line, i)},${yScale(line.points[i]!.tickets)}`,
                  )
                  .join(" ");
                return (
                  <polyline
                    key={line.key}
                    points={pts}
                    fill="none"
                    stroke={style.colour}
                    strokeWidth={2.5}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}

              {/* sellout crossing marker dot */}
              {selloutX != null && (
                <circle
                  cx={selloutX}
                  cy={capacityYVB}
                  r={4}
                  fill={styles.current.colour}
                  stroke="var(--background, #ffffff)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {/* hover marker on primary line */}
              {hovered && (
                <circle
                  cx={xScale(primary!, hover!.index)}
                  cy={yScale(hovered.tickets)}
                  r={3.5}
                  fill={styles[primary!.key].colour}
                  stroke="var(--background, #ffffff)"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* capacity label */}
            <span
              className="pointer-events-none absolute right-0 -translate-y-1/2 rounded bg-muted px-1 text-[9px] font-medium tabular-nums text-muted-foreground"
              style={{ top: `${(capacityYVB / VB_H) * 100}%` }}
            >
              Capacity {NUM.format(projection.capacity)}
            </span>

            {/* event-date label */}
            {eventMarkerX != null && (
              <span
                className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1 text-[9px] font-medium text-background"
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
                  top: `${(capacityYVB / VB_H) * 100}%`,
                  transform: "translate(-50%, -160%)",
                  color: styles.current.colour,
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
                const pctCapacity =
                  projection.capacity > 0
                    ? hovered.tickets / projection.capacity
                    : null;
                return (
                  <>
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-foreground/30"
                      style={{ left: `${pixelX}px` }}
                      aria-hidden
                    />
                    <div
                      className="pointer-events-none absolute z-20 min-w-[190px] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] text-card-foreground shadow-lg"
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
                          label="% of capacity"
                          value={
                            pctCapacity == null
                              ? "—"
                              : `${Math.round(pctCapacity * 100)}%`
                          }
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

function Legend({
  projection,
  styles,
}: {
  projection: FunnelProjection;
  styles: Record<ProjectionLineKey, LineStyle>;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {projection.lines.map((line) => {
        const style = styles[line.key];
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
                strokeWidth={2.5}
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
