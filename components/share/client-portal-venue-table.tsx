"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Pencil } from "lucide-react";
import {
  isCancelledEvent,
  isCancelledVenueGroup,
  isPastEvent,
  isPastVenueGroup,
} from "@/lib/dashboard/event-recency";

import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import type { TierChannelDailyHistoryRow } from "@/lib/dashboard/venue-trend-points";
import {
  aggregateAllocationByEvent,
  aggregateVenueCampaignPerformance,
  aggregateVenueWoW,
  sortEventsGroupStageFirst,
  type VenueCampaignPerformance,
  type VenueWoWTotals,
} from "@/lib/db/client-dashboard-aggregations";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "./client-refresh-daily-budgets-button";
import {
  buildRolloutGroupKeyByEventId,
  parseExpandedHash,
  serializeExpandedHash,
  type GroupableRow,
} from "@/lib/dashboard/rollout-grouping";
import { getSeriesDisplayLabel } from "@/lib/dashboard/series-display-labels";
import {
  paidLinkClicksOf,
  paidSpendOf,
} from "@/lib/dashboard/paid-spend";
import { CopyToClipboard } from "@/components/dashboard/events/copy-to-clipboard";
import {
  suggestedCommsPhrase,
  type CommsPhrase,
} from "@/lib/dashboard/comms-phrase";
import { suggestedPct, type SuggestedPct } from "@/lib/dashboard/suggested-pct";
import {
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
} from "@/lib/dashboard/tier-channel-rollups";
import {
  venueSpend,
  type GroupSpend,
} from "@/lib/dashboard/venue-spend-model";
import { computePortalEventSpendRowMetrics } from "@/lib/dashboard/portal-event-spend-row";
import { EventTrendChart } from "@/components/dashboard/events/event-trend-chart";
import { AdditionalTicketEntriesCard } from "@/components/dashboard/events/additional-ticket-entries-card";
import { VenueAdditionalSpendCard } from "@/components/dashboard/events/venue-additional-spend-card";
import { TicketTiersSection } from "@/components/dashboard/events/ticket-tiers-section";
import type { TrendChartPoint } from "@/lib/dashboard/trend-chart-data";
import {
  buildVenueTicketSnapshotPoints,
  type TierChannelSalesAnchorRow,
} from "@/lib/dashboard/venue-trend-points";
import { VenueActiveCreatives } from "./venue-active-creatives";
import { VenueEventBreakdown } from "./venue-event-breakdown";
import { VenueSyncButton } from "./venue-sync-button";
import { VenueTicketsClickEdit } from "./venue-tickets-click-edit";
import {
  EventTicketingStatusBadge,
  VenueTicketingStatusBadge,
} from "./last-updated-indicator";

/**
 * Sentinel for "no expanded cards" — re-used every render so the
 * `expanded` Set identity is stable for memoised children. Never
 * mutated (`new Set(base)` in the toggle path always forks).
 */
const EMPTY_EXPAND_SET: ReadonlySet<string> = new Set<string>();

/**
 * Fallback WoW shape passed to a venue when its rollups have not
 * produced any week-over-week data yet (freshly-linked client, or
 * both windows were empty). Null halves render as "—" in the
 * header's parenthetical deltas.
 */
const EMPTY_WOW: VenueWoWTotals = {
  tickets: { current: null, previous: null, delta: null, deltaPct: null },
  cpt: { current: null, previous: null, delta: null, deltaPct: null },
  roas: { current: null, previous: null, delta: null, deltaPct: null },
};
const COL_COUNT = 13;

interface SavedSnapshot {
  tickets_sold: number;
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

interface Props {
  token: string;
  /**
   * UUID of the client the portal is scoped to. Used by each
   * `VenueSection` to build the "View full venue report" CTA's href
   * (`/clients/[id]/venues/[event_code]` on the internal surface).
   * Threaded through props rather than a React context because the
   * file is the only consumer and the prop keeps the data flow
   * readable at a glance.
   */
  clientId: string;
  events: PortalEvent[];
  /**
   * Lifetime spend of the shared WC26-LONDON-ONSALE campaign. When non-null,
   * the four London venue sections switch from the default `split` spend
   * model to the `add` model (see `venueSpend` below) and an Overall London
   * aggregate row renders ahead of the individual venues.
   */
  londonOnsaleSpend: number | null;
  /**
   * Lifetime spend of the shared WC26-LONDON-PRESALE campaign. Surfaced as
   * an informational badge on the Overall London header — per-event prereg
   * is already split correctly across the venues that ran a presale, so
   * this value is not redistributed by the table.
   */
  londonPresaleSpend: number | null;
  /**
   * Legacy daily tracker rows for the client. Kept on the public
   * payload for existing write paths, but the venue-expanded graph now
   * reads `dailyRollups` so it matches the event report chart.
   */
  dailyEntries: DailyEntry[];
  /**
   * Event daily rollups across the client. Feeds venue activity,
   * WoW deltas, spend allocation, and the shared trend chart.
   */
  dailyRollups: DailyRollupRow[];
  /** Additional spend rows across the client, filtered per venue card. */
  additionalSpend: AdditionalSpendRow[];
  /**
   * Dominant-source snapshots (WoW comparability). One row per
   * (event, week) using the highest-priority source overall for each
   * event. Used by WoW aggregation; NOT the trend chart ticket line.
   */
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /**
   * Source-stitched snapshots for the trend chart ticket line. Uses
   * per-day priority resolution so events with mixed sources produce a
   * continuous trend line. Forwarded to `buildVenueTrendPoints` →
   * `buildVenueTicketSnapshotPoints`.
   */
  trendTicketSnapshots: WeeklyTicketSnapshotRow[];
  /**
   * Per-day snapshots from `tier_channel_sales_daily_history` (migration
   * 089). When present these take priority over the `ticket_sales_snapshots`
   * envelope for the mini-trend chart in each venue card.
   */
  trendDailyHistory?: TierChannelDailyHistoryRow[];
  /** Exposes admin-only controls per row when true. */
  isInternal: boolean;
  onSnapshotSaved: (eventId: string, snapshot: SavedSnapshot) => void;
  /**
   * When true, every venue group renders as if the operator had
   * opened its expand/collapse header — overrides both the default
   * (collapsed) and any URL-hash state. Powers the "full venue
   * report" surface at `/clients/[id]/venues/[event_code]` and
   * `/share/venue/[token]` where the venue IS the page, so there's
   * nothing to collapse to. Defaults to false; the client portal
   * and the internal client dashboard continue to honour the hash-
   * driven toggle the operator interacts with.
   */
  forceExpandAll?: boolean;
  /**
   * Controls whether the "Past Events" collapsible section at the
   * bottom is open. Managed by the parent (`ClientPortal`) so URL
   * deeplink state (`?past=1`) is centralised in one place.
   * Defaults to false (section collapsed on first load).
   */
  pastExpanded?: boolean;
  /**
   * Called when the user clicks the Past Events accordion header.
   * Parent updates URL and flips `pastExpanded`.
   */
  onPastToggle?: () => void;
  /**
   * Controls whether the "Cancelled Events" collapsible section is
   * open. Managed by the parent (`ClientPortal`) for `?cancelled=1`
   * URL deeplink parity. Defaults to false.
   */
  cancelledExpanded?: boolean;
  /**
   * Called when the user clicks the Cancelled Events accordion header.
   */
  onCancelledToggle?: () => void;
}

/**
 * Venue-grouped reporting table that replaces the old per-event card list
 * on /share/client/[token]. The shape mirrors the Google Sheets doc the
 * client used to maintain by hand: one section per venue, one data row per
 * event, plus a "Total" row that re-derives CPT / ROAS from the
 * venue-level sums.
 *
 * Two spend models — picked per venue group via `venueSpend()`:
 *   - `split` (default, non-London): meta_spend_cached is treated as the
 *     campaign's *combined* spend (prereg + on-sale rolled into one Meta
 *     campaign). Per-event total = campaignSpend / eventCount; per-event
 *     ad = perEventTotal − prereg. This is the historical model.
 *   - `add` (London venues, when londonOnsaleSpend is provided): the four
 *     London venues share an extra on-sale campaign on top of each
 *     venue's own meta campaign. Per-event ad = ((onsale / 4) + venueMeta)
 *     / eventCount. Per-event total = prereg + perEventAd. This matches
 *     the new WC26 wiring where prereg and on-sale live in distinct Meta
 *     campaigns.
 *
 * Revenue is no longer derived from a stored ticket_price — the client
 * types it in directly through the snapshot row.
 *
 * Edit mode: a single "Edit" button at the top of each venue section
 * flips every Tickets Sold + Revenue cell to inline inputs. Cells save
 * on blur (no per-row Save button). "Done" exits edit mode.
 */

function isLondonCity(city: string | null | undefined): boolean {
  return (city ?? "").toLowerCase() === "london";
}

/**
 * Region buckets the venue table renders as separate sub-sections.
 * Order here is also the render order top-to-bottom on the page.
 */
type Region = "scotland" | "london" | "england_uk";

const REGION_LABEL: Record<Region, string> = {
  scotland: "Scotland",
  london: "England – London",
  england_uk: "England – UK",
};

const REGION_ORDER: Region[] = ["scotland", "london", "england_uk"];

/**
 * Fixed render order for the four London venues — matches the
 * spreadsheet sheet the client expects to see. Substring matching
 * (case-insensitive) so harmless name variants like "Shepherds Bush"
 * vs "Shepherd's Bush" both anchor to the same slot.
 */
const LONDON_VENUE_ORDER = [
  "kentish",
  "shepherd",
  "shoreditch",
  "tottenham",
] as const;

function londonOrderIndex(displayName: string): number {
  const lower = displayName.toLowerCase();
  for (let i = 0; i < LONDON_VENUE_ORDER.length; i++) {
    if (lower.includes(LONDON_VENUE_ORDER[i])) return i;
  }
  // Anything not on the canonical list lands at the end. Defensive — a
  // new London venue we haven't slotted yet shouldn't disappear.
  return LONDON_VENUE_ORDER.length;
}

function regionForGroup(group: VenueGroup): Region {
  // Scotland is country-driven (Aberdeen / Edinburgh have no city
  // signal that distinguishes them from English cities). Spec calls
  // out reading from group.events[0].venue_country specifically; every
  // event in a group shares a venue, so [0] is sufficient.
  if (group.events[0]?.venue_country === "Scotland") return "scotland";
  if (isLondonCity(group.city)) return "london";
  return "england_uk";
}

function compareByCityThenName(a: VenueGroup, b: VenueGroup): number {
  const cityCmp = (a.city ?? "").localeCompare(b.city ?? "");
  if (cityCmp !== 0) return cityCmp;
  return a.displayName.localeCompare(b.displayName);
}

function partitionByRegion(venues: VenueGroup[]): Record<Region, VenueGroup[]> {
  const out: Record<Region, VenueGroup[]> = {
    scotland: [],
    london: [],
    england_uk: [],
  };
  for (const group of venues) {
    out[regionForGroup(group)].push(group);
  }
  out.scotland.sort(compareByCityThenName);
  out.london.sort(
    (a, b) => londonOrderIndex(a.displayName) - londonOrderIndex(b.displayName),
  );
  out.england_uk.sort(compareByCityThenName);
  return out;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}

function formatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}

