"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
} from "@/lib/dashboard/tier-channel-rollups";
import { computeCanonicalEventMetrics } from "@/lib/dashboard/canonical-event-metrics";
import { AttributionGapTile } from "@/components/dashboard/event-report/AttributionGapTile";
import { RealAttributionTile } from "@/components/dashboard/event-report/RealAttributionTile";
import { aggregateSharedVenueBudget } from "@/lib/db/client-dashboard-aggregations";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import type { EventCodeLifetimeMetaCacheRow } from "@/lib/db/event-code-lifetime-meta-cache";
import type { TierChannelDailyHistoryRow } from "@/lib/dashboard/venue-trend-points";
import type { EventLinkedDraft } from "@/lib/db/events";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import type { PlatformId } from "@/lib/dashboard/platform-colors";
import { AdditionalTicketEntriesCard } from "@/components/dashboard/events/additional-ticket-entries-card";
import { VenueAdditionalSpendCard } from "@/components/dashboard/events/venue-additional-spend-card";
import { VenueActiveCreatives } from "./venue-active-creatives";
import {
  useVenueReportModel,
  VenueDailyTrackerSection,
  VenueTrendChartSection,
} from "./venue-daily-report-block";
import { VenuePerformanceSummary } from "@/components/shared/venue-performance-summary";
import { VenueEventBreakdown } from "./venue-event-breakdown";
import { VenueStatsGrid } from "./venue-stats-grid";
import { VenuePaidMediaDailySpendTracker } from "./venue-paid-media-daily-tracker";

/**
 * components/share/venue-full-report.tsx
 *
 * The Performance tab of the venue report — rendered identically on
 * the internal `/clients/[id]/venues/[event_code]` route and the
 * external `/share/venue/[token]` route.
 *
 * Layout (top → bottom):
 *   1. Performance Summary (3 cards, always lifetime)
 *   2. Additional Entries (collapsible, default closed)
 *   3. Topline Stats Grid (windowed + platform-filtered)
 *   4. Daily Trend graph (windowed + platform-filtered)
 *   5. Daily Tracker (windowed, default-collapsed to last 14 days)
 *   6. Event Breakdown (lifetime, single SPEND column from selected platform)
 *   7. Active Creatives (windowed + platform-tabbed)
 *
 * The sticky header (page-level) owns the global Timeframe + Platform
 * selectors and the Sync Now button. This component receives the
 * resolved values via props and threads them down — no URL routing
 * here.
 *
 * History (PR feat/venue-report-layout-restructure):
 *   - Removed standalone "Total Marketing Budget" line — paid-media
 *     budget is now one of the three Performance Summary cards.
 *   - Removed duplicate top-of-page Performance Summary table —
 *     section 1 + section 6 cover that data without overlap.
 *   - Removed Linked Campaigns section — internal admin tooling not
 *     part of the client-facing report.
 *   - Removed per-section Sync / Refresh buttons — single Sync Now
 *     button at the page level fans out to every per-event
 *     rollup-sync + active-creatives refresh.
 */

