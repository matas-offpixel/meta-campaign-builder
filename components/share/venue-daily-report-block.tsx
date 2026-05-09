"use client";

import { useMemo, useState } from "react";

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
import type { PlatformId } from "@/lib/dashboard/platform-colors";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
} from "@/lib/dashboard/tier-channel-rollups";
import {
  buildVenueCumulativeTicketTimeline,
  buildVenueDailyHistoryTimelines,
  buildVenueTicketSnapshotPoints,
  ticketDeltasFromCumulativeTimeline,
  type TierChannelDailyHistoryRow,
  type TierChannelSalesAnchorRow,
} from "@/lib/dashboard/venue-trend-points";
import type { TrendChartPoint } from "@/lib/dashboard/trend-chart-data";

/**
 * components/share/venue-daily-report-block.tsx
 *
 * The venue report's "live data" subcomponents — the multi-metric
 * trend chart and the editable daily tracker. Both share the same
 * `useVenueReportModel` hook so the timeline is built once per render
 * and split between the two sections by the parent.
 *
 * History: pre-restructure this file rendered a single
 * `VenueDailyReportBlock` that bundled the (now-removed) Performance
 * Summary header, trend chart, and tracker into one section. The
 * Performance Summary moved into the parent's three-card row (always
 * lifetime), and the trend + tracker became standalone exports so the
 * new layout can interleave them with the topline stats grid + event
 * breakdown.
 */

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

interface VenueEventLike {
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  general_sale_at: string | null;
  capacity: number | null;
  event_date: string | null;
  report_cadence: "daily" | "weekly";
}

export interface VenueReportModel {
  event: VenueEventLike;
  timeline: TimelineRow[];
  presale: VenuePresaleBucket | null;
  additionalSpendRows: Array<{ date: string; amount: number; category: string }>;
  otherSpendByDate: ReadonlyMap<string, number>;
  otherSpendBreakdownByDate: ReadonlyMap<
    string,
    Array<{ category: string; amount: number }>
  >;
  /**
   * Cumulative-snapshot ticket points for the trend chart line.
   * Built from the per-event monotonic envelope across all snapshot
   * sources, anchored at "today" to the per-event
   * `tier_channel_sales` SUM. Pre-tagged with
   * `ticketsKind: "cumulative_snapshot"` so the aggregator's carry-
   * forward path activates and a date without a fresh snapshot still
   * shows the prior cumulative (no Apr 28 → 29 phantom drop).
   */
  cumulativeTicketPoints: TrendChartPoint[];
}

/**
 * Build the venue report model from the slim portal payload. Memoised
 * by the caller (the hook below) — pure function so it can also be
 * called directly from tests.
 */