function formatPct(n: number | null, dp: 0 | 1 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

function formatSuggestedPct(n: SuggestedPct | null): string {
  if (n === null) return "—";
  if (n === "SOLD OUT") return "SOLD OUT";
  if (n === "ON SALE SOON") return "On Sale Soon";
  return `${Math.round(n)}%`;
}

function CommsChip({ phrase }: { phrase: CommsPhrase }) {
  const display = phrase.primary === "SOLD OUT" ? "SOLD OUT" : phrase.short;
  return (
    <CopyToClipboard
      text={phrase.primary}
      title={`${phrase.primary} — click to copy`}
      className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      {display}
    </CopyToClipboard>
  );
}

function formatCompactDate(raw: string): string {
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

function formatChange(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}

/**
 * Signed integer-ish number — "+22", "-15", "0". Used by the WoW
 * deltas on the venue header; dedicated helper rather than reusing
 * `formatChange` because we always want the `+` for zero-delta's
 * absent-so-we-render-nothing case to be explicit at the call site.
 */
function formatSignedNumber(n: number): string {
  if (n === 0) return "0";
  const abs = NUM.format(Math.abs(n));
  return `${n > 0 ? "+" : "-"}${abs}`;
}

/**
 * Signed GBP — "+£0.45", "-£1.20". `dp` drives the precision so the
 * WoW CPT delta reads with pence (`2`) while whole-pound totals can
 * re-use the helper at `0`. Symbol always leads the digits so the
 * sign + currency reads "-£1" not "£-1".
 */
function formatSignedGBP(n: number, dp: 0 | 2 = 2): string {
  if (n === 0) return "£0";
  const abs = (dp === 2 ? GBP2 : GBP).format(Math.abs(n));
  return `${n > 0 ? "+" : "-"}${abs}`;
}

/**
 * Inline renderer for a week-over-week parenthetical on the venue
 * header. Hides completely when either side of the comparison is
 * null (the aggregator signal for "one period had zero data").
 * `positiveIsGood` flips the colour palette for CPT (where falling
 * costs are good).
 */
function WoWDeltaInline({
  delta,
  formatAbs,
  positiveIsGood,
}: {
  delta: { delta: number | null; deltaPct: number | null };
  formatAbs: (n: number) => string;
  positiveIsGood: boolean;
}) {
  if (delta.delta == null) {
    return (
      <span className="ml-1 text-[11px] text-muted-foreground">(—)</span>
    );
  }
  const up = delta.delta > 0;
  const good = positiveIsGood ? up : !up;
  const colour = good ? "text-emerald-600" : "text-red-600";
  // Render deltas as `(+22, +9.7%)` — one set of parens, comma-
  // separated. Earlier iterations nested the percentage in its own
  // bracket (`(-692 (-85.1%))`) which read as a nested expression
  // rather than a single WoW delta, confusing operators who parsed
  // the outer number as the 7-day cumulative.
  const pctSuffix =
    delta.deltaPct != null && Number.isFinite(delta.deltaPct)
      ? `, ${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct.toFixed(1)}%`
      : "";
  return (
    <span className={`ml-1 text-[11px] ${colour}`}>
      {`(${formatAbs(delta.delta)}${pctSuffix})`}
    </span>
  );
}

function formatRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function formatSignedRoas(n: number): string {
  if (n === 0) return "0.00×";
  return `${n > 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n >= 3) return "text-emerald-600 font-semibold";
  if (n < 1) return "text-red-600 font-semibold";
  return "text-foreground";
}

/**
 * CPT change is a *signed* delta in GBP. Convention:
 *   - negative = CPT fell (more tickets per pound) → good, render green
 *   - positive = CPT rose (each ticket costs more) → bad, render amber
 *   - null     = previous-week CPT can't be computed (no prior tickets
 *                or no spend yet) → muted
 *
 * The leading `+` / `−` characters are the typographic sign glyphs (real
 * Unicode minus, not ASCII hyphen) so the column visually aligns even
 * when a row has no sign prefix.
 */
function formatCptChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return GBP2.format(0);
  const abs = GBP2.format(Math.abs(n));
  return n > 0 ? `+${abs}` : `−${abs}`;
}

function cptChangeClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n < 0) return "text-emerald-600 font-semibold";
  if (n > 0) return "text-amber-600 font-semibold";
  return "text-foreground";
}

interface VenueGroup {
  key: string;
  /**
   * Stable identifier suitable for the URL hash. Grouped venue rows
   * collapse to `event_code`; solo events fall back to the event id.
   */
  expandKey: string;
  /**
   * Shared event_code for grouped cards. `null` for solo groups that
   * happened to have no event_code on the underlying event (rare —
   * most events set this at creation). When populated, downstream
   * components (`VenueActiveCreatives`, "View full venue report"
   * CTA) use it to join Meta Graph `/ads` results via the bracket
   * pattern `[event_code]` carried in the campaign name.
   */
  eventCode: string | null;
  displayName: string;
  city: string | null;
  budget: number | null;
  /** First non-null meta_spend_cached across the group's events. */
  campaignSpend: number | null;
  /** Number of events in the group — divisor for per-event total. */
  eventCount: number;
  events: PortalEvent[];
}

function portalEventToGroupable(ev: PortalEvent): GroupableRow {
  return {
    eventId: ev.id,
    eventCode: ev.event_code,
    eventDate: ev.event_date,
    venueName: ev.venue_name,
    capacity: ev.capacity,
    ticketingMode: "none",
    status: "ready",
    missing: [],
    warnings: [],
    hasShare: false,
  };
}

/**
 * Group events using the same keys as `lib/dashboard/rollout-grouping`
 * (`series:${event_code}` when ≥2 rows share a code).
 *
 * Preserves input order: the SSR loader already sorts by event_date,
 * so rendering stays predictable across refreshes without an extra
 * `localeCompare` sort (which previously reordered by venue name
 * and masked the "most recent match" signal operators care about).
 */
function groupByEventCodeAndDate(events: PortalEvent[]): VenueGroup[] {
  const groupable = events.map(portalEventToGroupable);
  const keyByEventId = buildRolloutGroupKeyByEventId(groupable);

  const counts = new Map<string, number>();
  for (const ev of events) {
    const k = keyByEventId.get(ev.id);
    if (!k || k.startsWith("__solo__")) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const groupsByKey = new Map<string, VenueGroup>();
  const out: VenueGroup[] = [];
  const sortedGroups = new Set<VenueGroup>();

  for (const ev of events) {
    const rollKey = keyByEventId.get(ev.id) ?? `__solo__::${ev.id}`;
    const shouldGroup =
      !rollKey.startsWith("__solo__") && (counts.get(rollKey) ?? 0) >= 2;

    if (shouldGroup) {
      const existing = groupsByKey.get(rollKey);
      if (existing) {
        existing.events.push(ev);
        existing.eventCount += 1;
        if (existing.budget === null && ev.budget_marketing !== null) {
          existing.budget = ev.budget_marketing;
        }
        if (existing.campaignSpend === null && ev.meta_spend_cached !== null) {
          existing.campaignSpend = ev.meta_spend_cached;
        }
        continue;
      }
      const group: VenueGroup = {
        key: rollKey,
        // event_code is a stable, user-visible handle the operator
        // recognises in the URL hash — beats a UUID every time.
        expandKey: ev.event_code as string,
        eventCode: ev.event_code,
        displayName:
          getSeriesDisplayLabel(ev.event_code) ??
          ev.venue_name ??
          (ev.event_code as string),
        city: ev.venue_city,
        budget: ev.budget_marketing,
        campaignSpend: ev.meta_spend_cached,
        eventCount: 1,
        events: [ev],
      };
      groupsByKey.set(rollKey, group);
      out.push(group);
      continue;
    }

    // Solo group — each event stands alone visually, but keep the
    // event_code as the hash key when present so deep-links remain
    // stable even if the event's UUID is hidden from the operator.
    const soloKey = `solo::${ev.id}`;
    out.push({
      key: soloKey,
      expandKey: ev.event_code ?? ev.id,
      // Solo groups still carry a real event_code when the event has
      // one — lets single-event venues render active creatives via
      // the same `[event_code]` bracket join as grouped ones. Falls
      // through as null when the event legitimately has no code.
      eventCode: ev.event_code,
      displayName:
        getSeriesDisplayLabel(ev.event_code) ??
        ev.name ??
        ev.venue_name ??
        ev.event_code ??
        "—",
      city: ev.venue_city,
      budget: ev.budget_marketing,
      campaignSpend: ev.meta_spend_cached,
      eventCount: 1,
      events: [ev],
    });
  }

  // Standardise per-card event order: group-stage matches first
  // (alphabetical by opponent), knockouts last in bracket order. The
  // raw SSR loader sorts by `event_date DESC`, which put "Last 32"
  // at the top of some venues and the bottom of others depending on
  // how the dates landed. `sortEventsGroupStageFirst` is stable and
  // null-tolerant, and only mutates the already-built arrays inside
  // each group (the group ORDER — which card appears first on the
  // page — stays driven by the SSR ordering).
  for (const g of out) {
    if (sortedGroups.has(g)) continue;
    g.events = sortEventsGroupStageFirst(g.events);
    sortedGroups.add(g);
  }

  return out;
}

interface VenueTotals {
  prereg: number;
  ad: number | null;
  total: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  cptPrevious: number | null;
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
}

function sumVenue(group: VenueGroup, spend: GroupSpend): VenueTotals {
  let prereg = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasRevenue = false;
  for (const ev of group.events) {
    // Match `computePortalEventSpendRowMetrics`: allocator presale is paid-media
    // Ad Spend, not a separate Pre-reg value, once the allocator has
    // covered this event.
    const allocPresale =
      spend.kind === "allocated" ? spend.byEventId.get(ev.id) : undefined;
    const rowPrereg =
      allocPresale && allocPresale.daysCoveredPresale > 0
        ? 0
        : ev.prereg_spend ?? 0;
    prereg += rowPrereg;
    const sold = resolveDisplayTicketCount({
      ticket_tiers: ev.ticket_tiers,
      latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
      fallback_tickets: ev.tickets_sold ?? null,
      tier_channel_sales_sum: ev.tier_channel_sales_tickets ?? null,
    });
    tickets += sold;
    prevTickets += ev.tickets_sold_previous ?? 0;
    const r =
      ev.ticket_tiers.length > 0
        ? resolveDisplayTicketRevenue({
            ticket_tiers: ev.ticket_tiers,
            latest_snapshot_revenue: ev.latest_snapshot?.revenue ?? null,
            tier_channel_sales_revenue: ev.tier_channel_sales_revenue ?? null,
          })
        : ev.latest_snapshot?.revenue ?? null;
    if (r !== null && r !== undefined) {
      hasRevenue = true;
      revenue += r;
    }
  }

  let total: number | null;
  let ad: number | null;
  if (spend.kind === "allocated") {
    // Venue total ad spend = allocator spend plus presale paid
    // media. This matches the Paid Media card/header source.
    ad = spend.venuePaidMedia;
    total = prereg + spend.venuePaidMedia;
  } else if (spend.kind === "split") {
    // Legacy: campaign value already includes prereg, so ad = total − prereg.
    total = group.campaignSpend;
    ad = total !== null ? total - prereg : null;
  } else if (spend.kind === "add") {
    // London: venue ad = perEventAd × eventCount (== onsaleShare + venueMeta).
    // Total = prereg + venueAd. Re-multiplying perEventAd preserves the
    // exact same arithmetic the per-row cells use, so the venue total
    // matches the visible sum of its rows without floating-point drift.
    const venueAd =
      spend.perEventAd !== null ? spend.perEventAd * group.eventCount : null;
    ad = venueAd;
    total = venueAd !== null ? prereg + venueAd : null;
  } else {
    ad = spend.venuePaidMedia;
    total = prereg + spend.venuePaidMedia;
  }

  const cpt = total !== null && total > 0 && tickets > 0 ? total / tickets : null;
  const cptPrevious =
    total !== null && total > 0 && prevTickets > 0
      ? total / prevTickets
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const finalRevenue = hasRevenue ? revenue : null;
  const roas =
    finalRevenue !== null && total !== null && total > 0
      ? finalRevenue / total
      : null;
  return {
    prereg,
    ad,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    cptPrevious,
    cptChange,
    revenue: finalRevenue,
    roas,
  };
}

function displayVenueSpend(
  group: VenueGroup,
  spend: GroupSpend,
  totals: VenueTotals,
): number | null {
  if (spend.kind === "rollup") {
    return spend.venuePaidMedia;
  }
  // Allocator-derived spend is always preferred over the stale meta_spend_cached
  // column (group.campaignSpend). Use venuePaidMedia = specific + generic + presale
  // which is exactly what the trend pill and event breakdown rows read.
  if (spend.kind === "allocated") {
    return spend.venuePaidMedia;
  }
  if (spend.kind !== "add" && group.campaignSpend !== null) {
    return group.campaignSpend;
  }
  return totals.total;
}

function paidSpendByEvent(dailyRollups: DailyRollupRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of dailyRollups) {
    const spend = paidSpendOf(row);
    if (spend === 0 && row.ad_spend == null && row.tiktok_spend == null) {
      continue;
    }
    out.set(row.event_id, (out.get(row.event_id) ?? 0) + spend);
  }
  return out;
}

function isBristolVenueGroup(group: VenueGroup): boolean {
  const haystack = [
    group.eventCode,
    group.displayName,
    group.city,
    ...group.events.map((event) => event.venue_name),
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return haystack.includes("BRISTOL") || haystack.includes("PROSPECT BUILDING");
}

function sumNullable<K extends keyof DailyRollupRow>(
  rows: DailyRollupRow[],
  key: K,
): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "number") continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function sumPaidSpendNullable(rows: DailyRollupRow[]): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    if (row.ad_spend == null && row.tiktok_spend == null) continue;
    total += paidSpendOf(row);
    seen = true;
  }
  return seen ? total : null;
}

export function ClientPortalVenueTable({
  token,
  clientId,
  events,
  londonOnsaleSpend,
  londonPresaleSpend,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots,
  trendTicketSnapshots,
  trendDailyHistory,
  isInternal,
  onSnapshotSaved,
  forceExpandAll = false,
  pastExpanded = false,
  onPastToggle,
  cancelledExpanded = false,
  onCancelledToggle,
}: Props) {
  // Stable `now` for the lifetime of this component mount — all
  // recency checks on this render use the same clock so there's no
  // drift between `activeVenues` and per-row `isPastEvent` calls.
  const now = useMemo(() => new Date(), []);

  const allVenues = useMemo(() => groupByEventCodeAndDate(events), [events]);

  // Three-bucket split with priority: cancelled > past > active.
  // A cancelled group is never shown in active or past — it goes
  // straight to the Cancelled accordion regardless of its event_date.
  const { activeVenues, pastVenues, cancelledVenues } = useMemo(() => {
    const active: VenueGroup[] = [];
    const past: VenueGroup[] = [];
    const cancelled: VenueGroup[] = [];
    for (const group of allVenues) {
      if (isCancelledVenueGroup(group.events)) {
        cancelled.push(group);
      } else if (isPastVenueGroup(group.events, now)) {
        past.push(group);
      } else {
        active.push(group);
      }
    }
    return { activeVenues: active, pastVenues: past, cancelledVenues: cancelled };
  }, [allVenues, now]);

  // Use only active venues for the main region rendering.
  const venues = activeVenues;
  const regions = useMemo(() => partitionByRegion(venues), [venues]);
  // Lifetime per-event allocation map — built from the PR D2
  // columns on every rollup row. Events without any non-null
  // allocation day don't appear in the map, which is exactly the
  // "fall back to the split model" signal `venueSpend` reads.
  const allocationByEvent = useMemo(
    () => aggregateAllocationByEvent(dailyRollups),
    [dailyRollups],
  );
  const paidSpendByEventMap = useMemo(
    () => paidSpendByEvent(dailyRollups),
    [dailyRollups],
  );

  // WoW per venue group, computed once at the parent so the header
  // render isn't triggering a per-row scan of `dailyRollups`. Anchored
  // to the browser's `today` (ISO date) — stable across renders of
  // the same calendar day so the values don't flicker as React
  // re-renders.
  const todayIso = useMemo(
    () => new Date().toISOString().slice(0, 10),
    [],
  );
  const wowByVenue = useMemo(() => {
    const map = new Map<string, VenueWoWTotals>();
    for (const g of venues) {
      // Pass weekly snapshots through so the aggregator uses
      // cumulative-vs-cumulative semantics for tickets (pre-
      // collapsed per-event on the server to a single source —
      // see `collapseWeeklyNormalizedPerEvent`). Without this the
      // aggregator sums rollup tickets_sold across windows, which
      // produced the Leeds FA Cup SF "-692 (-85.1%)" phantom
      // regression from PR 2's brief.
      map.set(
        g.key,
        aggregateVenueWoW(g.events, dailyRollups, todayIso, weeklyTicketSnapshots),
      );
    }
    return map;
  }, [venues, dailyRollups, todayIso, weeklyTicketSnapshots]);

  // Expand/collapse state — every card defaults to collapsed so a
  // 16-venue roster reads as a clean topline. The URL hash is the
  // source of truth once the operator starts interacting, so
  // link-with-open-cards + browser back/forward still work. We
  // track three states:
  //   null           — no interaction yet; show the default
  //                    (everything collapsed).
  //   new Set()      — operator explicitly closed the last open
  //                    card. Distinct from `null` so the next
  //                    render doesn't silently re-apply a default.
  //   new Set([...]) — operator's explicit open-set.
  //
  // Keep the first client render identical to SSR. Reading
  // `window.location.hash` in the state initializer makes deep-linked
  // pages hydrate with expanded sections that the server never
  // rendered, which trips React hydration error #418. The effect below
  // applies any hash immediately after hydration.
  const [hashOverride, setHashOverride] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => {
      const next = parseExpandedHash(window.location.hash);
      setHashOverride(next.size > 0 ? next : null);
    };
    onChange();
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Default to an empty set when no hash is present — explicit opt-in
  // to expansion is the new contract. An empty default collection is
  // intentionally re-used rather than a fresh `new Set()` per render
  // so the `expanded` identity is stable for memoised children.
  //
  // When `forceExpandAll` is on (full-venue-report usage), the set
  // is recomputed from the venue list rather than honoured from the
  // hash — there's no collapse affordance on that surface, so any
  // toggle attempt is absorbed by `toggleGroup` returning to the
  // all-expanded set.
  const forcedExpanded = useMemo(
    () =>
      forceExpandAll
        ? new Set(allVenues.map((v) => v.expandKey))
        : null,
    [forceExpandAll, allVenues],
  );
  const expanded =
    forcedExpanded ?? hashOverride ?? EMPTY_EXPAND_SET;

  const toggleGroup = useCallback(
    (expandKey: string) => {
      const base = hashOverride ?? EMPTY_EXPAND_SET;
      const next = new Set(base);
      if (next.has(expandKey)) next.delete(expandKey);
      else next.add(expandKey);
      if (typeof window !== "undefined") {
        const hash = serializeExpandedHash(next);
        const url = new URL(window.location.href);
        url.hash = hash ? `#${hash}` : "";
        window.history.replaceState(null, "", url.toString());
      }
      // Always mark as overridden once the user interacts — even an
      // empty set ("closed everything I had open") is a meaningful
      // intent that shouldn't flip back to the default next render.
      setHashOverride(next);
    },
    [hashOverride],
  );

  // Past/cancelled section aggregates shown in accordion headers.
  // Both must be declared BEFORE any early returns so hooks are called
  // in the same order on every render.
  const pastSectionSummary = useMemo(() => {
    let tickets = 0;
    for (const group of pastVenues) {
      for (const ev of group.events) {
        tickets += resolveDisplayTicketCount({
          ticket_tiers: ev.ticket_tiers,
          latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
          fallback_tickets: ev.tickets_sold ?? null,
          tier_channel_sales_sum: ev.tier_channel_sales_tickets ?? null,
        });
      }
    }
    return { tickets, venues: pastVenues.length };
  }, [pastVenues]);

  const cancelledSectionSummary = useMemo(() => {
    let budgetTotal = 0;
    let hasBudget = false;
    for (const group of cancelledVenues) {
      for (const ev of group.events) {
        if (ev.budget_marketing != null) {
          budgetTotal += ev.budget_marketing;
          hasBudget = true;
        }
      }
    }
    return {
      venues: cancelledVenues.length,
      budget: hasBudget ? budgetTotal : null,
    };
  }, [cancelledVenues]);

  if (allVenues.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No events to report on yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {REGION_ORDER.map((region) => {
        const groups = regions[region];
        if (groups.length === 0) return null;
        return (
          <div key={region} className="space-y-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
              {REGION_LABEL[region]}
            </h2>
            {/* Overall London aggregate sits at the top of the London
                region, mirroring the spreadsheet layout the client uses
                offline. Other regions don't have a shared-campaign
                aggregate so this only fires for `london`. */}
            {region === "london" && (
              <OverallLondonSection
                groups={groups}
                onsaleSpend={londonOnsaleSpend}
                presaleSpend={londonPresaleSpend}
              />
            )}
            {groups.map((group) => (
              <VenueSection
                key={group.key}
                token={token}
                clientId={clientId}
                group={group}
                londonOnsaleSpend={londonOnsaleSpend}
                spend={venueSpend(
                  group,
                  londonOnsaleSpend,
                  allocationByEvent,
                  paidSpendByEventMap,
                )}
                wow={wowByVenue.get(group.key) ?? EMPTY_WOW}
                dailyRollups={dailyRollups}
                weeklyTicketSnapshots={weeklyTicketSnapshots}
                trendTicketSnapshots={trendTicketSnapshots}
                trendDailyHistory={trendDailyHistory}
                additionalSpend={additionalSpend}
                isExpanded={expanded.has(group.expandKey)}
                onToggle={() => toggleGroup(group.expandKey)}
                isInternal={isInternal}
                onSnapshotSaved={onSnapshotSaved}
                now={now}
              />

            ))}
          </div>
        );
      })}

      {/* ── Past Events accordion ─────────────────────────────────── */}
      {pastVenues.length > 0 && (
        <div className="space-y-6">
          {/* Accordion header — always visible regardless of open/close state. */}
          <button
            type="button"
            onClick={onPastToggle}
            aria-expanded={pastExpanded}
            aria-controls="past-events-section"
            className="flex w-full items-center gap-2 text-left"
          >
            <span
              className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-hidden="true"
            >
              {pastExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Past Events
            </h2>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {pastSectionSummary.venues}
            </span>
            {!pastExpanded && (
              <span className="ml-1 text-[11px] text-muted-foreground/70">
                {formatNumber(pastSectionSummary.tickets)} tickets ·{" "}
                {pastSectionSummary.venues} venue
                {pastSectionSummary.venues === 1 ? "" : "s"}
              </span>
            )}
          </button>

          {pastExpanded && (
            <div id="past-events-section" className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Past totals:{" "}
                <span className="font-medium text-foreground">
                  {formatNumber(pastSectionSummary.tickets)} tickets
                </span>{" "}
                ·{" "}
                <span className="font-medium text-foreground">
                  {pastSectionSummary.venues} venue
                  {pastSectionSummary.venues === 1 ? "" : "s"}
                </span>
              </p>
              {pastVenues.map((group) => (
                <VenueSection
                  key={group.key}
                  token={token}
                  clientId={clientId}
                  group={group}
                  londonOnsaleSpend={londonOnsaleSpend}
                  spend={venueSpend(
                    group,
                    londonOnsaleSpend,
                    allocationByEvent,
                    paidSpendByEventMap,
                  )}
                  wow={wowByVenue.get(group.key) ?? EMPTY_WOW}
                  dailyRollups={dailyRollups}
                  weeklyTicketSnapshots={weeklyTicketSnapshots}
                  trendTicketSnapshots={trendTicketSnapshots}
                  trendDailyHistory={trendDailyHistory}
                  additionalSpend={additionalSpend}
                  isExpanded={expanded.has(group.expandKey)}
                  onToggle={() => toggleGroup(group.expandKey)}
                  isInternal={isInternal}
                  onSnapshotSaved={onSnapshotSaved}
                  now={now}
                  isPastGroup
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Cancelled Events accordion ──────────────────────────────── */}
      {cancelledVenues.length > 0 && (
        <div className="space-y-6">
          <button
            type="button"
            onClick={onCancelledToggle}
            aria-expanded={cancelledExpanded}
            aria-controls="cancelled-events-section"
            className="flex w-full items-center gap-2 text-left"
          >
            <span
              className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-red-500/70 transition-colors hover:bg-muted hover:text-foreground"
              aria-hidden="true"
            >
              {cancelledExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-red-600/70 dark:text-red-400/70">
              Cancelled Events
            </h2>
            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {cancelledSectionSummary.venues}
            </span>
          </button>

          {cancelledExpanded && (
            <div id="cancelled-events-section" className="space-y-6">
              <p className="text-xs text-muted-foreground">
                Cancelled totals:{" "}
                {cancelledSectionSummary.budget !== null ? (
                  <>
                    <span className="font-medium text-foreground">
                      {formatGBP(cancelledSectionSummary.budget)} budgets
                    </span>{" "}
                    ·{" "}
                  </>
                ) : null}
                <span className="font-medium text-foreground">
                  {cancelledSectionSummary.venues} venue
                  {cancelledSectionSummary.venues === 1 ? "" : "s"}
                </span>
              </p>
              {cancelledVenues.map((group) => (
                <VenueSection
                  key={group.key}
                  token={token}
                  clientId={clientId}
                  group={group}
                  londonOnsaleSpend={londonOnsaleSpend}
                  spend={venueSpend(
                    group,
                    londonOnsaleSpend,
                    allocationByEvent,
                    paidSpendByEventMap,
                  )}
                  wow={wowByVenue.get(group.key) ?? EMPTY_WOW}
                  dailyRollups={dailyRollups}
                  weeklyTicketSnapshots={weeklyTicketSnapshots}
                  trendTicketSnapshots={trendTicketSnapshots}
                  trendDailyHistory={trendDailyHistory}
                  additionalSpend={additionalSpend}
                  isExpanded={expanded.has(group.expandKey)}
                  onToggle={() => toggleGroup(group.expandKey)}
                  isInternal={isInternal}
                  onSnapshotSaved={onSnapshotSaved}
                  now={now}
                  isCancelledGroup
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OverallLondonSectionProps {
  groups: VenueGroup[];
  onsaleSpend: number | null;
  presaleSpend: number | null;
}

interface OverallLondonTotals {
  prereg: number;
  ad: number | null;
  total: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  cptPrevious: number | null;
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
  /** Sum of meta_spend_cached across the London venue groups (display only). */
  venueMetaSum: number | null;
  /** Number of underlying London match events (sanity-check / footnote). */
  eventCount: number;
}

function computeOverallLondon(
  groups: VenueGroup[],
  onsaleSpend: number | null,
): OverallLondonTotals {
  let prereg = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasRevenue = false;
  let venueMetaSum = 0;
  let venueMetaCount = 0;
  let eventCount = 0;
  for (const group of groups) {
    eventCount += group.eventCount;
    if (group.campaignSpend !== null) {
      venueMetaSum += group.campaignSpend;
      venueMetaCount += 1;
    }
    for (const ev of group.events) {
      prereg += ev.prereg_spend ?? 0;
      tickets += resolveDisplayTicketCount({
        ticket_tiers: ev.ticket_tiers,
        latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
        fallback_tickets: ev.tickets_sold ?? null,
        tier_channel_sales_sum: ev.tier_channel_sales_tickets ?? null,
      });
      prevTickets += ev.tickets_sold_previous ?? 0;
      const r = ev.latest_snapshot?.revenue;
      if (r !== null && r !== undefined) {
        hasRevenue = true;
        revenue += r;
      }
    }
  }

  // Ad Spend column = onsale shared campaign only — matches the
  // spreadsheet OVERALL row where "Ad Spend" is the on-sale campaign
  // total (£1,108.89), not the sum of all London meta activity.
  // Total Spend = everything: presale (prereg) + onsale + venue metas,
  // computed separately so the column triangle is: Total ≠ Pre-reg + Ad.
  const venueMetaTotal = venueMetaCount > 0 ? venueMetaSum : null;
  const adSpend = onsaleSpend;
  const total =
    onsaleSpend !== null || venueMetaTotal !== null
      ? prereg + (onsaleSpend ?? 0) + (venueMetaTotal ?? 0)
      : null;
  const cpt = total !== null && total > 0 && tickets > 0 ? total / tickets : null;
  const cptPrevious =
    total !== null && total > 0 && prevTickets > 0
      ? total / prevTickets
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const finalRevenue = hasRevenue ? revenue : null;
  const roas =
    finalRevenue !== null && total !== null && total > 0
      ? finalRevenue / total
      : null;

  return {
    prereg,
    ad: adSpend,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    cptPrevious,
    cptChange,
    revenue: finalRevenue,
    roas,
    venueMetaSum: venueMetaTotal,
    eventCount,
  };
}

/**
 * Roll-up for all London venues. Single-row aggregate that matches the
 * "OVERALL" line in the England London Ticketing spreadsheet — *not* a
 * venue table. Deliberately drops the prev / change / CPT-prev / CPT-
 * change columns: the spreadsheet treats those as per-venue detail
 * only, and showing them here would imply a level of period-on-period
 * accuracy this row doesn't have (campaign-level spend is not
 * snapshotted historically).
 *
 * Numbers come from `computeOverallLondon`, which over-computes a few
 * fields the JSX no longer renders (prevTickets, change, cptPrevious,
 * cptChange). Left in place to avoid touching shared totals plumbing
 * for a presentational change — the unused fields cost nothing.
 */
function OverallLondonSection({
  groups,
  onsaleSpend,
  presaleSpend,
}: OverallLondonSectionProps) {
  const totals = useMemo(
    () => computeOverallLondon(groups, onsaleSpend),
    [groups, onsaleSpend],
  );

  return (
    <section className="rounded-md border-2 border-foreground bg-card shadow-sm">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-border bg-muted px-4 py-3">
        <h2 className="font-heading text-lg tracking-wide text-foreground">
          Overall London
        </h2>
        {/* Header badges intentionally surface the *source* shared-
            campaign totals (presale + on-sale) rather than the derived
            per-event splits — these are the two numbers the client
            keeps in the spreadsheet header, so matching them lets the
            admin reconcile at a glance. Hidden when null so an
            unrefreshed state doesn't render "Pre-reg: —". */}
        {presaleSpend !== null && (
          <p className="text-xs text-muted-foreground">
            Pre-reg:{" "}
            <span className="font-semibold text-foreground">
              {formatGBP(presaleSpend, 2)}
            </span>
          </p>
        )}
        {presaleSpend !== null && onsaleSpend !== null && (
          <span className="text-xs text-muted-foreground/60" aria-hidden="true">
            ·
          </span>
        )}
        {onsaleSpend !== null && (
          <p className="text-xs text-muted-foreground">
            On-sale:{" "}
            <span className="font-semibold text-foreground">
              {formatGBP(onsaleSpend, 2)}
            </span>
          </p>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5 text-right">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets Sold</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-muted text-foreground">
              <td className="px-3 py-2.5 font-semibold">All London</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.ad)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.total)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatNumber(totals.tickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(totals.roas)}`}
              >
                {formatRoas(totals.roas)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface VenueSectionProps {
  token: string;
  /** Forwarded from `ClientPortalVenueTable`; used to build the
   *  "View full venue report" CTA href. */
  clientId: string;
  group: VenueGroup;
  londonOnsaleSpend: number | null;
  /**
   * Spend model for this venue. Computed once by the parent via
   * `venueSpend()` so the model selection lives in one place and the
   * Overall London row + venue rows draw from identical arithmetic.
   */
  spend: GroupSpend;
  /**
   * Event daily rollups across the client. Forwarded so the
   * shared trend chart can aggregate the venue's events without
   * re-fetching.
   */
  dailyRollups: DailyRollupRow[];
  /**
   * Dominant-source snapshots (WoW comparability). Used by the venue
   * table's WoW computation; NOT used for the trend chart ticket line.
   */
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /**
   * Source-stitched snapshots for the trend chart ticket line. Uses
   * per-day priority so events with mixed sources (xlsx_import → fourthefans)
   * produce a continuous trend instead of going dark after the last import.
   */
  trendTicketSnapshots: WeeklyTicketSnapshotRow[];
  /** Per-day tier_channel_sales history rows for the trend chart (migration 089). */
  trendDailyHistory?: TierChannelDailyHistoryRow[];
  /** Client-wide additional spend rows; venue card filters by event ids/code. */
  additionalSpend: AdditionalSpendRow[];
  /**
   * Collapsed-by-default layout surfaces 16+ venue groups in a
   * readable first paint. Header click toggles; state lives on the
   * parent so URL-hash sync lives in one place.
   */
  isExpanded: boolean;
  onToggle: () => void;
  /** Internal admin surface — surfaces per-row actions when true. */
  isInternal: boolean;
  /**
   * Pre-computed week-over-week deltas for the venue's event set.
   * Rendered in the collapsed-state quick stats next to Tickets + CPT.
   * Always provided — an "all null" shape is the "no data yet" state
   * and the header hides the parenthetical.
   */
  wow: VenueWoWTotals;
  onSnapshotSaved: Props["onSnapshotSaved"];
  /**
   * Stable `now` reference from the parent table, shared across all
   * venue sections so recency classification uses the same clock.
   */
  now: Date;
  /**
   * When true, every event in this group is past — the group is
   * rendered in the "Past Events" accordion with muted chrome.
   * Individual events within an active group may still be past
   * (detected per-row via `isPastWithinActive`).
   */
  isPastGroup?: boolean;
  /**
   * When true, every event in this group is cancelled — the group
   * renders in the "Cancelled Events" accordion with red-tinted
   * muted chrome. Overrides `isPastGroup` when set.
   */
  isCancelledGroup?: boolean;
}

function dailyRollupSpend(row: DailyRollupRow): number | null {
  if (row.ad_spend_allocated != null || row.ad_spend_presale != null) {
    return paidSpendOf({
      ad_spend: (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0),
      tiktok_spend: row.tiktok_spend,
    });
  }
  return row.ad_spend != null || row.tiktok_spend != null
    ? paidSpendOf(row)
    : null;
}

interface VenueTrendDateAccumulator {
  allocatedSpend: number | null;
  rawSpend: number | null;
  tickets: number | null;
  revenue: number | null;
  allocatedLinkClicks: number | null;
  rawLinkClicks: number | null;
  hasAllocatedSpend: boolean;
}

function buildVenueTrendPoints(
  dailyRollups: DailyRollupRow[],
  venueEventIds: Set<string>,
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
  trendTicketSnapshots?: WeeklyTicketSnapshotRow[],
  tierChannelAnchors?: TierChannelSalesAnchorRow[],
  dailyHistory?: TierChannelDailyHistoryRow[],
): TrendChartPoint[] {
  const rows = dailyRollups.filter((row) => venueEventIds.has(row.event_id));
  const isMultiEventVenue = venueEventIds.size > 1;

  // Build snapshot points using source-stitched data when available.
  // `trendTicketSnapshots` uses per-day priority resolution so events with
  // mixed sources (xlsx_import → fourthefans hand-off like Manchester WC26)
  // produce a continuous line. Falls back to `weeklyTicketSnapshots` for
  // call-sites that haven't been updated yet.
  //
  // `tierChannelAnchors` (PR fix/venue-trend-tier-channel-snapshot) anchors
  // today's cumulative to the per-event `tier_channel_sales` SUM.
  //
  // `dailyHistory` (migration 089) takes priority over the snapshot envelope
  // for dates it covers, eliminating the "all tickets land on today" spike.
  const snapshotPoints = buildVenueTicketSnapshotPoints(
    trendTicketSnapshots ?? weeklyTicketSnapshots,
    venueEventIds,
    { tierChannelAnchors, dailyHistory },
  );
  const hasSnapshotTickets = snapshotPoints.length > 0;

  // Only use rollup tickets_sold when no snapshot history exists.
  const hasRollupTickets =
    !hasSnapshotTickets && rows.some((row) => row.tickets_sold != null);

  const byDate = new Map<string, VenueTrendDateAccumulator>();
  for (const row of rows) {
    const cur =
      byDate.get(row.date) ??
      ({
        allocatedSpend: null,
        rawSpend: null,
        tickets: null,
        revenue: null,
        allocatedLinkClicks: null,
        rawLinkClicks: null,
        hasAllocatedSpend: false,
      } as VenueTrendDateAccumulator);
    const hasAllocationForRow =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const spend = dailyRollupSpend(row);
    if (hasAllocationForRow) {
      cur.hasAllocatedSpend = true;
      const allocatedSpend =
        (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0);
      cur.allocatedSpend = (cur.allocatedSpend ?? 0) + allocatedSpend;
      if (row.link_clicks != null || row.tiktok_clicks != null) {
        cur.allocatedLinkClicks =
          (cur.allocatedLinkClicks ?? 0) + paidLinkClicksOf(row);
      }
    } else if (!isMultiEventVenue) {
      // Raw rollup spend is safe for single-event venues. For multi-
      // event venues it is duplicated on every child event, so the
      // trend chart intentionally leaves pre-allocation dates blank
      // rather than showing a smoothed but approximate split.
      if (spend != null) cur.rawSpend = (cur.rawSpend ?? 0) + spend;
      if (row.link_clicks != null || row.tiktok_clicks != null) {
        cur.rawLinkClicks = (cur.rawLinkClicks ?? 0) + paidLinkClicksOf(row);
      }
    }
    if (hasRollupTickets && row.tickets_sold != null) {
      cur.tickets = (cur.tickets ?? 0) + row.tickets_sold;
    }
    if (row.revenue != null) {
      cur.revenue = (cur.revenue ?? 0) + row.revenue;
    }
    byDate.set(row.date, cur);
  }

  const points: TrendChartPoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      spend: row.hasAllocatedSpend ? row.allocatedSpend : row.rawSpend,
      // Emit null for tickets when snapshots are present — the snapshotPoints
      // below carry the authoritative cumulative values.
      tickets: hasRollupTickets ? row.tickets : null,
      revenue: row.revenue,
      linkClicks: row.hasAllocatedSpend
        ? row.allocatedLinkClicks
        : row.rawLinkClicks,
    }));

  // Always push snapshot points. The aggregator detects cumulative_snapshot
  // kind and activates the carry-forward path, producing a smooth growing
  // line from the first snapshot date to today. Previously this was gated
  // behind !hasRollupTickets, causing a flat zero line for any venue where
  // meta_regs wrote even one day of rollup tickets_sold.
  points.push(...snapshotPoints);
  return points;
}

function VenueReportLink({
  token,
  clientId,
  isInternal,
  eventCode,
}: {
  token: string;
  clientId: string;
  isInternal: boolean;
  eventCode: string;
}) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isInternal) {
    return (
      <a
        href={`/clients/${clientId}/venues/${encodeURIComponent(eventCode)}`}
        className="inline-flex items-center gap-1 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
      >
        View full venue report
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </a>
    );
  }

  const openShare = async () => {
    if (loading) return;
    setError(null);
    const existingToken = shareToken;
    if (existingToken) {
      window.open(`/share/venue/${encodeURIComponent(existingToken)}`, "_blank", "noopener,noreferrer");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/share/venue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          event_code: eventCode,
          client_token: token,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        token?: string;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.token) {
        throw new Error(json.error ?? "Unable to open venue report");
      }
      setShareToken(json.token);
      window.open(`/share/venue/${encodeURIComponent(json.token)}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open venue report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={openShare}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? "Opening..." : "View full venue report"}
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </span>
  );
}

function VenueSection({
  token,
  clientId,
  group,
  londonOnsaleSpend,
  spend,
  wow,
  dailyRollups,
  weeklyTicketSnapshots,
  trendTicketSnapshots,
  trendDailyHistory,
  additionalSpend,
  isExpanded,
  onToggle,
  isInternal,
  onSnapshotSaved,
  now,
  isPastGroup = false,
  isCancelledGroup = false,
}: VenueSectionProps) {
  const router = useRouter();
  const [editMode, setEditMode] = useState(false);
  const totals = useMemo(() => sumVenue(group, spend), [group, spend]);
  const venueDisplaySpend = useMemo(
    () => displayVenueSpend(group, spend, totals),
    [group, spend, totals],
  );
  const campaignPerformance = useMemo(
    () =>
      aggregateVenueCampaignPerformance(
        group.events,
        additionalSpend,
        dailyRollups,
        undefined,
        venueDisplaySpend,
      ),
    [group.events, additionalSpend, dailyRollups, venueDisplaySpend],
  );
  const venueSuggestedPct =
    campaignPerformance.sellThroughPct === null
      ? null
      : suggestedPct(Math.max(0, Math.min(100, campaignPerformance.sellThroughPct)), {
          isSoldOut:
            campaignPerformance.capacity !== null &&
            campaignPerformance.capacity > 0 &&
            campaignPerformance.ticketsSold >= campaignPerformance.capacity,
        });
  const venueCommsPhrase = suggestedCommsPhrase(
    venueSuggestedPct,
    venueSuggestedPct === "SOLD OUT" ? "sold_out" : "on_sale",
  );
  useEffect(() => {
    if (!isBristolVenueGroup(group)) return;
    console.info("[venue-spend] Bristol diagnostics", {
      eventCode: group.eventCode,
      displayName: group.displayName,
      paidMediaCardSpend: venueDisplaySpend,
      expandedTotalAdSpend: totals.ad,
      events: group.events.map((event) => {
        const rows = dailyRollups.filter((row) => row.event_id === event.id);
        const metrics = computePortalEventSpendRowMetrics(event, spend);
        return {
          eventId: event.id,
          eventName: event.name,
          rollups: rows.map((row) => ({
            date: row.date,
            ad_spend: row.ad_spend,
            tiktok_spend: row.tiktok_spend,
            ad_spend_allocated: row.ad_spend_allocated,
            ad_spend_presale: row.ad_spend_presale,
          })),
          rawPaidSpend: sumPaidSpendNullable(rows),
          rawMetaAdSpend: sumNullable(rows, "ad_spend"),
          adSpendAllocated: sumNullable(rows, "ad_spend_allocated"),
          adSpendPresale: sumNullable(rows, "ad_spend_presale"),
          resolvedPerEventAdSpend: metrics.perEventAd,
        };
      }),
    });
  }, [dailyRollups, group, spend, totals.ad, venueDisplaySpend]);
  const soloEvent = group.eventCount === 1 ? group.events[0] : null;
  const headerLabel =
    group.eventCount > 1 && group.city
      ? `${group.displayName} · ${group.city}`
      : group.displayName;
  const subtitle = soloEvent
    ? [
        soloEvent.venue_name,
        soloEvent.event_date ? formatCompactDate(soloEvent.event_date) : null,
      ]
        .filter(Boolean)
        .join(", ")
    : `${group.eventCount} events`;
  const bodyId = `venue-${group.expandKey}`;
  // Derive rather than store — when the user collapses a card mid-
  // edit, the inline inputs disappear under the header and the Edit
  // toggle hides until they re-open. Keeping edit mode as an
  // internal flag means "still editing when you come back" works
  // without an explicit reset.
  const effectiveEditMode = editMode && isExpanded;
  // Pre-filter the client-wide rollups down to this venue's events.
  // The shared trend chart handles Daily/Weekly bucketing from these
  // points, avoiding a second data source for the venue embed.
  const venueEventIds = useMemo(
    () => new Set(group.events.map((e) => e.id)),
    [group.events],
  );
  const tierChannelAnchors = useMemo<TierChannelSalesAnchorRow[]>(
    () =>
      group.events
        .filter(
          (event) =>
            event.tier_channel_sales_tickets != null ||
            event.tier_channel_sales_revenue != null,
        )
        .map((event) => ({
          event_id: event.id,
          tickets: event.tier_channel_sales_tickets ?? null,
          revenue: event.tier_channel_sales_revenue ?? null,
        })),
    [group.events],
  );
  const venueTrendPoints = useMemo(
    () =>
      buildVenueTrendPoints(
        dailyRollups,
        venueEventIds,
        weeklyTicketSnapshots,
        trendTicketSnapshots,
        tierChannelAnchors,
        trendDailyHistory,
      ),
    [
      dailyRollups,
      venueEventIds,
      weeklyTicketSnapshots,
      trendTicketSnapshots,
      tierChannelAnchors,
      trendDailyHistory,
    ],
  );
  const hasVenueTrend = useMemo(
    () => new Set(venueTrendPoints.map((point) => point.date)).size >= 2,
    [venueTrendPoints],
  );
  const additionalEntryEvents = useMemo(
    () =>
      group.events.map((event) => ({
        id: event.id,
        name: event.name,
        ticketTiers: event.ticket_tiers.map((tier) => tier.tier_name),
      })),
    [group.events],
  );

  // Muted section styling: cancelled gets a subtle red border tint;
  // past groups get reduced opacity; active groups are unstyled.
  const sectionClass = isCancelledGroup
    ? "rounded-md border border-red-200 bg-card shadow-sm opacity-80 dark:border-red-900/40"
    : isPastGroup
    ? "rounded-md border border-border bg-card shadow-sm opacity-75"
    : "rounded-md border border-border bg-card shadow-sm";

  return (
    <section className={sectionClass}>
      <header className="flex min-h-[56px] min-w-0 flex-nowrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center self-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-hidden="true"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <h2 className="min-w-0 truncate font-heading text-lg tracking-wide text-foreground">
            {headerLabel}
          </h2>
          {subtitle && (
            <span
              className={
                group.eventCount > 1
                  ? "rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  : "whitespace-nowrap text-xs text-muted-foreground"
              }
            >
              {subtitle}
            </span>
          )}
          {campaignPerformance.totalMarketingBudget !== null && (
            <p className="hidden flex-shrink-0 text-xs text-muted-foreground md:block">
              Total Mkt:{" "}
              <span className="font-semibold text-foreground">
                {formatGBP(campaignPerformance.totalMarketingBudget)}
              </span>
            </p>
          )}
          {campaignPerformance.totalMarketingBudget !== null &&
            campaignPerformance.paidMediaBudget !== null && (
            <span className="hidden text-xs text-muted-foreground/60 md:inline" aria-hidden="true">
              ·
            </span>
          )}
          {campaignPerformance.paidMediaBudget !== null && (
            <p className="hidden flex-shrink-0 text-xs text-muted-foreground lg:block">
              Paid:{" "}
              <span className="font-semibold text-foreground">
                {formatGBP(campaignPerformance.paidMediaBudget)}
              </span>
              {campaignPerformance.paidMediaUsedPct !== null ? (
                <span className="hidden tabular-nums xl:inline">
                  {" "}
                  ({formatPct(campaignPerformance.paidMediaUsedPct)} used)
                </span>
              ) : null}
            </p>
          )}
          {/* Collapsed-state quick stats — surfaces the headline
              numbers without expanding the card. Only appears when
              the card is closed so the expanded layout doesn't
              duplicate the info. WoW deltas (Tickets + CPT) are
              rendered inline when both windows have data; hidden
              when either side is missing so we never render
              misleading deltas on fresh syncs. */}
          {!isExpanded && (
            <span
              // Stop-propagation wrapper: the outer <button> on the
              // header toggles expand state, so we have to contain
              // any click on the tickets pill or the operator taps
              // the figure and the card collapses out from under
              // the picker / inline input.
              className="ml-auto flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="flex-shrink-0 tabular-nums">
                Tickets:{" "}
                <VenueTicketsClickEdit
                  events={group.events}
                  totalTickets={totals.tickets}
                  token={token}
                  isInternal={isInternal}
                  onSnapshotSaved={onSnapshotSaved}
                  displayValue={formatNumber(totals.tickets)}
                />
                <span className="hidden xl:inline">
                  <WoWDeltaInline
                    delta={wow.tickets}
                    formatAbs={(v) => formatSignedNumber(v)}
                    // Tickets moving up is good news; colour that green.
                    positiveIsGood
                  />
                </span>
                {campaignPerformance.capacity !== null ? (
                  <span className="hidden text-muted-foreground xl:inline">
                    {" "}
                    ({formatNumber(campaignPerformance.ticketsSold)}/
                    {formatNumber(campaignPerformance.capacity)},{" "}
                    {formatPct(campaignPerformance.sellThroughPct, 1)})
                  </span>
                ) : null}
              </span>
              <span className="flex-shrink-0 text-muted-foreground/60" aria-hidden="true">·</span>
              <span className="flex-shrink-0 tabular-nums">
                CPT:{" "}
                <span className="font-semibold text-foreground">
                  {formatGBP(campaignPerformance.costPerTicket, 2)}
                </span>
                <span className="hidden xl:inline">
                  <WoWDeltaInline
                    delta={wow.cpt}
                    formatAbs={(v) => formatSignedGBP(v, 2)}
                    // CPT moving down (cheaper) is good news; invert
                    // the colour so negative-delta reads green.
                    positiveIsGood={false}
                  />
                </span>
              </span>
              <span className="flex-shrink-0 text-muted-foreground/60" aria-hidden="true">·</span>
              <span className="flex-shrink-0 tabular-nums">
                Pacing:{" "}
                <span className="font-semibold text-foreground">
                  {campaignPerformance.pacingTicketsPerDay !== null
                    ? `${formatNumber(campaignPerformance.pacingTicketsPerDay)}/day`
                    : "—"}
                </span>
              </span>
              <span className="hidden flex-shrink-0 text-muted-foreground/60 2xl:inline" aria-hidden="true">·</span>
              <span
                className={`hidden flex-shrink-0 tabular-nums 2xl:inline ${roasClass(totals.roas)}`}
              >
                ROAS: {formatRoas(totals.roas)}
                <WoWDeltaInline
                  delta={wow.roas}
                  formatAbs={(v) => formatSignedRoas(v)}
                  positiveIsGood
                />
              </span>
            </span>
          )}
        </button>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 text-xs">
          <span className="rounded-full border border-border bg-background px-2 py-1 text-muted-foreground">
            Suggested: {formatSuggestedPct(venueSuggestedPct)}
          </span>
          <CommsChip phrase={venueCommsPhrase} />
        </div>
        {/* Inline edit only makes sense on the public share surface
            where the NumericCell POST hits `/api/share/client/[token]/tickets`
            with a real token. Internal admin route skips the Edit
            control; admins jump into the per-event page to edit
            numbers (linked in the admin row below the tracker). */}
        {isExpanded && !isInternal && (
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              editMode
                ? "bg-foreground text-background hover:bg-foreground/90"
                : "border border-border-strong text-foreground hover:bg-muted"
            }`}
            aria-pressed={editMode}
          >
            {editMode ? (
              "Done"
            ) : (
              <>
                <Pencil className="h-3 w-3" />
                Edit
              </>
            )}
          </button>
        )}
        {/* Per-venue Sync Now — internal surface only. External
            share tokens are event-scoped so there's no single token
            that can fan out to a venue's children; the POST this
            button fires requires a signed-in session. Visible in
            both collapsed + expanded states so the operator can
            trigger a sweep without first expanding every card. */}
        {isInternal && (
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <VenueSyncButton eventIds={group.events.map((e) => e.id)} />
            <VenueTicketingStatusBadge events={group.events} clientId={clientId} />
          </div>
        )}
        {/* "View full venue report" CTA. Hidden for solo venues without
            an event_code and while collapsed (no visual room next to
            the collapsed-state quick stats). */}
        {isExpanded && group.eventCode && (
          <VenueReportLink
            token={token}
            clientId={clientId}
            isInternal={isInternal}
            eventCode={group.eventCode}
          />
        )}
      </header>

      {/* PR D2 footnote — shown only when the venue's spend is driven
          by the per-event allocator AND the venue has > 1 event
          (single-event cards have nothing to average). Reads the
          three derived numbers directly off the discriminated union
          so the arithmetic lives in one place (`venueSpend`). */}
      {isExpanded &&
        spend.kind === "allocated" &&
        spend.eventCount > 1 && (
          <p
            className="border-b border-border px-4 py-2 text-[11px] italic text-muted-foreground"
            aria-live="polite"
          >
            Spend split:{" "}
            <span className="font-medium text-foreground">
              {formatGBP(spend.venueSpecific)}
            </span>{" "}
            game-specific +{" "}
            <span className="font-medium text-foreground">
              {formatGBP(spend.venueGenericPool)}
            </span>{" "}
            averaged generic
            {spend.venuePresale > 0 ? (
              <>
                {" "}+{" "}
                <span className="font-medium text-foreground">
                  {formatGBP(spend.venuePresale)}
                </span>{" "}
                presale paid media
              </>
            ) : null}{" "}
            across {spend.eventCount} games
          </p>
        )}

      {isExpanded && (
        <VenueCampaignPerformanceCards
          performance={campaignPerformance}
          clientId={clientId}
          eventCode={group.eventCode}
          shareToken={isInternal ? "" : token}
        />
      )}

      {isExpanded && hasVenueTrend && (
        <div className="border-b border-border px-4 py-4">
          <EventTrendChart
            points={venueTrendPoints}
            title="Venue trend"
            className="border-border"
          />
        </div>
      )}
      {isExpanded && isInternal ? (
        <div className="border-b border-border px-4 py-4">
          <VenueAdditionalEntriesPanel
            clientId={clientId}
            eventCode={group.eventCode}
            events={additionalEntryEvents}
            onAfterMutate={() => router.refresh()}
          />
        </div>
      ) : null}
      {isExpanded ? (
        <div id={bodyId} className="border-b border-border px-4 py-4">
          <VenueEventBreakdown
            events={group.events}
            dailyRollups={dailyRollups}
            londonOnsaleSpend={londonOnsaleSpend}
            additionalSpend={additionalSpend}
            channelEditApiBase={
              !isInternal && token ? `/api/share/venue/${encodeURIComponent(token)}` : undefined
            }
            canEditChannels={!isInternal && !!token}
            isInternalDashboard={isInternal}
            clientId={clientId}
            onAfterChannelMutate={() => router.refresh()}
          />
        </div>
      ) : null}
      {isExpanded && !isInternal ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5">Last updated</th>
              <th className="px-3 py-2.5 text-right">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets Sold</th>
              <th className="px-3 py-2.5 text-right">Tickets Prev</th>
              <th className="px-3 py-2.5 text-right">Tickets Change</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">CPT Prev</th>
              <th className="px-3 py-2.5 text-right">CPT Change</th>
              <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {group.events.map((ev, i) => (
              <Fragment key={ev.id}>
                <EventRow
                  token={token}
                  event={ev}
                  striped={i % 2 === 1}
                  editMode={effectiveEditMode}
                  spend={spend}
                  onSnapshotSaved={onSnapshotSaved}
                  isPastWithinActive={!isPastGroup && !isCancelledGroup && isPastEvent(ev.event_date, now)}
                  isCancelledWithinActive={!isCancelledGroup && isCancelledEvent(ev)}
                />
                {ev.ticket_tiers.length > 0 && (
                  <tr className="border-t border-border bg-background">
                    <td colSpan={COL_COUNT} className="px-3 py-3">
                      <TicketTiersSection
                        tiers={ev.ticket_tiers}
                        title={`${ev.name} ticket tiers`}
                        compact
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="border-t border-border-strong bg-muted text-foreground">
              <td className="px-3 py-2.5 font-semibold">Total</td>
              <td className="px-3 py-2.5">
                <VenueTicketingStatusBadge events={group.events} clientId={clientId} />
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.ad)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.total)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatNumber(totals.tickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-muted-foreground">
                {formatNumber(totals.prevTickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatChange(totals.change)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cptPrevious, 2)}
              </td>
              <td
                className={`px-3 py-2.5 text-right font-semibold tabular-nums ${cptChangeClass(totals.cptChange)}`}
              >
                {formatCptChange(totals.cptChange)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(totals.roas)}`}
              >
                {formatRoas(totals.roas)}
              </td>
            </tr>
          </tbody>
          </table>
          {/* Defensive: keep the column count in sync with the header so a
            future edit doesn't silently desync the grid. */}
          <span aria-hidden="true" className="sr-only" data-col-count={COL_COUNT} />
        </div>
      ) : null}
      {/* The old daily tracker table is intentionally not rendered here:
          the shared trend chart above covers daily and ISO-week views. */}
      {/* Active creatives strip — lazy-fetched the first time the card
          is opened. Suppressed when the venue has no event_code to
          join Meta's `[event_code]` bracket pattern against (nothing
          to query for). Internal admin users see the same strip; the
          downstream API guards access via the share resolver, so
          there's no ACL divergence. */}
      {isExpanded && group.eventCode && (
        <VenueActiveCreatives
          token={token}
          clientId={clientId}
          isInternal={isInternal}
          eventCode={group.eventCode}
          venueLabel={headerLabel}
        />
      )}
      {/* Internal admin surface — the per-row Edit links are only
          rendered when rendered inside `/clients/[id]/dashboard`.
          Keeps the external `/share/client/[token]` surface clean
          and read-only. */}
      {isExpanded && isInternal && (
        <div className="border-t border-border bg-muted px-4 py-2 text-xs">
          <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-muted-foreground">
            <span>Admin:</span>
            {group.events.map((ev, i) => (
              <span key={ev.id} className="inline-flex items-center gap-1">
                {i > 0 && (
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground/60"
                  >
                    ·
                  </span>
                )}
                <a
                  href={`/events/${ev.id}?tab=reporting`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline hover:text-foreground"
                >
                  {ev.name}
                </a>
                {/* Per-event compact sync button — sits immediately
                    after the event name so operators can scope a
                    single sync without fanning across the venue.
                    Reuses the same fan-out component with a
                    size-one event array (keeps success semantics +
                    error extraction consistent with the venue and
                    client-wide variants). */}
                <VenueSyncButton
                  eventIds={[ev.id]}
                  size="compact"
                  ariaLabel={`Sync ${ev.name}`}
                />
              </span>
            ))}
          </p>
        </div>
      )}
    </section>
  );
}

function VenueAdditionalEntriesPanel({
  clientId,
  eventCode,
  events,
  onAfterMutate,
}: {
  clientId: string;
  eventCode: string | null;
  events: Array<{ id: string; name: string; ticketTiers: string[] }>;
  onAfterMutate: () => void;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Additional entries
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Add PR spend, partner allocations, comps, and offline sales to the
          correct event row in this venue.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <VenueAdditionalSpendCard
          events={events}
          venueScope={
            eventCode === null ? undefined : { clientId, eventCode }
          }
          className="rounded-md border border-border bg-background p-3"
          onAfterMutate={onAfterMutate}
        />
        <AdditionalTicketEntriesCard
          events={events}
          className="rounded-md border border-border bg-background p-3"
          onAfterMutate={onAfterMutate}
        />
      </div>
    </section>
  );
}

function VenueCampaignPerformanceCards({
  performance,
  clientId,
  eventCode,
  shareToken,
}: {
  performance: VenueCampaignPerformance;
  clientId: string;
  eventCode: string | null;
  shareToken: string;
}) {
  return (
    <section className="border-b border-border bg-background/60 px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Campaign performance
        </h3>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total marketing
          </p>
          <div className="mt-3 space-y-2 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.totalMarketingBudget !== null ? (
                <>
                  {formatGBP(performance.totalMarketingBudget)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    allocated
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            {performance.totalMarketingBudget !== null ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatGBP(performance.paidMediaBudget)} Paid media +{" "}
                {formatGBP(performance.additionalSpend)} Additional
              </p>
            ) : null}
            {performance.paidMediaSpent > 0 ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                Total spend to date: {formatGBP(performance.paidMediaSpent)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Paid media
          </p>
          <div className="mt-3 space-y-2 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.paidMediaBudget !== null ? (
                <>
                  {formatGBP(performance.paidMediaBudget)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    allocated
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.paidMediaSpent > 0 ||
              performance.paidMediaBudget !== null ? (
                <>
                  {formatGBP(performance.paidMediaSpent)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    spent
                  </span>
                  {performance.paidMediaRemaining !== null ? (
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      ({formatGBP(performance.paidMediaRemaining)} remaining)
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.paidMediaUsedPct !== null ? (
                <>{formatPct(performance.paidMediaUsedPct)} used</>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-muted-foreground">
              <LazyVenueDailyBudget
                clientId={clientId}
                eventCode={eventCode}
                shareToken={shareToken}
              />
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tickets
          </p>
          <div className="mt-3 space-y-2 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.capacity !== null ? (
                <>
                  {formatNumber(performance.ticketsSold)} /{" "}
                  {formatNumber(performance.capacity)} sold
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    ({formatPct(performance.sellThroughPct, 1)})
                  </span>
                </>
              ) : (
                <>{formatNumber(performance.ticketsSold)} sold</>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {performance.costPerTicket !== null ? (
                <>
                  {formatGBP(performance.costPerTicket, 2)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    cost per ticket
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Pacing:</span>{" "}
              {performance.pacingTicketsPerDay !== null ? (
                <>
                  {formatNumber(performance.pacingTicketsPerDay)} tickets/day
                  {performance.pacingSpendPerDay !== null ? (
                    <> · {formatGBP(performance.pacingSpendPerDay)}/day to sell out</>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function LazyVenueDailyBudget({
  clientId,
  eventCode,
  shareToken,
}: {
  clientId: string;
  eventCode: string | null;
  shareToken: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | {
        kind: "ready";
        dailyBudget: number | null;
        label: "daily" | "effective_daily";
        reason: string | null;
      }
    | { kind: "error"; reason: string | null }
  >(() => {
    if (!eventCode) return { kind: "loading" };
    const cached = getDailyBudgetUpdate(clientId, eventCode);
    if (!cached) return { kind: "loading" };
    return {
      kind: "ready",
      dailyBudget: cached.dailyBudget,
      label: cached.label,
      reason: cached.reasonLabel,
    };
  });
  const hydratedFromBroadcastRef = useRef(
    eventCode ? getDailyBudgetUpdate(clientId, eventCode) !== null : false,
  );

  useEffect(() => {
    if (!eventCode) return;
    const cached = getDailyBudgetUpdate(clientId, eventCode);
    if (cached) {
      hydratedFromBroadcastRef.current = true;
      setState({
        kind: "ready",
        dailyBudget: cached.dailyBudget,
        label: cached.label,
        reason: cached.reasonLabel,
      });
    } else {
      hydratedFromBroadcastRef.current = false;
    }
    const onBudgetUpdated = (event: Event) => {
      const custom = event as CustomEvent<DailyBudgetUpdateDetail>;
      const detail = custom.detail;
      if (detail.clientId !== clientId || detail.eventCode !== eventCode) return;
      console.log("[venue-daily-budget] broadcast received", {
        eventCode: detail.eventCode,
        dailyBudget: detail.dailyBudget,
        reason: detail.reason,
        settingCardState: true,
      });
      hydratedFromBroadcastRef.current = true;
      setState({
        kind: "ready",
        dailyBudget: detail.dailyBudget,
        label: detail.label,
        reason: detail.reasonLabel,
      });
    };
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudgetUpdated);
    return () => {
      window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudgetUpdated);
    };
  }, [clientId, eventCode]);

  useEffect(() => {
    if (!eventCode) {
      setState({
        kind: "ready",
        dailyBudget: null,
        label: "daily",
        reason: "No event code",
      });
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (hydratedFromBroadcastRef.current) return;
      setState({ kind: "loading" });
      try {
        const qs = new URLSearchParams();
        if (shareToken) qs.set("client_token", shareToken);
        const res = await fetch(
          `/api/clients/${encodeURIComponent(clientId)}/venues/${encodeURIComponent(eventCode)}/daily-budget${
            qs.size > 0 ? `?${qs.toString()}` : ""
          }`,
        );
        const json = (await res.json()) as {
          dailyBudget?: number | null;
          label?: "daily" | "effective_daily";
          reasonLabel?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error("Daily budget unavailable");
        if (!cancelled) {
          setState({
            kind: "ready",
            dailyBudget: json.dailyBudget ?? null,
            label: json.label ?? "daily",
            reason: json.reasonLabel ?? json.error ?? null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            reason:
              err instanceof Error ? err.message : "Daily budget unavailable",
          });
        }
      }
    };
    const timer = window.setTimeout(() => {
      void load();
    }, dailyBudgetFetchDelayMs(eventCode));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientId, eventCode, shareToken]);

  if (state.kind === "loading") {
    return (
      <>
        <span>Daily budget:</span>
        <span className="font-heading text-xl tracking-wide text-muted-foreground tabular-nums">
          ...
        </span>
      </>
    );
  }
  if (state.kind === "error") {
    return (
      <>
        <span>Daily budget:</span>
        <span
          className="font-heading text-xl tracking-wide text-muted-foreground tabular-nums"
          title={state.reason ?? "Daily budget unavailable"}
        >
          —
        </span>
      </>
    );
  }
  const label =
    state.label === "effective_daily" ? "Effective daily:" : "Daily budget:";
  return (
    <>
      <span>{label}</span>
      <span
        className={`font-heading text-xl tracking-wide tabular-nums ${
          state.dailyBudget == null ? "text-muted-foreground" : "text-foreground"
        }`}
        title={state.dailyBudget == null ? (state.reason ?? undefined) : undefined}
      >
        {formatGBP(state.dailyBudget)}
      </span>
    </>
  );
}

function dailyBudgetFetchDelayMs(eventCode: string): number {
  let hash = 0;
  for (const ch of eventCode) hash = (hash * 31 + ch.charCodeAt(0)) % 8000;
  return hash;
}

interface EventRowProps {
  token: string;
  event: PortalEvent;
  striped: boolean;
  editMode: boolean;
  spend: GroupSpend;
  onSnapshotSaved: Props["onSnapshotSaved"];
  /**
   * True when the event has passed but its parent venue group is still
   * active (i.e. at least one sibling fixture is upcoming). Applies
   * muted / struck-through styling to signal "this one is done" without
   * removing the row — operators need the data for post-event analysis.
   */
  isPastWithinActive?: boolean;
  /**
   * True when this individual event is cancelled but its parent group
   * is still active (some sibling event in the group is not cancelled).
   * Renders with red-tinted muted styling + "CANCELLED" badge.
   */
  isCancelledWithinActive?: boolean;
}

function EventRow({
  token,
  event,
  striped,
  editMode,
  spend,
  onSnapshotSaved,
  isPastWithinActive = false,
  isCancelledWithinActive = false,
}: EventRowProps) {
  const m = computePortalEventSpendRowMetrics(event, spend);
  const rowBg = striped ? "bg-muted" : "bg-card";

  // PR D2 breakdown for the Ad Spend tooltip. Only non-null when
  // this row is driven by the allocator — otherwise the tooltip is
  // skipped and the cell renders plain as before.
  const allocationRow =
    spend.kind === "allocated"
      ? spend.byEventId.get(event.id) ?? null
      : null;
  const adSpendTitle = allocationRow
    ? `Includes ${formatGBP(allocationRow.specific)} specific to this game + ${formatGBP(allocationRow.genericShare)} share of venue-generic spend${
        allocationRow.presale > 0
          ? ` + ${formatGBP(allocationRow.presale)} presale paid media`
          : ""
      }`
    : undefined;

  const rowOpacity = isCancelledWithinActive
    ? " opacity-60"
    : isPastWithinActive
    ? " opacity-60"
    : "";
  const nameClass = isCancelledWithinActive
    ? "block font-medium text-red-600/70 line-through decoration-red-400/50 dark:text-red-400/60"
    : isPastWithinActive
    ? "block font-medium text-muted-foreground line-through decoration-muted-foreground/50"
    : "block font-medium text-foreground";

  return (
    <tr className={`border-t border-border ${rowBg} hover:bg-muted/50${rowOpacity}`}>
      <td className="px-3 py-2.5 align-top">
        <span className={nameClass}>
          {event.name}
        </span>
        {isCancelledWithinActive && (
          <span className="mt-0.5 inline-flex items-center rounded-sm bg-red-100 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Cancelled
          </span>
        )}
        {!isCancelledWithinActive && isPastWithinActive && (
          <span className="mt-0.5 inline-flex items-center rounded-sm bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Past
          </span>
        )}
        {event.event_code && (
          <span className="block text-[11px] text-muted-foreground">
            {event.event_code}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top">
        <EventTicketingStatusBadge event={event} clientId={undefined} />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatGBP(m.prereg)}
      </td>
      <td
        className="px-3 py-2.5 text-right tabular-nums text-foreground"
        title={adSpendTitle}
      >
        {formatGBP(m.perEventAd)}
        {allocationRow && (
          // Subtle dotted underline nudges users to hover the cell
          // for the breakdown. Screen-reader text mirrors the title
          // attribute so the info is still reachable non-visually.
          <span className="sr-only"> {adSpendTitle}</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
        {formatGBP(m.perEventTotal)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          // Remount when the saved value changes (snapshot upserts) so
          // the uncontrolled input picks up the new defaultValue.
          key={`tickets:${m.tickets}`}
          token={token}
          event={event}
          field="tickets_sold"
          editMode={editMode}
          currentValue={m.tickets}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
        {event.tickets_sold_previous === null
          ? "—"
          : formatNumber(m.prevTickets)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {event.tickets_sold_previous === null ? "—" : formatChange(m.change)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatGBP(m.cpt, 2)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
        {formatGBP(m.cptPrevious, 2)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums ${cptChangeClass(m.cptChange)}`}
      >
        {formatCptChange(m.cptChange)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          key={`revenue:${m.revenue ?? "null"}`}
          token={token}
          event={event}
          field="revenue"
          editMode={editMode}
          currentValue={m.revenue}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}>
        {formatRoas(m.roas)}
      </td>
    </tr>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

interface NumericCellProps {
  token: string;
  event: PortalEvent;
  field: "tickets_sold" | "revenue";
  editMode: boolean;
  /** Current rendered value — null means "not set yet" (display "—"). */
  currentValue: number | null;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

/**
 * Editable numeric cell shared between Tickets Sold and Revenue.
 *
 * In view mode: renders the formatted value (or "—" when null) and a
 * subtle ✓ badge after a successful save.
 * In edit mode: renders an inline number input that persists on blur
 * (or Enter). Esc cancels and reverts to the last saved value.
 *
 * Both fields hit the same /api/share/client/[token]/tickets endpoint —
 * the API persists tickets_sold + revenue in one snapshot row, so we
 * always send the *other* field's current value through unchanged to
 * avoid accidentally clobbering it back to null.
 */
function NumericCell({
  token,
  event,
  field,
  editMode,
  currentValue,
  onSnapshotSaved,
}: NumericCellProps) {
  // The input is uncontrolled — `defaultValue` reflects the prop and the
  // ref reads the current text on blur. This sidesteps the "stale draft
  // after a sibling save" trap controlled inputs hit, and the
  // `key={currentValue}` on the parent <td> remounts the input when the
  // server-side value changes via a different field's save.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const isCurrency = field === "revenue";
  const breakdownTitle =
    field === "tickets_sold" && event.additional_tickets_sold > 0
      ? `${formatNumber(event.api_tickets_sold ?? 0)} via API + ${formatNumber(event.additional_tickets_sold)} additional = ${formatNumber(currentValue ?? 0)} total`
      : field === "revenue" && event.additional_ticket_revenue > 0
        ? `Includes ${formatGBP(event.additional_ticket_revenue, 2)} additional ticket revenue`
        : undefined;

  const submit = async () => {
    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim();
    // Empty input on a never-set value is a no-op; clearing a previously
    // saved value writes through as null (only relevant for revenue —
    // tickets_sold goes through the integer guard below).
    if (trimmed === "") {
      if (currentValue === null) return;
      // Tickets are required by the API; refuse to clear.
      if (field === "tickets_sold") {
        setSave({ kind: "error", message: "Required" });
        return;
      }
    }

    let parsedTickets: number;
    let parsedRevenue: number | null;

    if (field === "tickets_sold") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        setSave({ kind: "error", message: "Whole numbers only" });
        return;
      }
      parsedTickets = n;
      parsedRevenue = event.latest_snapshot?.revenue ?? null;
    } else {
      // Revenue may have been left blank to clear; otherwise validate.
      if (trimmed === "") {
        parsedRevenue = null;
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) {
          setSave({ kind: "error", message: "Numbers ≥ 0 only" });
          return;
        }
        parsedRevenue = n;
      }
      parsedTickets =
        event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
    }

    // No-op if nothing actually changed — avoids hammering the API
    // every time a user tabs through the table.
    const ticketsUnchanged =
      field === "tickets_sold" &&
      parsedTickets ===
        (event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0);
    const revenueUnchanged =
      field === "revenue" &&
      parsedRevenue === (event.latest_snapshot?.revenue ?? null);
    if (ticketsUnchanged || revenueUnchanged) {
      return;
    }

    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tickets_sold: parsedTickets,
          revenue: parsedRevenue,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          revenue: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved(event.id, {
        tickets_sold: parsedTickets,
        revenue: parsedRevenue,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSave({ kind: "error", message });
    }
  };

  if (editMode) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        {isCurrency && (
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            £
          </span>
        )}
        <input
          ref={inputRef}
          type="number"
          inputMode={isCurrency ? "decimal" : "numeric"}
          min={0}
          step={isCurrency ? "0.01" : 1}
          defaultValue={currentValue === null ? "" : String(currentValue)}
          onBlur={() => {
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              if (inputRef.current) {
                inputRef.current.value =
                  currentValue === null ? "" : String(currentValue);
              }
              setSave({ kind: "idle" });
              e.currentTarget.blur();
            }
          }}
          disabled={save.kind === "saving"}
          aria-label={
            field === "tickets_sold"
              ? `Tickets sold for ${event.name}`
              : `Revenue for ${event.name}`
          }
          className={`h-7 ${isCurrency ? "w-24" : "w-20"} rounded border border-border-strong bg-card px-2 text-right text-sm tabular-nums text-foreground focus:border-foreground focus:outline-none focus:ring-1 focus:ring-foreground disabled:bg-muted`}
        />
        {save.kind === "saving" && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {save.kind === "saved" && (
          <span className="text-[11px] font-medium text-emerald-600">✓</span>
        )}
        {save.kind === "error" && (
          <span className="ml-1 text-[11px] text-red-600">{save.message}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center justify-end gap-1.5 tabular-nums text-foreground"
      title={breakdownTitle}
    >
      <span className="font-medium">
        {currentValue === null
          ? "—"
          : isCurrency
            ? formatGBP(currentValue, 2)
            : formatNumber(currentValue)}
      </span>
      {save.kind === "saved" && (
        <span className="text-[11px] font-medium text-emerald-600">✓</span>
      )}
    </div>
  );
}