interface Props {
  /**
   * Token forwarded to per-row tickets / additional-spend endpoints.
   * External usage passes a venue-scope share token; internal usage
   * passes empty string — the table falls back to event-detail
   * navigation for editing.
   */
  token?: string;
  clientId: string;
  /** The venue's `event_code` — the pivot key for venue-scope writes. */
  eventCode: string;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /** Source-stitched snapshots for trend/tracker continuity. */
  trendTicketSnapshots?: WeeklyTicketSnapshotRow[];
  /**
   * Per-day snapshots from `tier_channel_sales_daily_history` (migration
   * 089). When present these take priority over the
   * `ticket_sales_snapshots` envelope, eliminating the "all tickets land
   * on today" spike visible before the nightly cron started writing history.
   */
  trendDailyHistory?: TierChannelDailyHistoryRow[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  isInternal?: boolean;
  /**
   * Controls whether the venue additional-spend card renders in
   * read-only mode on the share surface. Defaults to read-only for
   * external shares that weren't explicitly flagged editable.
   */
  canEdit?: boolean;
  datePreset?: DatePreset;
  customRange?: CustomDateRange;
  /**
   * Global platform filter — drives the stats grid, trend chart, and
   * active creatives section. Event Breakdown's SPEND column also
   * picks up the same filter.
   */
  platform?: PlatformId;
  /**
   * Settings page href used by the stats grid's "Not connected" empty
   * state cards. Internal-only — share view passes null and the cards
   * render the disabled tooltip.
   */
  settingsHref?: string | null;
  /**
   * Linked drafts have moved off the venue report entirely (internal
   * admin tooling, not client-facing). Kept on the props surface as
   * an unused field so existing call-sites compile while a follow-up
   * cleanup removes it from the page-level loaders.
   */
  linkedDrafts?: EventLinkedDraft[];
  /**
   * Per-`event_code` lifetime Meta totals from
   * `event_code_lifetime_meta_cache` (migration 068). The single
   * matching row drives the Reach cell on the topline stats grid —
   * see `<VenueStatsGrid>`'s `lifetimeMeta` prop docblock.
   *
   * Optional for back-compat with any caller that hasn't been wired
   * up yet; unsupplied or empty array renders the legacy "Reach
   * (sum)" cell.
   */
  lifetimeMetaByEventCode?: EventCodeLifetimeMetaCacheRow[];
  /**
   * PR #423 — Real Attribution Reconciliation v2 (dark build).
   * Server-evaluated maps + flags threaded down so the
   * `RealAttributionTile` can render without consulting `process.env`
   * (a client component cannot read non-`NEXT_PUBLIC_` env vars; we
   * deliberately don't `NEXT_PUBLIC_`-prefix the flag because its
   * presence shouldn't be readable to an unauthenticated browser).
   */
  realAttributionEnabled?: boolean;
  legacyAttributionTileEnabled?: boolean;
  metaPurchasesByEventId?: ReadonlyMap<string, number | null>;
  offpixelAttributedPurchasesByEventId?: ReadonlyMap<string, number | null>;
}

export function VenueFullReport({
  token = "",
  clientId,
  eventCode,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots,
  trendTicketSnapshots,
  trendDailyHistory,
  londonOnsaleSpend,
  isInternal = false,
  canEdit = false,
  datePreset = "maximum",
  customRange,
  platform = "all",
  settingsHref = null,
  lifetimeMetaByEventCode,
  realAttributionEnabled = false,
  legacyAttributionTileEnabled = false,
  metaPurchasesByEventId,
  offpixelAttributedPurchasesByEventId,
}: Props) {
  const mode: "dashboard" | "share" = isInternal ? "dashboard" : "share";
  const readOnly = !isInternal && !canEdit;

  const additionalEntryEvents = useMemo(
    () =>
      initialEvents.map((event) => ({
        id: event.id,
        name: event.name,
        ticketTiers: event.ticket_tiers.map((tier) => tier.tier_name),
      })),
    [initialEvents],
  );

  const performance = useMemo(
    () =>
      computeVenuePerformance(
        initialEvents,
        dailyRollups,
        additionalSpend,
        weeklyTicketSnapshots,
      ),
    [additionalSpend, dailyRollups, initialEvents, weeklyTicketSnapshots],
  );

  const hasTikTokAccount = useMemo(
    () => dailyRollups.some((row) => (row.tiktok_spend ?? 0) > 0),
    [dailyRollups],
  );
  const hasGoogleAdsAccount = useMemo(
    () => dailyRollups.some((row) => (row.google_ads_spend ?? 0) > 0),
    [dailyRollups],
  );

  const windowDays = useMemo(
    () => resolvePresetToDays(datePreset, customRange),
    [datePreset, customRange],
  );

  // Pick the cache row matching this venue's event_code. The portal
  // payload may carry every venue's row under one client (internal
  // dashboard) or just this venue's row (share-token loader narrows
  // the array). Either shape produces the right single match.
  const lifetimeMetaForVenue = useMemo(() => {
    if (!lifetimeMetaByEventCode?.length) return null;
    const match = lifetimeMetaByEventCode.find(
      (row) => row.event_code === eventCode,
    );
    if (!match) return null;
    // PR-B of issue #467: thread Clicks + LPV through the same prop
    // so the Stats Grid reads the canonical lifetime cache values the
    // Funnel Pacing tab consumes — single-source contract.
    return {
      meta_reach: match.meta_reach,
      meta_impressions: match.meta_impressions,
      meta_link_clicks: match.meta_link_clicks,
      meta_landing_page_views: match.meta_landing_page_views,
    };
  }, [lifetimeMetaByEventCode, eventCode]);

  // Lifetime cache row matched on `event_code` — one per venue. Used
  // by the AttributionGapTile to read `meta_regs` (raw / non-deduped
  // by design) alongside the rollup-side ticket count.
  const lifetimeCacheRowForVenue = useMemo(() => {
    if (!lifetimeMetaByEventCode?.length) return null;
    return (
      lifetimeMetaByEventCode.find((row) => row.event_code === eventCode) ??
      null
    );
  }, [lifetimeMetaByEventCode, eventCode]);

  // Per-event tier_channel_sales SUM map. Multi-link asymmetry:
  // PortalEvent.tier_channel_sales_tickets is already SUM'd over
  // every linked external_event_id row at the loader layer; we just
  // hand it through to the canonical resolver per event_id.
  const tierChannelTicketsByEventId = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const ev of initialEvents) {
      map.set(ev.id, ev.tier_channel_sales_tickets ?? null);
    }
    return map;
  }, [initialEvents]);

  // Canonical metrics for this venue — pure compute, lifetime-scoped
  // (no windowDays filter). Supplies the AttributionGapTile + any
  // future canonical-resolver-driven cells. Distinct from
  // <VenueStatsGrid>'s windowed aggregator path which still owns the
  // platform + timeframe selectors above; the attribution tile is
  // intentionally lifetime-only because the over_attributed /
  // capi_missing states are about cumulative pixel signal, not a
  // sliced window.
  const venueCanonicalMetrics = useMemo(
    () =>
      computeCanonicalEventMetrics({
        cacheRow: lifetimeCacheRowForVenue,
        dailyRollups,
        events: initialEvents.map((ev) => ({
          id: ev.id,
          event_code: ev.event_code,
        })),
        tierChannelTicketsByEventId,
        metaPurchasesByEventId,
        offpixelAttributedPurchasesByEventId,
      }),
    [
      lifetimeCacheRowForVenue,
      dailyRollups,
      initialEvents,
      tierChannelTicketsByEventId,
      metaPurchasesByEventId,
      offpixelAttributedPurchasesByEventId,
    ],
  );

  const model = useVenueReportModel(
    initialEvents,
    dailyEntries,
    dailyRollups,
    additionalSpend,
    weeklyTicketSnapshots,
    trendTicketSnapshots,
    trendDailyHistory,
  );

  return (
    <div className="space-y-6">
      <VenuePerformanceSummary
        totalMarketing={performance.totalMarketing}
        paidMediaAllocated={performance.paidMediaBudget}
        additionalSpend={performance.additionalSpend}
        paidMediaSpent={performance.paidMediaSpent}
        paidMediaUsedPct={performance.percentUsed}
        ticketsCapacity={performance.capacity}
        ticketsSold={performance.tickets}
        ticketsSellThroughPct={performance.sellThroughPct}
        ticketRevenue={performance.ticketRevenue}
        mailchimpRegistrations={performance.mailchimpRegistrations}
        costPerRegistration={performance.costPerRegistration}
        mailchimpTag={initialEvents[0]?.mailchimp_tag ?? null}
        dailySpendTrackerSlot={
          <VenuePaidMediaDailySpendTracker
            key={`${clientId}:${eventCode}`}
            clientId={clientId}
            eventCode={eventCode}
            shareToken={mode === "share" ? token : undefined}
            paidMediaBudget={performance.paidMediaBudget}
            paidMediaSpent={performance.paidMediaSpent}
          />
        }
      />
      <CollapsibleAdditionalEntries
        mode={mode}
        clientId={clientId}
        eventCode={eventCode}
        events={additionalEntryEvents}
        readOnly={readOnly}
        shareToken={mode === "share" ? token : ""}
      />
      <VenueStatsGrid
        rows={dailyRollups}
        platform={platform}
        windowDays={windowDays}
        hasTikTokAccount={hasTikTokAccount}
        hasGoogleAdsAccount={hasGoogleAdsAccount}
        settingsHref={settingsHref}
        events={initialEvents}
        lifetimeMeta={lifetimeMetaForVenue}
      />
      {/*
        PR #423 — gated dual-tile combinator.
        - Real flag ON  → render RealAttributionTile (the new
          three-number reconciliation surface).
        - Real flag OFF + Legacy flag ON → render the old
          AttributionGapTile for diagnostics.
        - Both OFF (the production default) → render nothing. The
          PR #422 tile is hidden behind a kill-switch until the new
          tile is the default surface.
      */}
      {realAttributionEnabled ? (
        <RealAttributionTile
          metaReportedPurchases={venueCanonicalMetrics.metaReportedPurchases}
          offpixelAttributedPurchases={
            venueCanonicalMetrics.offpixelAttributedPurchases
          }
          ticketsTrue={venueCanonicalMetrics.ticketsTrue}
          trustRatio={venueCanonicalMetrics.attributionTrustRatio}
          coverageRatio={venueCanonicalMetrics.attributionCoverageRatio}
        />
      ) : legacyAttributionTileEnabled ? (
        <AttributionGapTile
          metaRegs={venueCanonicalMetrics.metaRegs}
          ticketsTrue={venueCanonicalMetrics.ticketsTrue}
          attribution={venueCanonicalMetrics.attribution}
        />
      ) : null}
      <VenueTrendChartSection
        model={model}
        datePreset={datePreset}
        customRange={customRange}
        platform={platform}
        mailchimpTag={initialEvents[0]?.mailchimp_tag ?? undefined}
        eventId={initialEvents[0]?.id ?? undefined}
        mailchimpSnapshots={initialEvents[0]?.mailchimp_snapshots}
      />
      <VenueDailyTrackerSection
        eventCode={eventCode}
        model={model}
        mode={mode}
        datePreset={datePreset}
        customRange={customRange}
      />
      <VenueEventBreakdown
        events={initialEvents}
        dailyRollups={dailyRollups}
        londonOnsaleSpend={londonOnsaleSpend}
        additionalSpend={additionalSpend}
        channelEditApiBase={token ? `/api/share/venue/${token}` : undefined}
        canEditChannels={!isInternal && canEdit && !!token}
        isInternalDashboard={isInternal}
        clientId={clientId}
      />
      <VenueActiveCreatives
        token={token}
        clientId={clientId}
        isInternal={isInternal}
        eventCode={eventCode}
        venueLabel={initialEvents[0]?.venue_name ?? eventCode}
        datePreset={datePreset}
        customRange={customRange}
        platform={platform}
        fullReport
      />
    </div>
  );
}

