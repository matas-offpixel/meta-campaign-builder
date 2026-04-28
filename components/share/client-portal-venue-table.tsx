"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil } from "lucide-react";

import type {
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import {
  aggregateAllocationByEvent,
  aggregateVenueWoW,
  sortEventsGroupStageFirst,
  type EventAllocationLifetime,
  type VenueWoWTotals,
} from "@/lib/db/client-dashboard-aggregations";
import {
  parseExpandedHash,
  serializeExpandedHash,
} from "@/lib/dashboard/rollout-grouping";

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
};
import { DailyTracker } from "./daily-tracker";
import { VenueActiveCreatives } from "./venue-active-creatives";
import { VenueHistorySection } from "./venue-history-section";
import { VenueSyncButton } from "./venue-sync-button";
import { VenueTicketsClickEdit } from "./venue-tickets-click-edit";

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
   * All daily tracker rows for the client. Filtered down to the
   * venue's events inside each VenueSection's <DailyTracker />.
   */
  dailyEntries: DailyEntry[];
  /**
   * Event daily rollups across the client. Only used by this
   * component to score "activity" per venue group — picking which
   * cards to auto-expand on first mount. Not used in the existing
   * per-event arithmetic, which stays on meta_spend_cached.
   */
  dailyRollups: DailyRollupRow[];
  /**
   * Weekly ticket snapshots across every event under the client.
   * Pre-collapsed on the server (manual > xlsx_import > eventbrite)
   * to one row per (event, week). The venue-expansion history
   * section filters them down to the card's event set at render
   * time. Empty when no snapshots exist yet — the section hides
   * itself in that case rather than rendering a blank chart.
   */
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /** Exposes admin-only controls per row when true. */
  isInternal: boolean;
  onSnapshotSaved: (eventId: string, snapshot: SavedSnapshot) => void;
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

/**
 * Number of London venues sharing the WC26-LONDON-ONSALE campaign.
 * Hard-coded because the divisor is a contractual fact about how the
 * shared spend is allocated, not a count derived from venue rows
 * present in any given snapshot — using `londonGroups.length` would
 * silently rebalance if a venue went missing from the dataset.
 */
const LONDON_VENUE_COUNT = 4;

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
  if (delta.delta == null) return null;
  // A zero delta is legitimate data (nothing changed) but rendering
  // "(+0, 0%)" is noise — swallow the parenthetical instead so the
  // header stays clean on flat weeks.
  if (delta.delta === 0) return null;
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
   * Stable identifier suitable for the URL hash. Events sharing an
   * event_code + event_date collapse to their event_code; solo
   * events (no event_code or only one row for the key) fall back to
   * the event id so every group has a deterministic anchor.
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

/**
 * Group events by shared `(event_code, event_date)` — the same
 * grouping rule PR #115's rollout audit uses. Events without a
 * shared code (or with `event_code = null`) each become their own
 * standalone group so the user's "render as today" expectation
 * holds for single-event venues.
 *
 * Preserves input order: the SSR loader already sorts by event_date,
 * so rendering stays predictable across refreshes without an extra
 * `localeCompare` sort (which previously reordered by venue name
 * and masked the "most recent match" signal operators care about).
 */
