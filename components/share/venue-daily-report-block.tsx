"use client";

import { useMemo, useState } from "react";

import {
  EventSummaryHeader,
  type PerformanceSummaryTimeframe,
} from "@/components/dashboard/events/event-summary-header";
import { DailyTracker } from "@/components/dashboard/events/daily-tracker";
import { EventTrendChart } from "@/components/dashboard/events/event-trend-chart";
import {
  additionalSpendBreakdownLinesByDate,
  additionalSpendTotalsByDate,
} from "@/lib/db/additional-spend-sum";
import { trimTimelineForTrackerDisplay } from "@/lib/dashboard/trim-timeline-for-tracker-display";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";

interface Props {
  eventCode: string;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots?: WeeklyTicketSnapshotRow[];
  mode: "dashboard" | "share";
  datePreset?: DatePreset;
  customRange?: CustomDateRange;
}

interface VenueEventLike {
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  general_sale_at: string | null;
  capacity: number | null;
  event_date: string | null;
  report_cadence: "daily" | "weekly";
}

interface VenuePresaleBucket {
  cutoffDate: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tiktok_spend: number | null;
  tiktok_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  daysCount: number;
  earliestDate: string | null;
}

const DEFAULT_PERF_SUMMARY: PerformanceSummaryTimeframe = {
  datePreset: "maximum",
  metaSpend: null,
  ticketsInWindow: null,
};

export function VenueDailyReportBlock({
  eventCode,
  events,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots = [],
  mode,
  datePreset = "maximum",
  customRange,
}: Props) {
  const storageKey = `venue_tracker_expanded_${eventCode}`;
  const [trackerExpanded, setTrackerExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const setTrackerPreference = (expanded: boolean) => {
    setTrackerExpanded(expanded);
    try {
      localStorage.setItem(storageKey, expanded ? "1" : "0");
    } catch {
      // Ignore storage failures; the in-memory state still updates.
    }
  };
  const {
    event,
    timeline,
    presale,
    additionalSpendRows,
    otherSpendByDate,
    otherSpendBreakdownByDate,
  } = useMemo(
    () =>
      buildVenueReportModel(
        events,
        dailyEntries,
        dailyRollups,
        additionalSpend,
        weeklyTicketSnapshots,
      ),
    [events, dailyEntries, dailyRollups, additionalSpend, weeklyTicketSnapshots],
  );
  const chartTimeline = useMemo(
    () =>
      trimTimelineForTrackerDisplay(timeline, {
        // Do not cut at general sale for the chart: presale activity is
        // a valid first data point and should anchor the visible range.
        generalSaleCutoff: null,
        otherSpendByDate,
      }),
    [timeline, otherSpendByDate],
  );
  const windowDays = useMemo(
    () => resolvePresetToDays(datePreset, customRange),
    [datePreset, customRange],
  );
  const windowDaySet = useMemo(
    () => (windowDays === null ? null : new Set(windowDays)),
    [windowDays],
  );
  const windowedTimeline = useMemo(
    () =>
      windowDaySet === null
        ? timeline
        : timeline.filter((row) => windowDaySet.has(row.date)),
    [timeline, windowDaySet],
  );
  const windowedChartTimeline = useMemo(
    () =>
      windowDaySet === null
        ? chartTimeline
        : chartTimeline.filter((row) => windowDaySet.has(row.date)),
    [chartTimeline, windowDaySet],
  );
  const windowedOtherSpendByDate = useMemo(
    () =>
      windowDaySet === null
        ? otherSpendByDate
        : filterMapByDate(otherSpendByDate, windowDaySet),
    [otherSpendByDate, windowDaySet],
  );
  const windowedOtherSpendBreakdownByDate = useMemo(
    () =>
      windowDaySet === null
        ? otherSpendBreakdownByDate
        : filterMapByDate(otherSpendBreakdownByDate, windowDaySet),
    [otherSpendBreakdownByDate, windowDaySet],
  );

  const controlled = useMemo(
    () => ({
      timeline: windowedTimeline,
      presale,
      syncing: false,
      error: null,
      legErrors: null,
      readOnly: mode === "share",
      isEditable: false,
      defaultCadence: event.report_cadence,
      otherSpendByDate: windowedOtherSpendByDate,
      otherSpendBreakdownByDate: windowedOtherSpendBreakdownByDate,
      suppressSyntheticToday: windowDaySet !== null,
    }),
    [
      windowedTimeline,
      presale,
      mode,
      event.report_cadence,
      windowedOtherSpendByDate,
      windowedOtherSpendBreakdownByDate,
      windowDaySet,
    ],
  );

  const hasMetaScope = dailyRollups.some(
    (row) =>
      row.ad_spend != null ||
      row.ad_spend_allocated != null ||
      row.ad_spend_presale != null ||
      row.tiktok_spend != null,
  );
  const hasEventbriteLink =
    dailyRollups.some((row) => row.tickets_sold != null || row.revenue != null) ||
    weeklyTicketSnapshots.length > 0 ||
    events.some((event) => event.history.length > 0);

  if (!hasMetaScope && !hasEventbriteLink && additionalSpendRows.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-lg tracking-wide">Event reporting</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Aggregated across {events.length} event
          {events.length === 1 ? "" : "s"} under{" "}
          <span className="font-mono text-foreground">{eventCode}</span>.
        </p>
      </div>

      <EventSummaryHeader
        event={event}
        timeline={timeline}
        timeframe={DEFAULT_PERF_SUMMARY}
        additionalSpendEntries={additionalSpendRows}
      />

      <EventTrendChart timeline={windowedChartTimeline} title="Daily trend" />

      <div className="space-y-2">
        <DailyTracker
          eventId={`venue:${eventCode}`}
          hasMetaScope={hasMetaScope}
          hasEventbriteLink={hasEventbriteLink}
          controlled={controlled}
          visibleRowLimit={trackerExpanded ? undefined : 7}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setTrackerPreference(!trackerExpanded)}
            className="rounded border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            {trackerExpanded
              ? "Hide full tracker ▲"
              : "Show full tracker (60 days) ▼"}
          </button>
        </div>
      </div>
    </section>
  );
}

