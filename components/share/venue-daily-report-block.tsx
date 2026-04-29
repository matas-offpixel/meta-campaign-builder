"use client";

import { useMemo } from "react";

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
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
} from "@/lib/db/client-portal-server";

interface Props {
  eventCode: string;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  mode: "dashboard" | "share";
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
  mode,
}: Props) {
  const {
    event,
    timeline,
    presale,
    additionalSpendRows,
    otherSpendByDate,
    otherSpendBreakdownByDate,
  } = useMemo(
    () => buildVenueReportModel(events, dailyEntries, dailyRollups, additionalSpend),
    [events, dailyEntries, dailyRollups, additionalSpend],
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

  const controlled = useMemo(
    () => ({
      timeline,
      presale,
      syncing: false,
      error: null,
      legErrors: null,
      readOnly: mode === "share",
      isEditable: false,
      defaultCadence: event.report_cadence,
      otherSpendByDate,
      otherSpendBreakdownByDate,
    }),
    [
      timeline,
      presale,
      mode,
      event.report_cadence,
      otherSpendByDate,
      otherSpendBreakdownByDate,
    ],
  );

  const hasMetaScope = dailyRollups.some(
    (row) =>
      row.ad_spend != null ||
      row.ad_spend_allocated != null ||
      row.ad_spend_presale != null ||
      row.tiktok_spend != null,
  );
  const hasEventbriteLink = dailyRollups.some(
    (row) => row.tickets_sold != null || row.revenue != null,
  );

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

      <EventTrendChart timeline={chartTimeline} title="Daily trend" />

      <DailyTracker
        eventId={`venue:${eventCode}`}
        hasMetaScope={hasMetaScope}
        hasEventbriteLink={hasEventbriteLink}
        controlled={controlled}
      />
    </section>
  );
}

function buildVenueReportModel(
  events: PortalEvent[],
  dailyEntries: DailyEntry[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
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
  );
  const generalSaleAt = earliestIso(
    events.map((event) => event.general_sale_at).filter(isString),
  );
  const presale = buildVenuePresaleBucket(timeline, generalSaleAt);
  return {
    event: {
      budget_marketing: maxNullable(events.map((event) => event.budget_marketing)),
      meta_spend_cached: sumNullable(events.map((event) => event.meta_spend_cached)),
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
): TimelineRow[] {
  const byDate = new Map<string, TimelineRow>();
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

  return [...byDate.values()].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
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