export function buildVenueReportModel(
  events: PortalEvent[],
  dailyEntries: DailyEntry[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  /**
   * Source-stitched snapshots for trend/tracker continuity. Falls back
   * to `weeklyTicketSnapshots` when absent (legacy callers / tests that
   * haven't been updated yet). See `collapseTrendPerEventStitched`.
   */
  trendTicketSnapshots?: WeeklyTicketSnapshotRow[],
  options?: {
    todayIso?: string;
    /**
     * Per-day rows from `tier_channel_sales_daily_history` (migration
     * 089). When present these take priority over the
     * `ticket_sales_snapshots` envelope — daily history rows are exact
     * cron snapshots or proportional estimates (source_kind =
     * 'smoothed_historical') that eliminate the "all tickets land on
     * today" spike visible before the cron started running.
     */
    dailyHistory?: TierChannelDailyHistoryRow[];
  },
): VenueReportModel {
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

  // Per-event tier_channel_sales anchors — exposed on PortalEvent by
  // the loader (sum across tiers/channels for each event). Events
  // without a tier_channel_sales row contribute null and the envelope
  // falls back to snapshot-only behaviour.
  const tierChannelAnchors: TierChannelSalesAnchorRow[] = events
    .filter(
      (event) =>
        event.tier_channel_sales_tickets != null ||
        event.tier_channel_sales_revenue != null,
    )
    .map((event) => ({
      event_id: event.id,
      tickets: event.tier_channel_sales_tickets ?? null,
      revenue: event.tier_channel_sales_revenue ?? null,
    }));

  const snapshotsForTrend = trendTicketSnapshots ?? weeklyTicketSnapshots;

  const cumulativeTicketPoints = buildVenueTicketSnapshotPoints(
    snapshotsForTrend,
    eventIds,
    {
      tierChannelAnchors,
      todayIso: options?.todayIso,
      dailyHistory: options?.dailyHistory,
    },
  );

  const cumulativeTicketTimeline = buildVenueCumulativeTicketTimeline(
    snapshotsForTrend,
    eventIds,
    {
      tierChannelAnchors,
      todayIso: options?.todayIso,
      dailyHistory: options?.dailyHistory,
    },
  );

  // Compute venue-wide cumulative timelines directly from daily_history
  // so mergeVenueTimeline can derive precise per-day ticket AND revenue
  // deltas without going through the snapshot-envelope path.
  const dailyHistoryTimelines = buildVenueDailyHistoryTimelines(
    options?.dailyHistory ?? [],
    eventIds,
  );

  const timeline = mergeVenueTimeline(
    dailyRollups,
    dailyEntries,
    isMultiEventVenue,
    cumulativeTicketTimeline,
    events,
    dailyHistoryTimelines,
  );
  const generalSaleAt = earliestIso(
    events.map((event) => event.general_sale_at).filter(isString),
  );
  const presale = buildVenuePresaleBucket(timeline, generalSaleAt);
  return {
    event: {
      budget_marketing: maxNullable(events.map((event) => event.budget_marketing)),
      // Raw cached campaign spend is duplicated across multi-event
      // venues. Leave null so downstream uses the allocator-aware
      // merged timeline instead.
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
    cumulativeTicketPoints,
  };
}

/**
 * Memoising hook — call once per parent render and pass the resolved
 * model to both `<VenueTrendChartSection>` and
 * `<VenueDailyTrackerSection>`. Saves the merge + presale bucket
 * computation from running twice.
 *
 * Tier-derived ticket totals are also exposed here so the parent's
 * Performance Summary cards can use the same source of truth as the
 * tracker.
 */
export function useVenueReportModel(
  events: PortalEvent[],
  dailyEntries: DailyEntry[],
  dailyRollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  trendTicketSnapshots?: WeeklyTicketSnapshotRow[],
  dailyHistory?: TierChannelDailyHistoryRow[],
): VenueReportModel & {
  tierLifetimeTickets: number | null;
  tierLifetimeRevenue: number | null;
} {
  const model = useMemo(
    () =>
      buildVenueReportModel(
        events,
        dailyEntries,
        dailyRollups,
        additionalSpend,
        weeklyTicketSnapshots,
        trendTicketSnapshots,
        { dailyHistory },
      ),
    [
      events,
      dailyEntries,
      dailyRollups,
      additionalSpend,
      weeklyTicketSnapshots,
      trendTicketSnapshots,
      dailyHistory,
    ],
  );

  const tierLifetimeTickets = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const ev of events) {
      if (ev.ticket_tiers.length === 0) continue;
      sum += resolveDisplayTicketCount({
        ticket_tiers: ev.ticket_tiers,
        latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
        fallback_tickets: ev.tickets_sold ?? null,
        tier_channel_sales_sum: ev.tier_channel_sales_tickets ?? null,
      });
      any = true;
    }
    return any ? sum : null;
  }, [events]);

  const tierLifetimeRevenue = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const ev of events) {
      if (ev.ticket_tiers.length === 0) continue;
      const r = resolveDisplayTicketRevenue({
        ticket_tiers: ev.ticket_tiers,
        latest_snapshot_revenue: ev.latest_snapshot?.revenue ?? null,
        tier_channel_sales_revenue: ev.tier_channel_sales_revenue ?? null,
      });
      if (r != null) {
        sum += r;
        any = true;
      }
    }
    return any ? sum : null;
  }, [events]);

  return { ...model, tierLifetimeTickets, tierLifetimeRevenue };
}

/**
 * Stand-alone trend chart section. Filters the model timeline to the
 * given date window and (optionally) to a single platform, then hands
 * off to the existing multi-metric chart.
 *
 * Tickets line uses the venue's pre-built cumulative-snapshot points
 * (see `cumulativeTicketPoints`), so the line is monotonically non-
 * decreasing and the tooltip CPT is lifetime / lifetime — matching the
 * top-line CPT pill at every hover position.
 */