function groupByEventCodeAndDate(events: PortalEvent[]): VenueGroup[] {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (!ev.event_code) continue;
    const key = `${ev.event_code}::${ev.event_date ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groupsByKey = new Map<string, VenueGroup>();
  const out: VenueGroup[] = [];
  const sortedGroups = new Set<VenueGroup>();

  for (const ev of events) {
    const codedKey = ev.event_code
      ? `${ev.event_code}::${ev.event_date ?? ""}`
      : null;
    const shouldGroup = codedKey !== null && (counts.get(codedKey) ?? 0) >= 2;

    if (shouldGroup) {
      const existing = groupsByKey.get(codedKey!);
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
        key: codedKey!,
        // event_code is a stable, user-visible handle the operator
        // recognises in the URL hash — beats a UUID every time.
        expandKey: ev.event_code as string,
        eventCode: ev.event_code,
        displayName: ev.venue_name ?? (ev.event_code as string),
        city: ev.venue_city,
        budget: ev.budget_marketing,
        campaignSpend: ev.meta_spend_cached,
        eventCount: 1,
        events: [ev],
      };
      groupsByKey.set(codedKey!, group);
      out.push(group);
      continue;
    }

    // Solo group — each event stands alone. Key off the event id so
    // the URL hash is still stable across refreshes; display name
    // falls back to the venue to keep the visual layout familiar
    // for clients used to the "per-venue" layout.
    const soloKey = `solo::${ev.id}`;
    out.push({
      key: soloKey,
      expandKey: ev.id,
      // Solo groups still carry a real event_code when the event has
      // one — lets single-event venues render active creatives via
      // the same `[event_code]` bracket join as grouped ones. Falls
      // through as null when the event legitimately has no code.
      eventCode: ev.event_code,
      displayName: ev.venue_name ?? ev.name,
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

/**
 * Per-venue spend model. Three variants picked in priority order:
 *
 *   - `allocated` (PR D2) — every event in the group has a non-null
 *     `ad_spend_allocated` sum in `event_daily_rollups`. Each event
 *     carries its own attributed spend (specific + venue-generic
 *     share) rather than taking an equal 1/N slice of the campaign
 *     total. When this kind fires, the UI also shows the venue
 *     header footnote + per-row tooltip with the specific / generic
 *     breakdown.
 *   - `split` (legacy, non-London, pre-allocation) — the campaign
 *     total is one number baked into `meta_spend_cached`; prereg is
 *     carved out of the per-event slice.
 *   - `add` (WC26 London) — prereg and on-sale spend live in
 *     different Meta campaigns and are *added* to produce the per-
 *     event total.
 *
 * When a group straddles the rollout (some events allocated,
 * others not) we hold the line on the old model — mixing the two
 * kinds would produce a Total row that double-counts the venue
 * generic pool for unallocated events.
 */
type GroupSpend =
  | {
      kind: "allocated";
      /** Per-event lifetime allocation, keyed by event id. The
       *  map is guaranteed to have one entry per event in the
       *  group when this variant is returned. */
      byEventId: Map<string, EventAllocationLifetime>;
      /** Sum across all events of `specific` — the
       *  game-specific slice of the venue's total ad spend. */
      venueSpecific: number;
      /** Sum across all events of `genericShare` — equals the
       *  venue-wide generic pool the allocator split evenly. */
      venueGenericPool: number;
      /** `venueSpecific + venueGenericPool` — the raw venue
       *  total the operator sees in Ads Manager. */
      venueTotal: number;
      /** `venueGenericPool / eventCount` — matches
       *  `byEventId.get(*).genericShare` within rounding. */
      genericSharePerEvent: number;
      /** Number of events covered by this allocation. */
      eventCount: number;
    }
  | { kind: "split"; perEventTotal: number | null }
  | { kind: "add"; perEventAd: number | null };

function venueSpend(
  group: VenueGroup,
  londonOnsaleSpend: number | null,
  allocationByEvent: Map<string, EventAllocationLifetime>,
): GroupSpend {
  // Prefer the allocation model when every event in the group has
  // allocation data. We fall through to split/add when the
  // allocator hasn't populated every event yet (half-rollout,
  // post-migration catch-up, …) so the Total row stays consistent.
  if (
    group.events.length > 0 &&
    group.events.every((ev) => allocationByEvent.has(ev.id))
  ) {
    const byEventId = new Map<string, EventAllocationLifetime>();
    let venueSpecific = 0;
    let venueGenericPool = 0;
    for (const ev of group.events) {
      const alloc = allocationByEvent.get(ev.id)!;
      byEventId.set(ev.id, alloc);
      venueSpecific += alloc.specific;
      venueGenericPool += alloc.genericShare;
    }
    const venueTotal = venueSpecific + venueGenericPool;
    const eventCount = group.events.length;
    const genericSharePerEvent =
      eventCount > 0 ? venueGenericPool / eventCount : 0;
    return {
      kind: "allocated",
      byEventId,
      venueSpecific,
      venueGenericPool,
      venueTotal,
      genericSharePerEvent,
      eventCount,
    };
  }

  if (isLondonCity(group.city) && londonOnsaleSpend !== null) {
    // London additive model. Either input may be null in transitional
    // states (e.g. admin has refreshed onsale but not yet the venue
    // campaign). Treat null as 0 for the sum so a half-populated state
    // still surfaces whichever half is known. Returns null only when
    // the venue truly has no spend signal *and* no event count to
    // divide by.
    const onsaleShare = londonOnsaleSpend / LONDON_VENUE_COUNT;
    const venueMeta = group.campaignSpend ?? 0;
    const perEventAd =
      group.eventCount > 0 ? (onsaleShare + venueMeta) / group.eventCount : null;
    return { kind: "add", perEventAd };
  }
  const perEventTotal =
    group.campaignSpend !== null && group.eventCount > 0
      ? group.campaignSpend / group.eventCount
      : null;
  return { kind: "split", perEventTotal };
}

interface EventMetrics {
  prereg: number | null;
  perEventTotal: number | null;
  perEventAd: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  /** perEventTotal / prevTickets — null when prevTickets is 0 or spend is null. */
  cptPrevious: number | null;
  /** cpt − cptPrevious — null when either side is null. */
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
}

function computeEventMetrics(
  ev: PortalEvent,
  spend: GroupSpend,
): EventMetrics {
  // Prereg source-of-truth precedence (PR #120 fix):
  //   1. Allocator-written `ad_spend_presale` when the allocator
  //      has covered this event (distinguished from "allocator
  //      ran but no presale activity" by `daysCoveredPresale > 0`;
  //      the latter legitimately returns 0 and we trust it).
  //   2. Legacy `events.prereg_spend` column for events the
  //      allocator hasn't yet touched (pre-PR-#120 rows or
  //      venues that haven't run a presale through Meta).
  // The spend model below (allocated / split / add) stays the same
  // — only the source of `prereg` changes depending on which one
  // fires.
  const allocPresale =
    spend.kind === "allocated"
      ? spend.byEventId.get(ev.id)
      : undefined;
  const prereg =
    allocPresale && allocPresale.daysCoveredPresale > 0
      ? allocPresale.presale
      : ev.prereg_spend;

  // Resolve perEventAd / perEventTotal pair from the spend model.
  // Across all three models the triangle stays consistent — total =
  // prereg + ad. Models differ only in WHICH of (ad, total) is the
  // independent input the venue carries:
  //   - allocated: per-event `ad` is sourced from the allocator's
  //     daily sums (PR D2 columns). Total = prereg + allocated.
  //   - split:    total is the campaign-total divided evenly;
  //     ad = total − prereg.
  //   - add:      ad is the sum of two independent campaigns
  //     (London shared + venue-local); total = prereg + ad.
  let perEventAd: number | null;
  let perEventTotal: number | null;
  if (spend.kind === "allocated") {
    const alloc = spend.byEventId.get(ev.id);
    perEventAd = alloc?.allocated ?? null;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  } else if (spend.kind === "split") {
    perEventTotal = spend.perEventTotal;
    perEventAd =
      perEventTotal !== null ? perEventTotal - (prereg ?? 0) : null;
  } else {
    perEventAd = spend.perEventAd;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  }

  const tickets = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
  const prev = ev.tickets_sold_previous ?? 0;
  const cpt =
    perEventTotal !== null && perEventTotal > 0 && tickets > 0
      ? perEventTotal / tickets
      : null;
  // Prev-week CPT uses the *same* per-event spend as the current row —
  // the campaign-level cache doesn't carry a historical snapshot, so
  // this is "what last week's tickets would cost at today's spend".
  // Same trade-off the Excel sheet had; it's the only honest option
  // until we start snapshotting meta_spend_cached too.
  const cptPrevious =
    perEventTotal !== null && perEventTotal > 0 && prev > 0
      ? perEventTotal / prev
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const revenue = ev.latest_snapshot?.revenue ?? null;
  const roas =
    revenue !== null && perEventTotal !== null && perEventTotal > 0
      ? revenue / perEventTotal
      : null;
  return {
    prereg,
    perEventTotal,
    perEventAd,
    tickets,
    prevTickets: prev,
    change: tickets - prev,
    cpt,
    cptPrevious,
    cptChange,
    revenue,
    roas,
  };
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
    // Match `computeEventMetrics`'s prereg source precedence so the
    // Total row sums to the visible per-row values (PR #120 fix).
    // Allocator-written `ad_spend_presale` wins over the legacy
    // `events.prereg_spend` column whenever this event has been
    // touched by the allocator's presale pass.
    const allocPresale =
      spend.kind === "allocated" ? spend.byEventId.get(ev.id) : undefined;
    const rowPrereg =
      allocPresale && allocPresale.daysCoveredPresale > 0
        ? allocPresale.presale
        : ev.prereg_spend ?? 0;
    prereg += rowPrereg;
    const sold = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    tickets += sold;
    prevTickets += ev.tickets_sold_previous ?? 0;
    const r = ev.latest_snapshot?.revenue;
    if (r !== null && r !== undefined) {
      hasRevenue = true;
      revenue += r;
    }
  }

  let total: number | null;
  let ad: number | null;
  if (spend.kind === "allocated") {
    // Venue total ad spend = sum of per-event allocations — by
    // construction of the allocator, this exactly equals
    // `spend.venueTotal` (specific + generic pool). Total = prereg
    // + venueAd keeps the Total row numerically consistent with
    // the visible sum of per-event rows.
    ad = spend.venueTotal;
    total = prereg + spend.venueTotal;
  } else if (spend.kind === "split") {
    // Legacy: campaign value already includes prereg, so ad = total − prereg.
    total = group.campaignSpend;
    ad = total !== null ? total - prereg : null;
  } else {
    // London: venue ad = perEventAd × eventCount (== onsaleShare + venueMeta).
    // Total = prereg + venueAd. Re-multiplying perEventAd preserves the
    // exact same arithmetic the per-row cells use, so the venue total
    // matches the visible sum of its rows without floating-point drift.
    const venueAd =
      spend.perEventAd !== null ? spend.perEventAd * group.eventCount : null;
    ad = venueAd;
    total = venueAd !== null ? prereg + venueAd : null;
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

export function ClientPortalVenueTable({
  token,
  clientId,
  events,
  londonOnsaleSpend,
  londonPresaleSpend,
  dailyEntries,
  dailyRollups,
  weeklyTicketSnapshots,
  isInternal,
  onSnapshotSaved,
}: Props) {
  const venues = useMemo(() => groupByEventCodeAndDate(events), [events]);
  const regions = useMemo(() => partitionByRegion(venues), [venues]);
  // Lifetime per-event allocation map — built from the PR D2
  // columns on every rollup row. Events without any non-null
  // allocation day don't appear in the map, which is exactly the
  // "fall back to the split model" signal `venueSpend` reads.
  const allocationByEvent = useMemo(
    () => aggregateAllocationByEvent(dailyRollups),
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
      map.set(g.key, aggregateVenueWoW(g.events, dailyRollups, todayIso));
    }
    return map;
  }, [venues, dailyRollups, todayIso]);

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
  // Lazy-initialised from `window.location.hash` so the first render
  // already has the correct set when the browser has one — no
  // frame-one flicker of collapsed → hash-target.
  const [hashOverride, setHashOverride] = useState<Set<string> | null>(() => {
    if (typeof window === "undefined") return null;
    const fromHash = parseExpandedHash(window.location.hash);
    return fromHash.size > 0 ? fromHash : null;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => {
      const next = parseExpandedHash(window.location.hash);
      setHashOverride(next.size > 0 ? next : null);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Default to an empty set when no hash is present — explicit opt-in
  // to expansion is the new contract. An empty default collection is
  // intentionally re-used rather than a fresh `new Set()` per render
  // so the `expanded` identity is stable for memoised children.
  const expanded = hashOverride ?? EMPTY_EXPAND_SET;

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

  if (venues.length === 0) {
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
                spend={venueSpend(group, londonOnsaleSpend, allocationByEvent)}
                wow={wowByVenue.get(group.key) ?? EMPTY_WOW}
                dailyEntries={dailyEntries}
                weeklyTicketSnapshots={weeklyTicketSnapshots}
                dailyRollups={dailyRollups}
                isExpanded={expanded.has(group.expandKey)}
                onToggle={() => toggleGroup(group.expandKey)}
                isInternal={isInternal}
                onSnapshotSaved={onSnapshotSaved}
              />
            ))}
          </div>
        );
      })}
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
      tickets += ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
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
  /**
   * Spend model for this venue. Computed once by the parent via
   * `venueSpend()` so the model selection lives in one place and the
   * Overall London row + venue rows draw from identical arithmetic.
   */
  spend: GroupSpend;
  /** All daily tracker rows for the client. Filtered to this venue's
   *  events by the embedded <DailyTracker />. */
  dailyEntries: DailyEntry[];
  /**
   * Pre-collapsed weekly ticket snapshots for every event under the
   * client. The VenueHistorySection filters them down to this
   * venue's event set. Empty arrays render nothing — operators
   * upload an xlsx via /clients/[id]/ticketing-import to populate.
   */
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /**
   * Event daily rollups across the client. Forwarded so the
   * history section can compute "≥7 days" per-event to decide
   * whether the Daily granularity toggle is enabled.
   */
  dailyRollups: DailyRollupRow[];
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
}

/**
 * Daily-entry rollup keyed by date. Drives the trend chart's X axis.
 *
 * Source values stay null when the venue's events report no value for
 * that field on that date — distinct from "value is 0". The chart
 * uses null to *break* lines rather than draw misleading zero
 * segments, and the latest-value pill labels suppress similarly.
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
  /** Hex colour used for the SVG line + the HTML pill swatch. Kept
   *  as a single literal so the two surfaces never drift. */
  colour: string;
  format: (n: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", colour: "#27272a", format: (n) => GBP2.format(n) },
  { key: "tickets", label: "Tickets", colour: "#10b981", format: (n) => NUM.format(n) },
  { key: "cpt", label: "CPT", colour: "#f59e0b", format: (n) => GBP2.format(n) },
  { key: "roas", label: "ROAS", colour: "#8b5cf6", format: (n) => `${n.toFixed(2)}×` },
  { key: "linkClicks", label: "Clicks", colour: "#0ea5e9", format: (n) => NUM.format(n) },
  { key: "cpc", label: "CPC", colour: "#f43f5e", format: (n) => GBP2.format(n) },
];

/**
 * Aggregate per-event tracker rows down to one row per date. Sums
 * propagate nullness: a date where every contributing entry has a
 * null spend stays null (rather than collapsing to 0) so downstream
 * code can distinguish "no data" from "spent nothing".
 *
 * Output is sorted by date ASC for direct consumption by the chart.
 */
function aggregateEntriesByDate(entries: DailyEntry[]): ChartDay[] {
  type Acc = {
    spend: number | null;
    tickets: number | null;
    revenue: number | null;
    linkClicks: number | null;
  };
  const map = new Map<string, Acc>();
  for (const e of entries) {
    const cur =
      map.get(e.date) ??
      ({ spend: null, tickets: null, revenue: null, linkClicks: null } as Acc);
    if (e.day_spend !== null) cur.spend = (cur.spend ?? 0) + e.day_spend;
    if (e.tickets !== null) cur.tickets = (cur.tickets ?? 0) + e.tickets;
    if (e.revenue !== null) cur.revenue = (cur.revenue ?? 0) + e.revenue;
    if (e.link_clicks !== null)
      cur.linkClicks = (cur.linkClicks ?? 0) + e.link_clicks;
    map.set(e.date, cur);
  }
  return [...map.keys()]
    .sort()
    .map((date) => {
      const v = map.get(date)!;
      const cpt =
        v.spend !== null && v.spend > 0 && v.tickets !== null && v.tickets > 0
          ? v.spend / v.tickets
          : null;
      const roas =
        v.revenue !== null && v.revenue > 0 && v.spend !== null && v.spend > 0
          ? v.revenue / v.spend
          : null;
      const cpc =
        v.spend !== null &&
        v.spend > 0 &&
        v.linkClicks !== null &&
        v.linkClicks > 0
          ? v.spend / v.linkClicks
          : null;
      return {
        date,
        spend: v.spend,
        tickets: v.tickets,
        revenue: v.revenue,
        linkClicks: v.linkClicks,
        cpt,
        roas,
        cpc,
      };
    });
}

/**
 * Format YYYY-MM-DD as `14 Apr` in en-GB. UTC-anchored — the API
 * persists ISO date strings, not timestamps, so the local timezone
 * mustn't shift the rendered day.
 */
function chartShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Fuller date format for the hover tooltip — `Mon 14 Apr`. Same UTC
 *  anchoring as `chartShortDate`. */
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

/** Last non-null value of a metric across the day series, or null
 *  when the metric has no data points at all. Powers the latest-
 *  value badge inside each pill so the toggle row is also a legend. */
function latestMetricValue(days: ChartDay[], key: MetricKey): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Multi-metric time-series chart for a venue's daily tracker entries.
 *
 * Self-hides when fewer than two distinct days of data exist — a
 * single point can't draw a meaningful line and the empty plot would
 * imply data we don't have.
 *
 * Each metric has its own implicit Y scale (max-normalised to the plot
 * height independently), so absolute values across series aren't
 * comparable but trends are. The pills under the title double as the
 * legend (colour swatch + metric name + latest value) and the toggle
 * surface — clicking adds/removes a series. Refusing to deselect the
 * last active metric keeps the plot from going visually empty
 * mid-interaction; the user can always swap to a different metric in
 * a single click.
 *
 * Implementation detail: SVG draws lines + dots in a stretched
 * `preserveAspectRatio="none"` viewport so the geometry fills any
 * container width. Date labels are HTML overlaid below the SVG so
 * they don't get horizontally squished by the viewport stretch.
 */
function CptTrendChart({ entries }: { entries: DailyEntry[] }) {
  const days = useMemo(() => aggregateEntriesByDate(entries), [entries]);
  // Default pill set aligned with the per-event report chart
  // (components/dashboard/events/event-trend-chart.tsx from PR #103
  // era). Operators kept asking "why does my per-event view show
  // three lines but the client portal shows one" — it was an
  // oversight that the portal chart defaulted to CPT only.
  const [active, setActive] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(["spend", "tickets", "cpt"]),
  );
  // Hover state lives at the chart level so the tooltip + hairline can
  // share a single source of truth. `chartWidth` is captured at hover
  // time (no ResizeObserver) because the only consumers are the
  // tooltip + hairline rendered in the same pass.
  const [hover, setHover] = useState<{
    index: number;
    chartWidth: number;
  } | null>(null);

  if (days.length < 2) return null;

  const toggle = (key: MetricKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Refuse to deselect the only remaining metric — the plot
        // would otherwise render an empty axis frame which reads as
        // a bug rather than a state.
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Stretchable plot area. Geometry only — text lives in HTML below.
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

  // For each active metric build (a) a per-metric max for normalisation
  // and (b) polyline segments split on null gaps. A single polyline
  // through nulls would draw straight across missing days and lie
  // about the trend; segmenting preserves the gap visually.
  type SeriesPoint = { x: number; y: number; v: number };
  type Series = {
    metric: MetricDef;
    /** Maximum non-null value in the series. Anchors Y-axis tick
     *  values for the primary metric. */
    metricMax: number;
    /** metricMax * 1.1 — the y=0 of the plot area maps to this so the
     *  topmost data point sits inside the canvas. */
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
    // Headroom keeps the topmost point off the upper edge.
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

  // Y-axis tick values anchored to the *primary* metric (first active
  // in canonical METRICS order so the choice is deterministic and
  // matches the leftmost pill). Each tick sits at a meaningful
  // fraction of the metric's max — value labels at 0, max/3, 2max/3,
  // max — rather than at evenly-spaced fractions of the plot height,
  // which would put the top tick in the headroom band where no data
  // can land.
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

  // Hover state: index into `days` of the snapped point + the chart
  // column's pixel width at hover-time. We capture width on each
  // mousemove rather than via ResizeObserver because (a) we already
  // have the bounding rect and (b) the only consumer is the tooltip
  // position computed in the same render pass.
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

  // Date label cadence: cap at ~6 visible labels regardless of point
  // count so the row stays readable on mobile. Always include first
  // and last so the timeline endpoints are anchored.
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  const labelDays = days.filter(
    (_, i) => i === 0 || i === days.length - 1 || i % labelEvery === 0,
  );

  return (
    <div className="border-t border-border px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Daily trend
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          {days.length} day{days.length === 1 ? "" : "s"} · click pills to
          toggle
        </p>
      </div>
      {/* Pill toggles double as legend. Latest non-null value is shown
          alongside the metric name so the pill carries information
          even before you read the chart. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
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
                  : "border-border-strong bg-card text-muted-foreground hover:border-border-strong"
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
                  className={`tabular-nums ${isActive ? "text-background/70" : "text-muted-foreground"}`}
                >
                  {m.format(latest)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex">
        {/* Y-axis column — fixed width, height matches SVG so absolute
            tick positions resolve in the same coordinate space the
            SVG draws in. Y values use the *primary* metric's scale
            (formatted via that metric's formatter). When a second
            series is also active its absolute values won't line up
            with these ticks — that's an inherent trade-off of
            independently-normalised series and matches the spec. */}
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
              {/* Baseline + top reference for visual grounding. Tick
                  rules come from the Y-axis column's labels — drawing
                  them as SVG lines too would just be visual noise. */}
              <line
                x1={PAD_L}
                x2={VB_W - PAD_R}
                y1={PAD_T + plotH}
                y2={PAD_T + plotH}
                stroke="#e4e4e7"
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
                    stroke="#ffffff"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )),
              )}
            </svg>
            {/* Hover hairline + tooltip. Both positioned in HTML pixel
                space (not SVG units) so the text inside the tooltip
                isn't subject to the SVG's stretched viewport. The
                tooltip flips to the left of the hairline once we cross
                the 60% mark of the chart width — the threshold is
                slightly past centre to avoid a flicker on points near
                the middle. */}
            {hover &&
              (() => {
                const idx = hover.index;
                const day = days[idx];
                if (!day) return null;
                const vbX = xAt(idx);
                const pixelX = (vbX / VB_W) * hover.chartWidth;
                const flipLeft = pixelX > hover.chartWidth * 0.6;
                return (
                  <>
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 w-px bg-foreground/30"
                      style={{ left: `${pixelX}px` }}
                      aria-hidden="true"
                    />
                    <div
                      className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-card px-2.5 py-2 text-[11px] shadow-md"
                      style={
                        flipLeft
                          ? {
                              right: `${hover.chartWidth - pixelX + 8}px`,
                              top: 4,
                            }
                          : { left: `${pixelX + 8}px`, top: 4 }
                      }
                    >
                      <p className="mb-1 font-medium text-foreground">
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
                              <span className="ml-auto tabular-nums text-foreground">
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
          {/* HTML date labels overlaid below — kept out of SVG so the
              stretched viewport doesn't squish the text horizontally. */}
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

const COL_COUNT = 12;

function VenueSection({
  token,
  clientId,
  group,
  spend,
  wow,
  dailyEntries,
  weeklyTicketSnapshots,
  dailyRollups,
  isExpanded,
  onToggle,
  isInternal,
  onSnapshotSaved,
}: VenueSectionProps) {
  const [editMode, setEditMode] = useState(false);
  const totals = useMemo(() => sumVenue(group, spend), [group, spend]);
  const headerLabel = group.city
    ? `${group.displayName}, ${group.city}`
    : group.displayName;
  const bodyId = `venue-${group.expandKey}`;
  // Derive rather than store — when the user collapses a card mid-
  // edit, the inline inputs disappear under the header and the Edit
  // toggle hides until they re-open. Keeping edit mode as an
  // internal flag means "still editing when you come back" works
  // without an explicit reset.
  const effectiveEditMode = editMode && isExpanded;
  // Pre-filter the client-wide tracker rows down to this venue's
  // events. Done here (cheap) rather than passing the full set into
  // every DailyTracker so the per-event grouping inside the tracker
  // doesn't have to also discriminate by venue.
  const venueEventIds = useMemo(
    () => new Set(group.events.map((e) => e.id)),
    [group.events],
  );
  const venueEntries = useMemo(
    () => dailyEntries.filter((e) => venueEventIds.has(e.event_id)),
    [dailyEntries, venueEventIds],
  );

  return (
    <section className="rounded-md border border-border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          className="flex flex-1 flex-wrap items-baseline gap-3 text-left"
        >
          <span
            className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center self-center rounded text-muted-foreground transition-transform hover:bg-muted hover:text-foreground"
            aria-hidden="true"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <h2 className="font-heading text-lg tracking-wide text-foreground">
            {headerLabel}
          </h2>
          {group.eventCount > 1 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {group.eventCount} events
            </span>
          )}
          {group.budget !== null && (
            <p className="text-xs text-muted-foreground">
              Ad Budget:{" "}
              <span className="font-semibold text-foreground">
                {formatGBP(group.budget)}
              </span>
            </p>
          )}
          {group.budget !== null && group.campaignSpend !== null && (
            <span className="text-xs text-muted-foreground/60" aria-hidden="true">
              ·
            </span>
          )}
          {group.campaignSpend !== null && (
            <p className="text-xs text-muted-foreground">
              Meta Spend:{" "}
              <span className="font-semibold text-foreground">
                {formatGBP(group.campaignSpend)}
              </span>
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
              className="ml-auto flex flex-wrap items-baseline gap-3 text-xs text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="tabular-nums">
                Tickets:{" "}
                <VenueTicketsClickEdit
                  events={group.events}
                  totalTickets={totals.tickets}
                  token={token}
                  isInternal={isInternal}
                  onSnapshotSaved={onSnapshotSaved}
                  displayValue={formatNumber(totals.tickets)}
                />
                <WoWDeltaInline
                  delta={wow.tickets}
                  formatAbs={(v) => formatSignedNumber(v)}
                  // Tickets moving up is good news; colour that green.
                  positiveIsGood
                />
              </span>
              <span className="text-muted-foreground/60" aria-hidden="true">·</span>
              <span className="tabular-nums">
                CPT:{" "}
                <span className="font-semibold text-foreground">
                  {formatGBP(totals.cpt, 2)}
                </span>
                <WoWDeltaInline
                  delta={wow.cpt}
                  formatAbs={(v) => formatSignedGBP(v, 2)}
                  // CPT moving down (cheaper) is good news; invert
                  // the colour so negative-delta reads green.
                  positiveIsGood={false}
                />
              </span>
              <span className="text-muted-foreground/60" aria-hidden="true">·</span>
              <span
                className={`tabular-nums ${roasClass(totals.roas)}`}
              >
                ROAS: {formatRoas(totals.roas)}
              </span>
            </span>
          )}
        </button>
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
          <VenueSyncButton eventIds={group.events.map((e) => e.id)} />
        )}
        {/* "View full venue report" CTA — placeholder link to a
            dedicated per-venue page planned in a follow-up PR. The
            href carries the venue's event_code so the target page
            can look it up directly. Hidden for solo venues without
            an event_code (nothing to link to) and always hidden when
            the card is collapsed (no visual room next to the
            collapsed-state quick stats). */}
        {isExpanded && group.eventCode && (
          <a
            href={
              isInternal
                ? `/clients/${clientId}/venues/${encodeURIComponent(group.eventCode)}`
                : `/coming-soon?from=venue-report&event_code=${encodeURIComponent(group.eventCode)}`
            }
            target={isInternal ? undefined : "_blank"}
            rel={isInternal ? undefined : "noopener noreferrer"}
            className="inline-flex items-center gap-1 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
          >
            View full venue report
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </a>
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
            averaged across {spend.eventCount} games
          </p>
        )}

      {isExpanded && (
        <VenueHistorySection
          events={group.events}
          weeklyTicketSnapshots={weeklyTicketSnapshots}
          dailyRollups={dailyRollups}
        />
      )}
      {!isExpanded ? null : (
      <div id={bodyId} className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
              <th className="px-3 py-2.5">Event</th>
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
              <EventRow
                key={ev.id}
                token={token}
                event={ev}
                striped={i % 2 === 1}
                editMode={effectiveEditMode}
                spend={spend}
                onSnapshotSaved={onSnapshotSaved}
              />
            ))}
            <tr className="border-t border-border-strong bg-muted text-foreground">
              <td className="px-3 py-2.5 font-semibold">Total</td>
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
      )}
      {/* Multi-metric time-series fed by the venue's daily tracker
          rows. Self-hides when fewer than two distinct days exist —
          new venues without a tracker history won't render anything,
          which is the correct empty state. */}
      {isExpanded && <CptTrendChart entries={venueEntries} />}
      {/* Collapsed-by-default daily tracker mirrors the Excel sheet
          the client team currently keeps by hand. Read-only on the
          public portal; the underlying /daily POST route exists for a
          future internal admin UI. */}
      {isExpanded && (
        <DailyTracker
          token={token}
          events={group.events}
          entries={venueEntries}
        />
      )}
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

interface EventRowProps {
  token: string;
  event: PortalEvent;
  striped: boolean;
  editMode: boolean;
  spend: GroupSpend;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

function EventRow({
  token,
  event,
  striped,
  editMode,
  spend,
  onSnapshotSaved,
}: EventRowProps) {
  const m = computeEventMetrics(event, spend);
  const rowBg = striped ? "bg-muted" : "bg-card";

  // PR D2 breakdown for the Ad Spend tooltip. Only non-null when
  // this row is driven by the allocator — otherwise the tooltip is
  // skipped and the cell renders plain as before.
  const allocationRow =
    spend.kind === "allocated"
      ? spend.byEventId.get(event.id) ?? null
      : null;
  const adSpendTitle = allocationRow
    ? `Includes ${formatGBP(allocationRow.specific)} specific to this game + ${formatGBP(allocationRow.genericShare)} share of venue-generic spend`
    : undefined;

  return (
    <tr className={`border-t border-border ${rowBg} hover:bg-muted/50`}>
      <td className="px-3 py-2.5 align-top">
        <span className="block font-medium text-foreground">{event.name}</span>
        {event.event_code && (
          <span className="block text-[11px] text-muted-foreground">
            {event.event_code}
          </span>
        )}
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
    <div className="inline-flex items-center justify-end gap-1.5 tabular-nums text-foreground">
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
