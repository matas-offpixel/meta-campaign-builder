"use client";

/**
 * components/share/venue-history-section.tsx
 *
 * Venue-expansion history surface: a multi-line weekly trends chart on
 * top, a detail table below (hidden until the operator asks for it).
 *
 * Data flows in three channels — all flattened on the parent (
 * `ClientPortalVenueTable`) and filtered to this venue group here:
 *
 *   - `events`              : per-event metadata (id, name, event_code).
 *   - `weeklyTicketSnapshots`: pre-collapsed weekly rows (one per
 *     event, one per week). Drives the chart's default granularity.
 *   - `dailyRollups`        : one row per (event, date) from the
 *     cron-synced `event_daily_rollups` table. Drives the Daily
 *     granularity toggle + powers CPT / ROAS calculations.
 *
 * Why a separate file:
 *   `client-portal-venue-table.tsx` is already ~2.3k lines and mixes the
 *   per-event table + daily tracker + creatives strip. Pulling the
 *   history surface here keeps that file navigable and lets the chart
 *   evolve (more series, side-by-side comparisons, etc.) without
 *   rewriting the venue table every time.
 *
 * No network — every shape is computed from props. The parent already
 * paid the round-trip cost on the initial page load; opening a venue
 * card renders instantly from memo'd derivations below.
 */