export function VenueTrendChartSection({
  model,
  datePreset,
  customRange,
  platform,
  title = "Daily trend",
}: {
  model: VenueReportModel;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  platform: PlatformId;
  title?: string;
}) {
  const { timeline, otherSpendByDate, cumulativeTicketPoints } = model;
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
  const windowedChartTimeline = useMemo(
    () =>
      windowDaySet === null
        ? chartTimeline
        : chartTimeline.filter((row) => windowDaySet.has(row.date)),
    [chartTimeline, windowDaySet],
  );
  const platformTimeline = useMemo(
    () => projectTimelineToPlatform(windowedChartTimeline, platform),
    [windowedChartTimeline, platform],
  );

  // Build mixed-mode points: per-day spend (and revenue/clicks) from
  // the trimmed timeline + cumulative-snapshot tickets from the model.
  // The aggregator detects `ticketsKind: "cumulative_snapshot"`, runs
  // its carry-forward pass on tickets, and computes lifetime/lifetime
  // CPT from the running spend total — fixing the Manchester WC26
  // tooltip bug where "Spend £92.86 / Tickets 843 = CPT £0.11" mixed
  // daily and lifetime denominators.
  const points = useMemo<TrendChartPoint[]>(() => {
    const dayPoints = platformTimeline.map<TrendChartPoint>((row) => ({
      date: row.date,
      spend:
        row.ad_spend != null || row.tiktok_spend != null
          ? Number(row.ad_spend ?? 0) + Number(row.tiktok_spend ?? 0)
          : null,
      // Tickets/revenue come from the cumulative-snapshot points below;
      // null here so the aggregator's carry-forward path owns the line.
      tickets: null,
      revenue: row.revenue != null ? Number(row.revenue) : null,
      linkClicks:
        row.link_clicks != null || row.tiktok_clicks != null
          ? Number(row.link_clicks ?? 0) + Number(row.tiktok_clicks ?? 0)
          : null,
    }));
    const cumulativePoints =
      windowDaySet === null
        ? cumulativeTicketPoints
        : cumulativeTicketPoints.filter((point) =>
            windowDaySet.has(point.date),
          );
    return [...dayPoints, ...cumulativePoints];
  }, [platformTimeline, cumulativeTicketPoints, windowDaySet]);

  return <EventTrendChart points={points} title={title} />;
}

/**
 * Stand-alone daily-tracker section. Defaults to the last 14 days
 * collapsed; the "Show full tracker (60 days)" button expands. The
 * preference persists per `event_code` in localStorage so navigating
 * between venues remembers each card's state independently.
 */
export function VenueDailyTrackerSection({
  eventCode,
  model,
  mode,
  datePreset,
  customRange,
}: {
  eventCode: string;
  model: VenueReportModel;
  mode: "dashboard" | "share";
  datePreset: DatePreset;
  customRange?: CustomDateRange;
}) {
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
    otherSpendByDate,
    otherSpendBreakdownByDate,
  } = model;
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
      reportEmbed: true,
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

  const hasMetaScope = timeline.some(
    (row) => row.ad_spend != null || row.tiktok_spend != null,
  );
  const hasEventbriteLink = timeline.some(
    (row) => row.tickets_sold != null || row.revenue != null,
  );

  // 14-day collapsed window per spec — gives the operator at-a-glance
  // visibility on the recent fortnight without scrolling the full
  // 60-day table. The toggle copy still mentions 60 days because
  // that's the rollup retention period; passing `undefined` lets the
  // tracker render whatever rows it has up to that limit.
  const COLLAPSED_ROWS = 14;

  return (
    <section className="space-y-2">
      <DailyTracker
        eventId={`venue:${eventCode}`}
        hasMetaScope={hasMetaScope}
        hasEventbriteLink={hasEventbriteLink}
        controlled={controlled}
        visibleRowLimit={trackerExpanded ? undefined : COLLAPSED_ROWS}
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
    </section>
  );
}

/**
 * Project the timeline rows to the single-platform view used by the
 * trend chart. The chart's existing `paidSpendOf` helper sums Meta +
 * TikTok spend; for a specific-platform view we want only that
 * platform's columns to participate, with the others zeroed.
 *
 * "All" passes through unchanged (chart sums Meta + TikTok via
 * `paidSpendOf`).
 */