function filterMapByDate<T>(
  map: ReadonlyMap<string, T>,
  allowedDays: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  for (const [date, value] of map) {
    if (allowedDays.has(date)) out.set(date, value);
  }
  return out;
}

function buildVenueReportModel(
  events: PortalEvent[],
  dailyEntries: DailyEntry[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): {
  event: VenueEventLike;
  timeline: TimelineRow[];
  presale: VenuePresaleBucket | null;
  additionalSpendRows: Array<{ date: string; amount: number; category: string }>;
  otherSpendByDate: ReadonlyMap<string, number>;
  otherSpendBreakdownByDate: ReadonlyMap<
    string,
    Array<{ category: string; amount: number }>
  >;
} {
  const eventIds = new Set(events.map((event) => event.id));
  const isMultiEventVenue = eventIds.size > 1;
  const additionalSpendRows = additionalSpend
    .filter((row) =>
      row.scope === "venue"
        ? row.venue_event_code === events[0]?.event_code
        : eventIds.has(row.event_id),
    )
    .map((row) => ({
      date: row.date,
      amount: row.amount,
      category: row.category,
    }));
  const otherSpendByDate = additionalSpendTotalsByDate(additionalSpendRows);
  const otherSpendBreakdownByDate =
    additionalSpendBreakdownLinesByDate(additionalSpendRows);

  const timeline = mergeVenueTimeline(
    dailyRollups,
    dailyEntries,
    isMultiEventVenue,
    weeklyTicketSnapshots,
    events,
  );
  const generalSaleAt = earliestIso(
    events.map((event) => event.general_sale_at).filter(isString),
  );
  const presale = buildVenuePresaleBucket(timeline, generalSaleAt);
  return {
    event: {
      budget_marketing: maxNullable(events.map((event) => event.budget_marketing)),
      // Raw cached campaign spend is duplicated across multi-event
      // venues. Leave null so EventSummaryHeader uses the allocator-
      // aware merged timeline instead.
      meta_spend_cached: isMultiEventVenue
        ? null
        : sumNullable(events.map((event) => event.meta_spend_cached)),
      prereg_spend: sumNullable(events.map((event) => event.prereg_spend)),
      general_sale_at: generalSaleAt,
      capacity: sumNullable(events.map((event) => event.capacity)),
      event_date: earliestUpcomingOrKnownEventDate(events),
      report_cadence: events.some((event) => event.report_cadence === "weekly")
        ? "weekly"
        : "daily",
    },
    timeline,
    presale,
    additionalSpendRows,
    otherSpendByDate,
    otherSpendBreakdownByDate,
  };
}

function mergeVenueTimeline(
  rollups: DailyRollupRow[],
  manualEntries: DailyEntry[],
  isMultiEventVenue: boolean,
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  events: PortalEvent[],
): TimelineRow[] {
  const byDate = new Map<string, TimelineRow>();
  const rollupTicketTotal = rollups.reduce(
    (sum, row) => sum + (row.tickets_sold ?? 0),
    0,
  );
  const rollupRevenueTotal = rollups.reduce(
    (sum, row) => sum + (row.revenue ?? 0),
    0,
  );
  for (const row of rollups) {
    const current = byDate.get(row.date) ?? emptyTimelineRow(row.date, "live");
    const hasAllocatedSpend =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const spend = hasAllocatedSpend
      ? (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0)
      : isMultiEventVenue
        ? null
        : row.ad_spend;

    current.ad_spend = addNullable(current.ad_spend, spend);
    current.tiktok_spend = addNullable(current.tiktok_spend, row.tiktok_spend);
    current.link_clicks = addNullable(current.link_clicks, row.link_clicks);
    current.tiktok_clicks = addNullable(current.tiktok_clicks, row.tiktok_clicks);
    current.meta_regs = addNullable(current.meta_regs, row.meta_regs);
    current.tickets_sold = addNullable(current.tickets_sold, row.tickets_sold);
    current.revenue = addNullable(current.revenue, row.revenue);
    byDate.set(row.date, current);
  }

  for (const row of manualEntries) {
    const current = byDate.get(row.date) ?? emptyTimelineRow(row.date, "manual");
    current.source = "manual";
    current.ad_spend = addNullable(current.ad_spend, row.day_spend);
    current.link_clicks = addNullable(current.link_clicks, row.link_clicks);
    current.tickets_sold = addNullable(current.tickets_sold, row.tickets);
    current.revenue = addNullable(current.revenue, row.revenue);
    current.notes = joinNotes(current.notes, row.notes);
    byDate.set(row.date, current);
  }

  if (rollupTicketTotal === 0) {
    for (const [date, tickets] of venueSnapshotTicketDeltas(
      weeklyTicketSnapshots,
    )) {
      const current = byDate.get(date) ?? emptyTimelineRow(date, "live");
      current.tickets_sold = addNullable(current.tickets_sold, tickets);
      byDate.set(date, current);
    }
  }

  if (rollupRevenueTotal === 0) {
    for (const [date, revenue] of venueSnapshotRevenueDeltas(events)) {
      const current = byDate.get(date) ?? emptyTimelineRow(date, "live");
      current.revenue = addNullable(current.revenue, revenue);
      byDate.set(date, current);
    }
  }

  return [...byDate.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

function venueSnapshotTicketDeltas(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): Map<string, number> {
  const byEvent = new Map<string, WeeklyTicketSnapshotRow[]>();
  for (const row of weeklyTicketSnapshots) {
    const rows = byEvent.get(row.event_id) ?? [];
    rows.push(row);
    byEvent.set(row.event_id, rows);
  }
  const deltas = new Map<string, number>();
  for (const rows of byEvent.values()) {
    rows.sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
    let prev = 0;
    for (const row of rows) {
      const delta = Math.max(0, row.tickets_sold - prev);
      prev = row.tickets_sold;
      if (delta > 0) {
        deltas.set(row.snapshot_at, (deltas.get(row.snapshot_at) ?? 0) + delta);
      }
    }
  }
  return deltas;
}

function venueSnapshotRevenueDeltas(events: PortalEvent[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const event of events) {
    const history = [...(event.history ?? [])].sort((a, b) =>
      snapshotDate(a).localeCompare(snapshotDate(b)),
    );
    let prev = 0;
    for (const snapshot of history) {
      if (snapshot.revenue == null) continue;
      const delta = Math.max(0, snapshot.revenue - prev);
      prev = snapshot.revenue;
      if (delta > 0) {
        const date = snapshotDate(snapshot);
        deltas.set(
          date,
          (deltas.get(date) ?? 0) + delta,
        );
      }
    }
  }
  return deltas;
}

function snapshotDate(snapshot: PortalEvent["history"][number]): string {
  return snapshot.week_start || snapshot.captured_at.slice(0, 10);
}

function emptyTimelineRow(date: string, source: TimelineRow["source"]): TimelineRow {
  return {
    date,
    source,
    ad_spend: null,
    link_clicks: null,
    meta_regs: null,
    tiktok_spend: null,
    tiktok_impressions: null,
    tiktok_clicks: null,
    tiktok_video_views: null,
    tiktok_results: null,
    tickets_sold: null,
    revenue: null,
    notes: null,
    freshness_at: null,
  };
}

function buildVenuePresaleBucket(
  timeline: TimelineRow[],
  cutoffDate: string | null,
): VenuePresaleBucket | null {
  if (!cutoffDate) return null;
  const rows = timeline.filter((row) => row.date < cutoffDate);
  if (rows.length === 0) return null;
  return {
    cutoffDate,
    ad_spend: sumNullable(rows.map((row) => row.ad_spend)),
    link_clicks: sumNullable(rows.map((row) => row.link_clicks)),
    tiktok_spend: sumNullable(rows.map((row) => row.tiktok_spend)),
    tiktok_clicks: sumNullable(rows.map((row) => row.tiktok_clicks)),
    tickets_sold: sumNullable(rows.map((row) => row.tickets_sold)),
    revenue: sumNullable(rows.map((row) => row.revenue)),
    daysCount: rows.length,
    earliestDate: earliestIso(rows.map((row) => row.date)),
  };
}

function addNullable(
  current: number | null,
  value: number | null | undefined,
): number | null {
  if (value == null) return current;
  return (current ?? 0) + Number(value);
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  let sum = 0;
  let any = false;
  for (const value of values) {
    if (value == null) continue;
    sum += Number(value);
    any = true;
  }
  return any ? sum : null;
}

function maxNullable(values: Array<number | null | undefined>): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (value == null) continue;
    max = max == null ? Number(value) : Math.max(max, Number(value));
  }
  return max;
}

function earliestUpcomingOrKnownEventDate(events: PortalEvent[]): string | null {
  const dates = events.map((event) => event.event_date).filter(isString).sort();
  return dates[0] ?? null;
}

function earliestIso(values: string[]): string | null {
  return [...values].sort()[0] ?? null;
}

function isString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

function joinNotes(current: string | null, next: string | null): string | null {
  if (!next) return current;
  if (!current) return next;
  return `${current}; ${next}`;
}