import { useMemo, useState } from "react";
import type {
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";

const NUM = new Intl.NumberFormat("en-GB");
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type MetricKey = "tickets" | "cpt" | "roas";

interface MetricDef {
  key: MetricKey;
  label: string;
  format: (n: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "tickets", label: "Tickets Sold", format: (n) => NUM.format(n) },
  { key: "cpt", label: "CPT", format: (n) => GBP2.format(n) },
  { key: "roas", label: "ROAS", format: (n) => `${n.toFixed(2)}×` },
];

/**
 * Deterministic per-event line colour. Sticks to the Tailwind-ish
 * palette used elsewhere on the dashboard so the chart reads as one
 * surface rather than a separate visual system. Cycles past 8 — the
 * longest venue group today is 4 events (Brighton), so cycling is
 * safety rather than a feature.
 */
const EVENT_COLOURS = [
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#0ea5e9", // sky
  "#f43f5e", // rose
  "#eab308", // yellow
  "#06b6d4", // cyan
  "#ec4899", // pink
];
const TOTAL_COLOUR = "#18181b";

function colourFor(index: number): string {
  return EVENT_COLOURS[index % EVENT_COLOURS.length]!;
}

interface Props {
  events: PortalEvent[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  dailyRollups: DailyRollupRow[];
}

/**
 * One row per series point. `value` is the metric's cumulative value
 * as of `date` (cumulative tickets, cumulative CPT = spend/tickets,
 * cumulative ROAS = revenue/spend). Null means "no data yet for this
 * event as of this date".
 */
interface SeriesPoint {
  date: string;
  value: number | null;
  tickets: number | null;
}

interface EventSeries {
  eventId: string;
  name: string;
  colour: string;
  isTotal?: boolean;
  strokeWidth?: number;
  points: SeriesPoint[];
}

export function VenueHistorySection({
  events,
  weeklyTicketSnapshots,
  dailyRollups,
}: Props) {
  const venueEventIds = useMemo(
    () => new Set(events.map((e) => e.id)),
    [events],
  );

  const weekly = useMemo(
    () => weeklyTicketSnapshots.filter((s) => venueEventIds.has(s.event_id)),
    [weeklyTicketSnapshots, venueEventIds],
  );
  const daily = useMemo(
    () => dailyRollups.filter((r) => venueEventIds.has(r.event_id)),
    [dailyRollups, venueEventIds],
  );

  // Granularity — Daily only available when the venue has ≥7 daily
  // rollup rows. Uses a flat ≥7 threshold across the venue rather than
  // per-event; "Daily" becomes usable as soon as cron has run for a
  // week even if one sibling event still has short history.
  const hasDailyCoverage = daily.length >= 7;
  const [granularity, setGranularity] = useState<"weekly" | "daily">("weekly");
  const effectiveGranularity: "weekly" | "daily" = hasDailyCoverage
    ? granularity
    : "weekly";

  const [metric, setMetric] = useState<MetricKey>("tickets");
  const [showTotal, setShowTotal] = useState(true);
  const [showDetail, setShowDetail] = useState(false);

  const series: EventSeries[] = useMemo(() => {
    return events.map((ev, i) => {
      if (effectiveGranularity === "weekly") {
        const rows = weekly
          .filter((r) => r.event_id === ev.id)
          .sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
        const dailyForEvent = daily
          .filter((r) => r.event_id === ev.id)
          .sort((a, b) => a.date.localeCompare(b.date));
        let cumRevenue = 0;
        const points: SeriesPoint[] = rows.map((r) => {
          const tickets = r.tickets_sold;
          // Cumulative spend + revenue up to (and including) this
          // snapshot date, summed from the rollup rows. Lets the
          // chart plot CPT/ROAS against weekly snapshots even though
          // the snapshot rows themselves only carry ticket counts.
          const upTo = dailyForEvent.filter((d) => d.date <= r.snapshot_at);
          const cumSpend = upTo.reduce(
            (acc, d) => acc + (d.ad_spend_allocated ?? d.ad_spend ?? 0),
            0,
          );
          cumRevenue = upTo.reduce(
            (acc, d) => acc + (d.revenue ?? 0),
            0,
          );
          const cpt =
            tickets > 0 && cumSpend > 0 ? cumSpend / tickets : null;
          const roas = cumSpend > 0 ? cumRevenue / cumSpend : null;
          const value =
            metric === "tickets" ? tickets : metric === "cpt" ? cpt : roas;
          return { date: r.snapshot_at, value, tickets };
        });
        return {
          eventId: ev.id,
          name: ev.name,
          colour: colourFor(i),
          points,
        };
      }
      // Daily granularity: cumulative running totals straight off
      // the rollup rows — no second-source reconciliation needed.
      const rows = daily
        .filter((r) => r.event_id === ev.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      let cumTickets = 0;
      let cumSpend = 0;
      let cumRevenue = 0;
      const points: SeriesPoint[] = rows.map((r) => {
        if (r.tickets_sold !== null) cumTickets = r.tickets_sold;
        cumSpend += r.ad_spend_allocated ?? r.ad_spend ?? 0;
        cumRevenue += r.revenue ?? 0;
        const cpt =
          cumTickets > 0 && cumSpend > 0 ? cumSpend / cumTickets : null;
        const roas = cumSpend > 0 ? cumRevenue / cumSpend : null;
        const value =
          metric === "tickets" ? cumTickets : metric === "cpt" ? cpt : roas;
        return {
          date: r.date,
          value,
          tickets: cumTickets || null,
        };
      });
      return {
        eventId: ev.id,
        name: ev.name,
        colour: colourFor(i),
        points,
      };
    });
  }, [events, weekly, daily, effectiveGranularity, metric]);

  // Union of all dates across series so the X axis is shared. Sorted
  // ASC so points map by index cleanly.
  const xDates = useMemo(() => {
    const set = new Set<string>();
    for (const s of series) for (const p of s.points) set.add(p.date);
    return [...set].sort();
  }, [series]);

  const totalSeries: EventSeries | null = useMemo(() => {
    if (xDates.length === 0 || events.length === 0) return null;
    if (effectiveGranularity === "weekly") {
      const dailyByEvent = new Map<string, DailyRollupRow[]>();
      for (const ev of events) {
        dailyByEvent.set(
          ev.id,
          daily
            .filter((r) => r.event_id === ev.id)
            .sort((a, b) => a.date.localeCompare(b.date)),
        );
      }
      const weeklyByEvent = new Map<string, WeeklyTicketSnapshotRow[]>();
      for (const ev of events) {
        weeklyByEvent.set(
          ev.id,
          weekly
            .filter((r) => r.event_id === ev.id)
            .sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at)),
        );
      }
      const points = xDates.map((date): SeriesPoint => {
        let totalTickets = 0;
        let hasTickets = false;
        let totalSpend = 0;
        let totalRevenue = 0;
        for (const ev of events) {
          const latestTickets = latestTicketsAtOrBefore(
            weeklyByEvent.get(ev.id) ?? [],
            date,
          );
          if (latestTickets !== null) {
            totalTickets += latestTickets;
            hasTickets = true;
          }
          const dailyUpTo = (dailyByEvent.get(ev.id) ?? []).filter(
            (r) => r.date <= date,
          );
          totalSpend += dailyUpTo.reduce(
            (acc, r) => acc + (r.ad_spend_allocated ?? r.ad_spend ?? 0),
            0,
          );
          totalRevenue += dailyUpTo.reduce((acc, r) => acc + (r.revenue ?? 0), 0);
        }
        const tickets = hasTickets ? totalTickets : null;
        const cpt =
          tickets !== null && tickets > 0 && totalSpend > 0
            ? totalSpend / tickets
            : null;
        const roas = totalSpend > 0 ? totalRevenue / totalSpend : null;
        const value =
          metric === "tickets" ? tickets : metric === "cpt" ? cpt : roas;
        return { date, value, tickets };
      });
      return {
        eventId: "__total__",
        name: "TOTAL",
        colour: TOTAL_COLOUR,
        isTotal: true,
        strokeWidth: 2.5,
        points,
      };
    }

    const rowsByDate = new Map<
      string,
      { tickets: number; hasTickets: boolean; spend: number; revenue: number }
    >();
    for (const date of xDates) {
      rowsByDate.set(date, {
        tickets: 0,
        hasTickets: false,
        spend: 0,
        revenue: 0,
      });
    }
    const rowsByEvent = new Map<string, DailyRollupRow[]>();
    for (const ev of events) {
      rowsByEvent.set(
        ev.id,
        daily
          .filter((r) => r.event_id === ev.id)
          .sort((a, b) => a.date.localeCompare(b.date)),
      );
    }
    for (const ev of events) {
      let cumTickets = 0;
      let hasTickets = false;
      let cumSpend = 0;
      let cumRevenue = 0;
      const rows = rowsByEvent.get(ev.id) ?? [];
      let cursor = 0;
      for (const date of xDates) {
        while (cursor < rows.length && rows[cursor]!.date <= date) {
          const row = rows[cursor]!;
          if (row.tickets_sold !== null) {
            cumTickets = row.tickets_sold;
            hasTickets = true;
          }
          cumSpend += row.ad_spend_allocated ?? row.ad_spend ?? 0;
          cumRevenue += row.revenue ?? 0;
          cursor++;
        }
        const acc = rowsByDate.get(date)!;
        if (hasTickets) {
          acc.tickets += cumTickets;
          acc.hasTickets = true;
        }
        acc.spend += cumSpend;
        acc.revenue += cumRevenue;
      }
    }
    const points = xDates.map((date): SeriesPoint => {
      const acc = rowsByDate.get(date)!;
      const tickets = acc.hasTickets ? acc.tickets : null;
      const cpt =
        tickets !== null && tickets > 0 && acc.spend > 0
          ? acc.spend / tickets
          : null;
      const roas = acc.spend > 0 ? acc.revenue / acc.spend : null;
      const value =
        metric === "tickets" ? tickets : metric === "cpt" ? cpt : roas;
      return { date, value, tickets };
    });
    return {
      eventId: "__total__",
      name: "TOTAL",
      colour: TOTAL_COLOUR,
      isTotal: true,
      strokeWidth: 2.5,
      points,
    };
  }, [xDates, events, effectiveGranularity, weekly, daily, metric]);

  const displaySeries = useMemo(
    () => (showTotal && totalSeries ? [totalSeries, ...series] : series),
    [series, showTotal, totalSeries],
  );

  if (xDates.length === 0) {
    return null; // no history yet → hide the section rather than render a blank chart
  }

  return (
    <div className="border-t border-border px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Weekly trends
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                aria-pressed={metric === m.key}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  metric === m.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border-strong bg-card text-muted-foreground hover:border-foreground/60"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-l border-border pl-3">
            <button
              type="button"
              onClick={() => setGranularity("weekly")}
              aria-pressed={effectiveGranularity === "weekly"}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                effectiveGranularity === "weekly"
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-strong bg-card text-muted-foreground hover:border-foreground/60"
              }`}
            >
              Weekly
            </button>
            <button
              type="button"
              onClick={() => setGranularity("daily")}
              disabled={!hasDailyCoverage}
              aria-pressed={effectiveGranularity === "daily"}
              title={
                hasDailyCoverage
                  ? undefined
                  : "Daily view unlocks after 7+ days of cron-synced data"
              }
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                !hasDailyCoverage
                  ? "cursor-not-allowed border-border bg-muted text-muted-foreground/60"
                  : effectiveGranularity === "daily"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border-strong bg-card text-muted-foreground hover:border-foreground/60"
              }`}
            >
              Daily
            </button>
          </div>
        </div>
      </div>

      <Chart series={displaySeries} xDates={xDates} metric={metric} />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="text-[11px] font-medium text-foreground underline underline-offset-2 hover:text-foreground/80"
          aria-expanded={showDetail}
        >
          {showDetail ? "Hide detailed history" : "Show detailed history"}
        </button>
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          {totalSeries && (
            <button
              type="button"
              onClick={() => setShowTotal((v) => !v)}
              aria-pressed={showTotal}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium transition-colors ${
                showTotal
                  ? "border-foreground bg-foreground text-background"
                  : "border-border-strong bg-card text-muted-foreground hover:border-foreground/60"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: showTotal ? "#ffffff" : TOTAL_COLOUR }}
                aria-hidden="true"
              />
              Total
            </button>
          )}
          {series.map((s) => (
            <span key={s.eventId} className="inline-flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.colour }}
                aria-hidden="true"
              />
              {s.name}
            </span>
          ))}
        </div>
      </div>

      {showDetail && <DetailTable series={displaySeries} xDates={xDates} />}
    </div>
  );
}