function CollapsibleAdditionalEntries({
  mode,
  clientId,
  eventCode,
  events,
  readOnly,
  shareToken,
}: {
  mode: "dashboard" | "share";
  clientId: string;
  eventCode: string;
  events: Array<{ id: string; name: string; ticketTiers: string[] }>;
  readOnly: boolean;
  shareToken: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="rounded-md border border-border bg-background"
      data-testid="venue-additional-entries"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span className="font-heading text-base tracking-wide text-foreground">
            Additional entries
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground">
          Extra spend + non-tier ticket sales
        </span>
      </button>
      {open ? (
        <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-2">
          <VenueAdditionalSpendCard
            events={events}
            venueScope={{ clientId, eventCode }}
            className="rounded-md border border-border bg-card p-3"
            readOnly={readOnly}
            shareToken={mode === "share" ? shareToken : undefined}
          />
          <AdditionalTicketEntriesCard
            events={events}
            className="rounded-md border border-border bg-card p-3"
            readOnly={readOnly}
            shareToken={mode === "share" ? shareToken : undefined}
          />
        </div>
      ) : null}
    </section>
  );
}

interface VenuePerformance {
  paidMediaBudget: number;
  paidMediaSpent: number;
  additionalSpend: number;
  totalMarketing: number;
  capacity: number | null;
  tickets: number | null;
  ticketRevenue: number | null;
  sellThroughPct: number | null;
  costPerTicket: number | null;
  percentUsed: number | null;
  mailchimpRegistrations: number | null;
  costPerRegistration: number | null;
}