function projectTimelineToPlatform(
  rows: TimelineRow[],
  platform: PlatformId,
): TimelineRow[] {
  if (platform === "all") return rows;
  return rows.map((row) => {
    if (platform === "meta") {
      return {
        ...row,
        tiktok_spend: null,
        tiktok_clicks: null,
        tiktok_video_views: null,
        tiktok_impressions: null,
        tiktok_results: null,
      };
    }
    if (platform === "tiktok") {
      return {
        ...row,
        ad_spend: null,
        link_clicks: null,
        meta_regs: null,
      };
    }
    // google_ads — no Google Ads columns participate in the
    // legacy multi-metric chart yet (the chart reads
    // ad_spend/tiktok_spend only). Strip both so the platform
    // tab renders as "no data" until Google Ads is wired into
    // the chart's spend source.
    return {
      ...row,
      ad_spend: null,
      link_clicks: null,
      meta_regs: null,
      tiktok_spend: null,
      tiktok_clicks: null,
      tiktok_video_views: null,
      tiktok_impressions: null,
      tiktok_results: null,
    };
  });
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

function mergeVenueTimeline(
  rollups: DailyRollupRow[],
  manualEntries: DailyEntry[],
  isMultiEventVenue: boolean,
  cumulativeTicketTimeline: Array<{ date: string; cumulative: number }>,
  events: PortalEvent[],
  /**
   * Venue-wide cumulative timelines derived directly from
   * `tier_channel_sales_daily_history` (migration 089). When present
   * these are used as the primary source for per-day ticket and revenue
   * deltas — both tickets and revenue are derived as
   * `today_cumulative − yesterday_cumulative`. Negative differences are
   * clamped to 0. Falls back to the snapshot-envelope path
   * (`cumulativeTicketTimeline` / `venueSnapshotRevenueDeltas`) for
   * dates not covered by daily_history.
   */
  dailyHistoryTimelines: {
    tickets: Array<{ date: string; cumulative: number }>;
    revenue: Array<{ date: string; cumulative: number }>;
  },
): TimelineRow[] {
  const byDate = new Map<string, TimelineRow>();
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

  // --- Ticket deltas ---
  //
  // Primary: derive from `tier_channel_sales_daily_history` when rows
  // are present.  Secondary: fall back to the snapshot-envelope
  // cumulative (PR fix/venue-trend-tier-channel-snapshot) for any dates
  // not covered by daily_history, which eliminates the
  // xlsx_import → fourthefans phantom drop and reconciles with the
  // `tier_channel_sales` SUM anchor.
  const histTicketDeltas = ticketDeltasFromCumulativeTimeline(
    dailyHistoryTimelines.tickets,
  );
  const snapshotDeltas = ticketDeltasFromCumulativeTimeline(
    cumulativeTicketTimeline,
  );

  // Merge: daily_history deltas take priority; snapshot envelope fills
  // in for dates not covered by daily_history.
  const effectiveTicketDeltas: Map<string, number> =
    histTicketDeltas.size > 0
      ? (() => {
          const merged = new Map(snapshotDeltas);
          for (const [date, delta] of histTicketDeltas) {
            merged.set(date, delta);
          }
          return merged;
        })()
      : snapshotDeltas;

  if (effectiveTicketDeltas.size > 0) {
    for (const current of byDate.values()) {
      current.tickets_sold = null;
    }
    for (const [date, tickets] of effectiveTicketDeltas) {
      const current = byDate.get(date) ?? emptyTimelineRow(date, "live");
      current.tickets_sold = addNullable(current.tickets_sold, tickets);
      byDate.set(date, current);
    }
  }

  // --- Revenue deltas ---
  //
  // Primary: derive from daily_history `revenue_total` cumulative.
  // Secondary: when daily_history has no revenue rows, and rollup has
  // no revenue (e.g. provider integration not yet live), fall back to
  // the weekly ticket_sales_snapshot revenue column.
  const histRevenueDeltas = ticketDeltasFromCumulativeTimeline(
    dailyHistoryTimelines.revenue,
  );

  if (histRevenueDeltas.size > 0) {
    // Replace rollup revenue with daily_history-derived deltas.
    // Spend column is untouched (still from event_daily_rollups).
    for (const current of byDate.values()) {
      current.revenue = null;
    }
    for (const [date, revenue] of histRevenueDeltas) {
      const current = byDate.get(date) ?? emptyTimelineRow(date, "live");
      current.revenue = addNullable(current.revenue, revenue);
      byDate.set(date, current);
    }
  } else if (rollupRevenueTotal === 0) {
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