interface ChartProps {
  series: EventSeries[];
  xDates: string[];
  metric: MetricKey;
}

function Chart({ series, xDates, metric }: ChartProps) {
  // Same geometry language as CptTrendChart in the sibling file —
  // SVG stretches horizontally, labels live in HTML below so the
  // stretched viewport doesn't squish the text.
  const VB_W = 600;
  const VB_H = 180;
  const PAD_T = 8;
  const PAD_R = 8;
  const PAD_B = 8;
  const PAD_L = 8;
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;

  // Flatten non-null values to find the global y-max.
  const values: number[] = [];
  for (const s of series) {
    for (const p of s.points) {
      if (p.value !== null && Number.isFinite(p.value)) values.push(p.value);
    }
  }
  const yMax = values.length > 0 ? Math.max(...values) * 1.1 : 1;

  const xAt = (i: number): number =>
    xDates.length <= 1
      ? PAD_L + plotW / 2
      : PAD_L + (i / (xDates.length - 1)) * plotW;
  const yAt = (v: number): number => PAD_T + plotH - (v / yMax) * plotH;

  // Date label cadence — cap at 6.
  const labelEvery = Math.max(1, Math.ceil(xDates.length / 6));
  const labelDates = xDates.filter(
    (_, i) => i === 0 || i === xDates.length - 1 || i % labelEvery === 0,
  );

  const formatter = METRICS.find((m) => m.key === metric)!.format;

  const Y_TICK_COUNT = 4;
  const yTicks = Array.from({ length: Y_TICK_COUNT }, (_, i) => {
    const fraction = (Y_TICK_COUNT - 1 - i) / (Y_TICK_COUNT - 1);
    const value = yMax > 0 ? (yMax / 1.1) * fraction : 0;
    return { value, yPx: yAt(value) };
  });

  return (
    <div className="flex">
      <div className="relative h-[180px] w-14 flex-shrink-0" aria-hidden="true">
        {yTicks.map((t) => (
          <span
            key={t.value}
            className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
            style={{ top: `${t.yPx}px` }}
          >
            {formatter(t.value)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          width="100%"
          height={180}
          role="img"
          aria-label={`Weekly ${metric} trend per event`}
          className="overflow-visible"
        >
          <line
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={PAD_T + plotH}
            y2={PAD_T + plotH}
            stroke="#e4e4e7"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) => {
            // Build segments that break on nulls — otherwise the polyline
            // draws straight through a missing week and lies about the
            // trend.
            type Pt = { x: number; y: number };
            const segments: Pt[][] = [];
            let cur: Pt[] = [];
            for (const p of s.points) {
              const xi = xDates.indexOf(p.date);
              if (p.value === null || !Number.isFinite(p.value) || xi < 0) {
                if (cur.length > 0) segments.push(cur);
                cur = [];
                continue;
              }
              cur.push({ x: xAt(xi), y: yAt(p.value) });
            }
            if (cur.length > 0) segments.push(cur);
            return (
              <g key={s.eventId}>
                {segments.map((seg, i) => (
                  <polyline
                    key={`line-${i}`}
                    points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke={s.colour}
                    strokeWidth={s.strokeWidth ?? 1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {segments.flat().map((p, i) => (
                  <circle
                    key={`pt-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={s.isTotal ? 3 : 2.5}
                    fill={s.colour}
                    stroke="#ffffff"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          {labelDates.map((d) => (
            <span key={d}>{shortDate(d)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DetailTableProps {
  series: EventSeries[];
  xDates: string[];
}

function DetailTable({ series, xDates }: DetailTableProps) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[700px] border-collapse text-xs">
        <thead>
          <tr className="bg-muted text-left uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-1.5">Event</th>
            {xDates.map((d) => (
              <th key={d} className="px-2 py-1.5 text-right">
                {shortDate(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {series.map((s) => {
            // Resolve tickets per X date so the cell rendering below can
            // also compute a WoW delta vs the previous populated cell.
            const ticketsByDate = new Map<string, number | null>();
            for (const p of s.points) ticketsByDate.set(p.date, p.tickets);
            let prevTickets: number | null = null;
            return (
              <tr
                key={s.eventId}
                className={`border-t border-border hover:bg-muted/50 ${
                  s.isTotal ? "bg-muted/30 font-semibold" : ""
                }`}
              >
                <td className="px-2 py-1.5 align-top">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.colour }}
                      aria-hidden="true"
                    />
                    <span className="font-medium text-foreground">
                      {s.name}
                    </span>
                  </span>
                </td>
                {xDates.map((d) => {
                  const tickets = ticketsByDate.get(d);
                  const hasValue =
                    tickets !== null &&
                    tickets !== undefined &&
                    Number.isFinite(tickets);
                  let delta: number | null = null;
                  if (hasValue && prevTickets !== null) {
                    delta = tickets - prevTickets;
                  }
                  if (hasValue) prevTickets = tickets;
                  const deltaClass =
                    delta === null
                      ? ""
                      : delta > 0
                        ? "text-emerald-600"
                        : delta < 0
                          ? "text-red-600"
                          : "text-muted-foreground";
                  return (
                    <td
                      key={d}
                      className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"
                    >
                      {hasValue ? (
                        <>
                          <span className="text-foreground">
                            {NUM.format(tickets)}
                          </span>
                          {delta !== null && (
                            <span
                              className={`ml-1 text-[10px] ${deltaClass}`}
                            >
                              ({delta >= 0 ? "+" : ""}
                              {NUM.format(delta)})
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function latestTicketsAtOrBefore(
  rows: readonly WeeklyTicketSnapshotRow[],
  date: string,
): number | null {
  let out: number | null = null;
  for (const row of rows) {
    if (row.snapshot_at > date) break;
    out = row.tickets_sold;
  }
  return out;
}

/**
 * Week-ending date formatter shared across header labels + detail
 * table columns. `YYYY-MM-DD` → `DD MMM`. Timezone-agnostic — the
 * underlying snapshots are already normalised to UTC day strings.
 */
function shortDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const [, , mo, da] = m;
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(da)} ${month}`;
}