function computeVenuePerformance(
  events: PortalEvent[],
  rollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): VenuePerformance {
  const paidMediaBudget = aggregateSharedVenueBudget(events) ?? 0;
  const eventIds = new Set(events.map((event) => event.id));
  const additionalSpendTotal = sumNumbers(
    additionalSpend
      .filter((row) =>
        row.scope === "venue"
          ? row.venue_event_code === events[0]?.event_code
          : eventIds.has(row.event_id),
      )
      .map((row) => row.amount),
  );
  const capacity = nullableSum(events.map((event) => event.capacity));
  const tickets =
    latestVenueEventTickets(events) ??
    sumLifetimeTickets(rollups) ??
    latestVenueSnapshotTickets(weeklyTicketSnapshots);
  const ticketRevenue = latestVenueEventRevenue(events);
  const paidMediaSpent = sumLifetimeMetaSpend(rollups, events.length > 1);
  const sellThroughPct =
    capacity != null && capacity > 0 && tickets != null
      ? (tickets / capacity) * 100
      : null;
  const costPerTicket = tickets != null && tickets > 0 && paidMediaSpent > 0 ? paidMediaSpent / tickets : null;
  const percentUsed =
    paidMediaBudget > 0 ? (paidMediaSpent / paidMediaBudget) * 100 : null;

  // Mailchimp registrations: sum mailchimp_registrations from events.
  let mailchimpRegistrations: number | null = null;
  for (const ev of events) {
    if (ev.mailchimp_registrations != null) {
      mailchimpRegistrations = (mailchimpRegistrations ?? 0) + ev.mailchimp_registrations;
    }
  }
  const totalSpend = paidMediaSpent + additionalSpendTotal;
  const costPerRegistration =
    mailchimpRegistrations != null && mailchimpRegistrations > 0 && totalSpend > 0
      ? totalSpend / mailchimpRegistrations
      : null;

  return {
    paidMediaBudget,
    paidMediaSpent,
    additionalSpend: additionalSpendTotal,
    totalMarketing: paidMediaBudget + additionalSpendTotal,
    capacity,
    tickets,
    ticketRevenue,
    sellThroughPct,
    costPerTicket,
    percentUsed,
    mailchimpRegistrations,
    costPerRegistration,
  };
}

function sumLifetimeTickets(rollups: DailyRollupRow[]): number | null {
  if (rollups.length === 0) return null;
  let total = 0;
  let any = false;
  for (const row of rollups) {
    if (row.tickets_sold != null) {
      total += row.tickets_sold;
      any = true;
    }
  }
  return any ? total : null;
}

function latestVenueSnapshotTickets(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): number | null {
  if (weeklyTicketSnapshots.length === 0) return null;
  const latestByEvent = new Map<string, WeeklyTicketSnapshotRow>();
  for (const row of weeklyTicketSnapshots) {
    const current = latestByEvent.get(row.event_id);
    if (!current || row.snapshot_at > current.snapshot_at) {
      latestByEvent.set(row.event_id, row);
    }
  }
  if (latestByEvent.size === 0) return null;
  let total = 0;
  for (const row of latestByEvent.values()) total += row.tickets_sold;
  return total;
}

function latestVenueEventTickets(events: PortalEvent[]): number | null {
  if (events.length === 0) return null;
  let total = 0;
  let any = false;
  for (const event of events) {
    if (event.ticket_tiers.length > 0) {
      total += resolveDisplayTicketCount({
        ticket_tiers: event.ticket_tiers,
        latest_snapshot_tickets: event.latest_snapshot?.tickets_sold ?? null,
        fallback_tickets: event.tickets_sold ?? null,
        tier_channel_sales_sum: event.tier_channel_sales_tickets ?? null,
      });
      any = true;
      continue;
    }
    const tickets = event.latest_snapshot?.tickets_sold ?? event.tickets_sold;
    if (tickets == null) continue;
    total += tickets;
    any = true;
  }
  return any ? total : null;
}

function latestVenueEventRevenue(events: PortalEvent[]): number | null {
  if (events.length === 0) return null;
  let total = 0;
  let any = false;
  for (const event of events) {
    if (event.ticket_tiers.length > 0) {
      const r = resolveDisplayTicketRevenue({
        ticket_tiers: event.ticket_tiers,
        latest_snapshot_revenue: event.latest_snapshot?.revenue ?? null,
        tier_channel_sales_revenue: event.tier_channel_sales_revenue ?? null,
      });
      if (r != null) { total += r; any = true; }
      continue;
    }
    const r = event.latest_snapshot?.revenue;
    if (r == null) continue;
    total += r;
    any = true;
  }
  return any ? total : null;
}

function nullableSum(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    any = true;
  }
  return any ? total : null;
}

function sumNumbers(values: Array<number | null | undefined>): number {
  return nullableSum(values) ?? 0;
}

function sumLifetimeMetaSpend(
  rollups: DailyRollupRow[],
  isMultiEventVenue: boolean,
): number {
  let total = 0;
  for (const row of rollups) {
    const hasAllocatedSpend =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const spend = hasAllocatedSpend
      ? (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0)
      : isMultiEventVenue
        ? null
        : row.ad_spend;
    total += paidSpendOf({ ad_spend: spend, tiktok_spend: null });
  }
  return total;
}
