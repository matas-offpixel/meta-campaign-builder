import "server-only";

import { bumpShareView, resolveShareByToken } from "@/lib/db/report-shares";
import {
  listEventTicketTiersForEvents,
  type EventTicketTierRow,
} from "@/lib/db/ticketing";
import type { AdditionalTicketEntry } from "@/lib/db/additional-tickets";
import {
  buildTierChannelBreakdownMap,
  listAllocationsForEvents,
  listChannelsForClient,
  listSalesForEvents,
  type TierChannelRow,
} from "@/lib/db/tier-channels";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Server-only data layer for the public client portal share
 * (`/share/client/[token]`).
 *
 * Single source of truth for both:
 *   - GET /api/share/client/[token]  — JSON response for re-fetches
 *     after a snapshot save.
 *   - app/share/client/[token]/page  — server component that loads the
 *     same payload directly so the first paint never hits the network.
 *
 * All reads run through the service-role client (bypassing RLS) after
 * the token is validated. Token validation rejects `scope='event'` so
 * an event-only share can't be repurposed to read client-wide data.
 */

export interface PortalSnapshot {
  tickets_sold: number | null;
  /**
   * Client-reported gross ticket revenue for this snapshot week.
   * Lives on `client_report_weekly_snapshots.revenue` and is the only
   * source of revenue on the portal — `events.ticket_price` is no longer
   * used (kept in DB for legacy rows; deliberately not selected here).
   */
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

export interface PortalEvent {
  id: string;
  name: string;
  slug: string | null;
  event_code: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_country: string | null;
  capacity: number | null;
  event_date: string | null;
  general_sale_at: string | null;
  report_cadence: "daily" | "weekly";
  budget_marketing: number | null;
  /**
   * Meta campaign id covering this event (migration 023). All events at
   * the same venue share one campaign, so the venue-level rollup in the
   * portal matches the campaign's lifetime spend exactly.
   */
  meta_campaign_id: string | null;
  /**
   * Cached lifetime spend for `meta_campaign_id` (migration 023).
   * Identical across every event sharing the campaign id; the portal
   * picks the first non-null value within a venue group as the venue
   * total, then divides by event count for the per-event split.
   */
  meta_spend_cached: number | null;
  /** Pre-registration / D2C phase spend (migration 022). */
  prereg_spend: number | null;
  /** Manual tickets_sold override on the event row itself (legacy). */
  tickets_sold: number | null;
  api_tickets_sold: number | null;
  additional_tickets_sold: number;
  additional_ticket_revenue: number;
  /**
   * Second-most-recent snapshot reading. Populated from history[1] —
   * the snapshot list is captured-at DESC, so [0] is "this week" and
   * [1] is "last week" for the Prev / Change / Prev-CPT columns.
   */
  tickets_sold_previous: number | null;
  /** Most-recent client_report_weekly_snapshots row for this event. */
  latest_snapshot: PortalSnapshot | null;
  /** Up to 5 most-recent snapshots, newest first. */
  history: PortalSnapshot[];
  /**
   * Earliest of the latest ticket sync and latest paid-media sync for
   * this event. This is the "all data fresh as of" timestamp surfaced on
   * venue cards/reports.
   */
  freshness_at?: string | null;
  ticketing_status: PortalTicketingStatus;
  ticket_tiers: EventTicketTierRow[];
}

export interface PortalTicketingStatus {
  linked_count: number;
  provider: TicketSnapshotSource | null;
  active_source: TicketSnapshotSource | null;
  latest_ticket_snapshot_at: string | null;
  latest_ticket_source: TicketSnapshotSource | null;
  preferred_provider: string | null;
}

export interface PortalClient {
  id: string;
  name: string;
  slug: string | null;
  primary_type: string | null;
}

/**
 * One day's tracker entry for one event. Mirrors the
 * legacy `daily_tracking_entries` row introduced in migration 025.
 * The current venue trend surface reads `dailyRollups`; this payload
 * remains for older JSON/API consumers while the dashboard's active
 * editable tracker writes through `event_daily_rollups`.
 *
 * All numeric fields are nullable: a partial-day entry (spend
 * recorded but tickets not yet reported) is a valid intermediate
 * state and renders as "—" in the UI.
 */
export interface DailyEntry {
  id: string;
  event_id: string;
  date: string;
  day_spend: number | null;
  tickets: number | null;
  revenue: number | null;
  link_clicks: number | null;
  notes: string | null;
}

/**
 * Slim `event_daily_rollups` row surfaced to the client dashboard
 * topline aggregator. Only the columns the aggregator actually
 * needs cross the server→client boundary so the payload stays
 * small on clients with dozens of events × hundreds of rollup
 * days (64 × 180 ≈ 11k rows for 4theFans).
 *
 * The three `ad_spend_*` allocation columns (migration 046) are
 * the PR D2 per-event split. When `ad_spend_allocated` is non-
 * null the venue table uses it directly; when all three are null
 * the reporting layer falls back to the raw `ad_spend` and the
 * pre-D2 split model.
 */
/**
 * One weekly ticket snapshot for the venue-expansion trends chart.
 * Rows come from `ticket_sales_snapshots`; the server-side loader
 * collapses multiple sources down to one row per (event, week)
 * before shipping — see `collapseWeekly` in
 * `lib/db/event-history-resolver.ts`. PR #122.
 */
export interface WeeklyTicketSnapshotRow {
  event_id: string;
  /** Canonical YYYY-MM-DD of the week-ending snapshot (UTC). */
  snapshot_at: string;
  tickets_sold: number;
  /** Provenance — API, import, or operator-entered rows. */
  source:
    | "eventbrite"
    | "fourthefans"
    | "manual"
    | "xlsx_import"
    | "foursomething";
}

type TicketSnapshotSource = WeeklyTicketSnapshotRow["source"];

export interface DailyRollupRow {
  event_id: string;
  /** Calendar day the row covers — `YYYY-MM-DD` in UTC.
   *  Required by the WoW aggregator (`aggregateVenueWoW`); the
   *  lifetime topline aggregator ignores it. */
  date: string;
  /** Tickets sold for this (event, day). NULL when the provider
   *  side hadn't yielded data for the day yet. */
  tickets_sold: number | null;
  /** Raw per-event per-day Meta spend (venue-total for multi-
   *  match venues — every event in the venue sees the same
   *  `ad_spend` value for a given day). */
  ad_spend: number | null;
  /** Raw per-event per-day TikTok spend. */
  tiktok_spend: number | null;
  /** Per-event allocated spend (specific + generic share).
   *  NULL when allocation hasn't run yet. */
  ad_spend_allocated: number | null;
  /** Ticket revenue for this event/day from the ticketing provider. */
  revenue: number | null;
  /** Meta link clicks for this event/day. */
  link_clicks: number | null;
  /** Meta complete_registration actions for this event/day. */
  meta_regs: number | null;
  /** TikTok clicks for this event/day. */
  tiktok_clicks: number | null;
  source_meta_at?: string | null;
  source_eventbrite_at?: string | null;
  updated_at?: string;
  /** Opponent-matched portion of the allocation. NULL when
   *  allocation hasn't run. */
  ad_spend_specific: number | null;
  /** This event's share of the venue-wide generic pool. */
  ad_spend_generic_share: number | null;
  /**
   * This event's share of the venue's presale-campaign spend
   * (migration 048). Presale campaigns no longer flow through the
   * opponent allocator — their spend is split evenly across every
   * event at the venue and surfaced in the PRE-REG column. NULL
   * when the allocator hasn't run for this row; reporting falls
   * back to `events.prereg_spend` in that case.
   */
  ad_spend_presale: number | null;
}

/**
 * Slim `additional_spend_entries` row for the same reason. The
 * topline sums amounts across the client; category / date / label
 * are only relevant per-event where the share-report page already
 * owns that data.
 *
 * Scope (migration 053):
 *   - `event` rows (the default pre-053) roll up under the `event_id`
 *     they point to.
 *   - `venue` rows roll up under `venue_event_code` across every
 *     event sharing that code. `event_id` is still populated (points
 *     at any event in the group, used for RLS/ownership) but the
 *     reporting layer should pivot on `venue_event_code` for venue
 *     aggregations so a venue row isn't double-counted under both
 *     the pinned event AND the venue total.
 */
export interface AdditionalSpendRow {
  event_id: string;
  date: string;
  amount: number;
  category: string;
  scope: "event" | "venue";
  venue_event_code: string | null;
}

/**
 * Synthetic event_codes used to model London-wide shared campaigns.
 * The rows live in the events table (migration 024) so the existing
 * "Refresh all spend" flow picks them up automatically — but they are
 * NOT shown as venues in the portal. Instead their meta_spend_cached
 * values are surfaced as top-level `londonOnsaleSpend` / `londonPresaleSpend`
 * on the portal payload and consumed by the venue table for the
 * London aggregate row + per-venue onsale split.
 */
export const LONDON_ONSALE_EVENT_CODE = "WC26-LONDON-ONSALE";
export const LONDON_PRESALE_EVENT_CODE = "WC26-LONDON-PRESALE";

const SYNTHETIC_LONDON_CODES = new Set<string>([
  LONDON_ONSALE_EVENT_CODE,
  LONDON_PRESALE_EVENT_CODE,
]);

export type ClientPortalData =
  | {
      ok: true;
      client: PortalClient;
      events: PortalEvent[];
      /**
       * Lifetime Meta spend for the shared London on-sale campaign,
       * pulled from the synthetic event row keyed by
       * `LONDON_ONSALE_EVENT_CODE`. Distributed equally across the four
       * London venues by the portal table. `null` until the admin runs
       * the refresh-all-spend action against this client.
       */
      londonOnsaleSpend: number | null;
      /**
       * Lifetime Meta spend for the shared London presale campaign.
       * Display-only (per-event prereg_spend already carries the split
       * across the venues that ran a presale). `null` when not yet
       * refreshed.
       */
      londonPresaleSpend: number | null;
      /**
       * Daily tracker rows for every event under the share's client.
       * Ordered by (event_id, date ASC) so the UI can group by event
       * without re-sorting. Empty array when no rows exist yet — the
       * tracker still renders (collapsed) so admins can see the
       * affordance.
       */
      dailyEntries: DailyEntry[];
      /**
       * Daily rollup rows across every event under the client.
       * Drives the client-wide topline aggregator (sum of paid-media spend)
       * — the per-card venue tables keep using meta_spend_cached as
       * today. Empty when the rollup table is empty for this client
       * (migration 039 not backfilled, or no events yet).
       */
      dailyRollups: DailyRollupRow[];
      /**
       * Additional (off-Meta) spend entries across every event under
       * the client. Drives the topline "Total Spend" stat. Empty when
       * no additional spend has been logged yet.
       */
      additionalSpend: AdditionalSpendRow[];
      /**
       * Weekly ticket-sales snapshots across every event under the
       * client, collapsed to one row per (event, week) with source
       * priority manual > xlsx_import > eventbrite. Used as the
       * venue trend chart ticket fallback when rollups only carry
       * spend/clicks.
       *
       * Kept as a flat array keyed by event_id rather than a
       * Map<eventId, Snapshot[]> because the public share JSON
       * endpoint ships the payload over the wire — a flat array
       * serialises cleanly without a Map → object transform.
       *
       * Empty when no snapshots have been written yet. For the
       * 4theFans roster this is ~60 events × 8 weeks ≈ 480 rows;
       * well under any payload concern.
       */
      weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
      /**
       * Channel set for this client (migration 076). One row per
       * (client_id, channel_name). Threaded onto the portal payload so
       * the venue report can render the operator-facing inline edit
       * UI without an extra round-trip.
       */
      tierChannels: TierChannelRow[];
      shareVisibility: {
        showCreativeInsights: boolean;
        showFunnelPacing: boolean;
      };
    }
  | {
      ok: false;
      reason: "not_found" | "missing_client_id" | "client_load_failed" | "events_load_failed";
    };

/**
 * Resolve a portal token + load the client + events + snapshots.
 *
 * `bumpView=false` lets the API route call this without double-counting
 * a view that the page already counted server-side. The page passes
 * `bumpView=true` to record the visit; the API route passes false
 * (its caller is the same browser refreshing after a save).
 */
export async function loadClientPortalData(
  token: string,
  options?: { bumpView?: boolean },
): Promise<ClientPortalData> {
  if (!token || token.length > 64) {
    return { ok: false, reason: "not_found" };
  }
  const admin = createServiceRoleClient();

  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok || resolved.share.scope !== "client") {
    return { ok: false, reason: "not_found" };
  }
  // The discriminated union now narrows `client_id` to `string` once the
  // scope check above has fired (the resolver rejects malformed rows
  // where scope='client' but client_id is null with reason='malformed').
  // The previous `missing_client_id` branch is therefore dead — keep the
  // reason in the union for backwards compatibility with any caller that
  // exhaustively switches on it, but stop emitting it.
  const share = resolved.share;

  if (options?.bumpView) {
    void bumpShareView(token, admin);
  }

  const portal = await loadPortalForClientId(share.client_id);
  if (!portal.ok) return portal;
  return {
    ...portal,
    shareVisibility: {
      showCreativeInsights: share.show_creative_insights,
      showFunnelPacing: share.show_funnel_pacing,
    },
  };
}

/**
 * Internal counterpart used by `/clients/[id]/dashboard`. Skips the
 * token validation path — the caller is expected to have already
 * proved ownership (e.g. the page enforces `client.user_id ===
 * auth.uid`). Returns the same payload shape as the token-driven
 * loader so the same `ClientPortal` component renders both.
 */
export async function loadClientPortalByClientId(
  clientId: string,
): Promise<ClientPortalData> {
  if (!clientId) return { ok: false, reason: "not_found" };
  return loadPortalForClientId(clientId);
}

/**
 * Result type for `loadVenuePortalByToken`. Extends `ClientPortalData`'s
 * success variant with the resolved `event_code` + `client_id` so the
 * public venue page can thread them down into the share controls without
 * re-parsing the token.
 */
export type VenuePortalData =
  | ({
      ok: true;
      event_code: string;
      client_id: string;
      /** True when the resolved token grants additional-spend CRUD. */
      can_edit: boolean;
    } & Omit<
      Extract<ClientPortalData, { ok: true }>,
      "ok"
    >)
  | { ok: false; reason: "not_found" | "events_load_failed" };

/**
 * Resolve a `scope='venue'` share token and return the portal payload
 * pre-filtered down to the single `event_code` the token pins. Used by
 * `/share/venue/[token]` to render the public venue report without
 * exposing sibling venues under the same client.
 *
 * Failure modes collapse to `not_found`:
 *   - Token missing / disabled / expired / malformed.
 *   - Token resolves but scope !== 'venue'.
 *   - Token resolves but no events match (event_code renamed / deleted
 *     after mint). Rare but worth the explicit guard.
 *
 * `bumpView=true` increments the share view counter best-effort — the
 * counter write never blocks the render on failure.
 */
export async function loadVenuePortalByToken(
  token: string,
  options?: { bumpView?: boolean },
): Promise<VenuePortalData> {
  if (!token || token.length > 64) {
    return { ok: false, reason: "not_found" };
  }
  const admin = createServiceRoleClient();

  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok || resolved.share.scope !== "venue") {
    return { ok: false, reason: "not_found" };
  }
  const share = resolved.share;

  if (options?.bumpView) {
    void bumpShareView(token, admin);
  }

  const portal = await loadPortalForClientId(share.client_id);
  if (!portal.ok) {
    return {
      ok: false,
      reason: portal.reason === "events_load_failed" ? "events_load_failed" : "not_found",
    };
  }

  // Filter every array payload down to the venue scope. `event_code` is
  // the canonical pivot; events, rollups, snapshots, tracker entries
  // all FK through event_id so a single id-set narrows the rest.
  const venueEvents = portal.events.filter(
    (e) => e.event_code === share.event_code,
  );
  if (venueEvents.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const eventIdSet = new Set(venueEvents.map((e) => e.id));
  const venueDailyEntries = portal.dailyEntries.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueDailyRollups = portal.dailyRollups.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueAdditionalSpend = portal.additionalSpend.filter((r) =>
    r.scope === "venue"
      ? r.venue_event_code === share.event_code
      : eventIdSet.has(r.event_id),
  );
  const venueWeeklyTicketSnapshots = portal.weeklyTicketSnapshots.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  return {
    ok: true,
    event_code: share.event_code,
    client_id: share.client_id,
    can_edit: share.can_edit,
    client: portal.client,
    events: venueEvents,
    londonOnsaleSpend: portal.londonOnsaleSpend,
    londonPresaleSpend: portal.londonPresaleSpend,
    dailyEntries: venueDailyEntries,
    dailyRollups: venueDailyRollups,
    additionalSpend: venueAdditionalSpend,
    weeklyTicketSnapshots: venueWeeklyTicketSnapshots,
    tierChannels: portal.tierChannels,
    shareVisibility: portal.shareVisibility,
  };
}

async function loadPortalForClientId(
  clientId: string,
): Promise<ClientPortalData> {
  const admin = createServiceRoleClient();

  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("id, name, slug, primary_type")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false, reason: "client_load_failed" };
  }

  const { data: events, error: eventsErr } = await admin
    .from("events")
    .select(
      "id, name, slug, event_code, venue_name, venue_city, venue_country, capacity, event_date, general_sale_at, report_cadence, budget_marketing, tickets_sold, prereg_spend, meta_campaign_id, meta_spend_cached, preferred_provider",
    )
    .eq("client_id", clientId)
    .order("event_date", { ascending: true, nullsFirst: false });

  if (eventsErr) {
    return { ok: false, reason: "events_load_failed" };
  }

  const allRows = events ?? [];

  // Pull the synthetic London shared-campaign rows out of the event
  // list so they never reach the UI as venues. The portal renders the
  // single Overall London aggregate from the spend totals below; the
  // synthetic rows would otherwise show up as a "London, London" venue
  // group with one or two zero-ticket events.
  let londonOnsaleSpend: number | null = null;
  let londonPresaleSpend: number | null = null;
  const eventRows: typeof allRows = [];
  for (const row of allRows) {
    if (row.event_code && SYNTHETIC_LONDON_CODES.has(row.event_code)) {
      if (row.event_code === LONDON_ONSALE_EVENT_CODE) {
        londonOnsaleSpend = row.meta_spend_cached ?? null;
      } else if (row.event_code === LONDON_PRESALE_EVENT_CODE) {
        londonPresaleSpend = row.meta_spend_cached ?? null;
      }
      continue;
    }
    eventRows.push(row);
  }

  const eventIds = eventRows.map((e) => e.id);
  const snapshotsByEvent = new Map<string, PortalSnapshot>();
  const historyByEvent = new Map<string, PortalSnapshot[]>();
  const latestTicketSnapshotByEvent = new Map<string, number>();
  const previousTicketSnapshotByEvent = new Map<string, number>();
  const latestTicketSnapshotAtByEvent = new Map<string, string>();
  const latestTicketSnapshotSourceByEvent = new Map<string, TicketSnapshotSource>();

  if (eventIds.length > 0) {
    const { data: snapshots } = await admin
      .from("client_report_weekly_snapshots")
      .select("event_id, tickets_sold, revenue, captured_at, week_start")
      .in("event_id", eventIds)
      .order("captured_at", { ascending: false });

    for (const row of snapshots ?? []) {
      const eventId = row.event_id as string;
      const snap: PortalSnapshot = {
        tickets_sold: row.tickets_sold,
        revenue: row.revenue,
        captured_at: row.captured_at,
        week_start: row.week_start,
      };
      if (!snapshotsByEvent.has(eventId)) {
        snapshotsByEvent.set(eventId, snap);
      }
      const list = historyByEvent.get(eventId) ?? [];
      if (list.length < 5) {
        list.push(snap);
        historyByEvent.set(eventId, list);
      }
    }
  }

  // Daily tracker rows for every event under this client. Filtered by
  // client_id (not event_ids) so the query is one round-trip per page.
  // Page explicitly because this legacy table grows as events × days
  // and can otherwise hit PostgREST's 1,000-row cap.
  const dailyEntries = await fetchAllDailyEntries(admin, clientId);

  // Event daily rollups (`event_daily_rollups`) — the source of truth
  // for paid-media spend across events. Filtered by event_ids rather
  // than client_id because the rollup table doesn't carry client_id;
  // the events already are scoped to the token's client so this is
  // safe and also RLS-safe under service-role.
  //
  // Important: PostgREST caps unpaginated selects at 1,000 rows. Larger
  // client dashboards exceed that quickly, which can silently truncate
  // later venue allocations. Page explicitly so lifetime venue totals
  // include every rollup row.
  let dailyRollups: DailyRollupRow[] = [];
  if (eventIds.length > 0) {
    dailyRollups = await fetchAllDailyRollups(admin, eventIds);
  }
  const latestMetaSyncByEvent = latestMetaSyncByEventId(dailyRollups);
  const ticketingStatusByEvent =
    eventIds.length > 0
      ? await fetchTicketingStatusByEvent(admin, eventIds)
      : new Map<string, PortalTicketingStatus>();
  const ticketTiers = await listEventTicketTiersForEvents(admin, eventIds);
  const ticketTiersByEvent = groupTicketTiersByEvent(ticketTiers);
  const additionalTickets =
    eventIds.length > 0 ? await fetchAllAdditionalTickets(admin, eventIds) : [];
  const additionalTicketTotals = additionalTicketTotalsByEvent(additionalTickets);
  const additionalTicketRevenueTotals =
    additionalTicketRevenueTotalsByEvent(additionalTickets);
  applyTierAdditionalTickets(ticketTiersByEvent, additionalTickets);

  // Multi-channel allocations + sales (migrations 076–077). Loaded in
  // parallel with the existing ticket-tier reads so we don't pay an
  // extra round-trip latency. `tierChannels` is per-client; the
  // allocations + sales are per-event under the client.
  const tierChannels = await listChannelsForClient(admin, clientId);
  const tierChannelAllocations =
    eventIds.length > 0 ? await listAllocationsForEvents(admin, eventIds) : [];
  const tierChannelSales =
    eventIds.length > 0 ? await listSalesForEvents(admin, eventIds) : [];
  applyTierChannelBreakdowns(ticketTiersByEvent, {
    channels: tierChannels,
    allocations: tierChannelAllocations,
    sales: tierChannelSales,
  });

  // Weekly ticket snapshots (`ticket_sales_snapshots`). Pulled across
  // every event in one shot so the venue-expansion chart doesn't
  // fan out a per-event fetch on open. The query already selects
  // only the fields the chart uses — keeping the payload trim.
  //
  // Collapse rules (manual > xlsx_import > eventbrite for same
  // week) live in `collapseWeekly`; we run that post-select to
  // keep the DB query simple rather than doing it in SQL.
  const weeklyTicketSnapshots: WeeklyTicketSnapshotRow[] = [];
  if (eventIds.length > 0) {
    const rows = await fetchAllTicketSalesSnapshots(admin, eventIds);
    if (rows) {
      const byEvent = new Map<
        string,
        Array<{ snapshot_at: string; tickets_sold: number; source: string }>
      >();
      for (const r of rows) {
        const eid = r.event_id as string;
        const list = byEvent.get(eid) ?? [];
        list.push({
          snapshot_at: String(r.snapshot_at),
          tickets_sold: Number(r.tickets_sold ?? 0),
          source: String(r.source ?? "eventbrite"),
        });
        byEvent.set(eid, list);
      }

      // Current ticket count source-of-truth: latest
      // `ticket_sales_snapshots` cumulative value. The legacy
      // `events.tickets_sold` column is now only a fallback/mirror for
      // events without API/manual snapshot history. Compute this from
      // the raw rows, not the dominant-source normalised set below, so
      // a fresh Eventbrite sync can recover a stale manual/event column.
      for (const [eid, rowsForEvent] of byEvent) {
        const ticketingStatus = ticketingStatusByEvent.get(eid);
        const activeSource = ticketingStatus?.active_source ?? null;
        const ordered = [...rowsForEvent].sort((a, b) => {
          const byDate = b.snapshot_at.localeCompare(a.snapshot_at);
          if (byDate !== 0) return byDate;
          return sourcePriority(b.source) - sourcePriority(a.source);
        });
        if (ordered[0]) {
          latestTicketSnapshotByEvent.set(eid, ordered[0].tickets_sold);
        }
        if (ordered[1]) {
          previousTicketSnapshotByEvent.set(eid, ordered[1].tickets_sold);
        }
        const ticketFreshnessRows = activeSource
          ? rowsForEvent.filter((row) => normalizeTicketSource(row.source) === activeSource)
          : rowsForEvent;
        const latestActiveTicketSnapshot = [...ticketFreshnessRows].sort((a, b) =>
          b.snapshot_at.localeCompare(a.snapshot_at),
        )[0];
        if (latestActiveTicketSnapshot) {
          latestTicketSnapshotAtByEvent.set(eid, latestActiveTicketSnapshot.snapshot_at);
          latestTicketSnapshotSourceByEvent.set(
            eid,
            normalizeTicketSource(latestActiveTicketSnapshot.source),
          );
        }
      }

      // Pulled from the thread-neutral collapse module — the
      // server-side resolver re-exports this same helper. Using the
      // pure module keeps the import tree free of `server-only`
      // transitive deps for anything that might one day bundle this
      // file into a client boundary (it shouldn't, but the guard
      // costs nothing).
      //
      // `collapseWeeklyNormalizedPerEvent` picks a single dominant
      // source *per event* (priority-ordered manual > xlsx_import >
      // foursomething > eventbrite). That's stricter than the
      // per-day tie-break `collapseWeekly` applies — the WoW
      // aggregator needs cumulative comparability within an event's
      // own history, otherwise week A from xlsx_import (cumulative
      // 1,783) vs week B from eventbrite (cumulative 1,091)
      // produces a phantom regression like the Leeds FA Cup SF -692
      // delta from PR 2's brief. See the docblocks on
      // `collapseWeekly` and `collapseWeeklyNormalizedPerEvent` for
      // the full reasoning.
      const { collapseWeeklyNormalizedPerEvent } = await import(
        "@/lib/db/event-history-collapse"
      );
      for (const [eid, rowsForEvent] of byEvent) {
        const collapsed = collapseWeeklyNormalizedPerEvent(rowsForEvent);
        for (const c of collapsed) {
          weeklyTicketSnapshots.push({
            event_id: eid,
            snapshot_at: c.snapshot_at,
            tickets_sold: c.tickets_sold,
            source: c.source,
          });
        }
      }
    }
  }

  // Additional (off-Meta) spend for the same events. The entries
  // table is user-scoped, not client-scoped, so we filter by
  // event_ids under service role; service role bypasses RLS which
  // is the correct behavior for a token-resolved portal read.
  //
  // Scope carried through so downstream aggregators can fork:
  //   - Per-event total → scope='event' rows for this event_id.
  //   - Per-venue total → scope='event' rows across the venue's
  //     events PLUS scope='venue' rows keyed on venue_event_code.
  //   - Client-wide total → every row (amount sums identically
  //     regardless of scope; the `venue`-scope rows don't double-
  //     count because they FK to exactly one event_id inside the
  //     group, same as event-scope rows).
  let additionalSpend: AdditionalSpendRow[] = [];
  if (eventIds.length > 0) {
    const rows = await fetchAllAdditionalSpend(admin, eventIds);
    if (rows) {
      additionalSpend = rows
        .map((r) => {
          const row = r as unknown as {
            event_id: string;
            date: string;
            amount: number | string | null;
            category?: string | null;
            scope?: string | null;
            venue_event_code?: string | null;
          };
          const rawScope = row.scope ?? "event";
          const scope = rawScope === "venue" ? "venue" : "event";
          return {
            event_id: row.event_id,
            date: row.date,
            amount:
              typeof row.amount === "number"
                ? row.amount
                : Number(row.amount ?? 0),
            category: row.category ?? "OTHER",
            scope,
            venue_event_code:
              scope === "venue" ? (row.venue_event_code ?? null) : null,
          } as AdditionalSpendRow;
        })
        .filter((r) => Number.isFinite(r.amount));
    }
  }

  return {
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      slug: client.slug,
      primary_type: client.primary_type,
    },
    londonOnsaleSpend,
    londonPresaleSpend,
    dailyEntries,
    dailyRollups,
    additionalSpend,
    weeklyTicketSnapshots,
    tierChannels,
    shareVisibility: {
      showCreativeInsights: true,
      showFunnelPacing: true,
    },
    events: eventRows.map((e) => {
      const history = historyByEvent.get(e.id) ?? [];
      const resolvedTicketsSold =
        (latestTicketSnapshotByEvent.get(e.id) ?? e.tickets_sold ?? 0) +
        (additionalTicketTotals.get(e.id) ?? 0);
      const apiTicketsSold = latestTicketSnapshotByEvent.get(e.id) ?? e.tickets_sold ?? null;
      const additionalTicketsSold = additionalTicketTotals.get(e.id) ?? 0;
      const additionalTicketRevenue = additionalTicketRevenueTotals.get(e.id) ?? 0;
      const latestClientSnapshot = snapshotsByEvent.get(e.id) ?? null;
      const latestSnapshot =
        latestClientSnapshot && latestTicketSnapshotByEvent.has(e.id)
          ? {
              ...latestClientSnapshot,
              tickets_sold: resolvedTicketsSold,
              revenue:
                (latestClientSnapshot.revenue ?? 0) +
                (additionalTicketRevenueTotals.get(e.id) ?? 0),
            }
          : latestClientSnapshot;
      return {
        id: e.id,
        name: e.name,
        slug: e.slug,
        event_code: e.event_code,
        venue_name: e.venue_name,
        venue_city: e.venue_city,
        venue_country: e.venue_country,
        capacity: e.capacity,
        event_date: e.event_date,
        general_sale_at: e.general_sale_at,
        report_cadence:
          e.report_cadence === "weekly" || e.report_cadence === "daily"
            ? e.report_cadence
            : "daily",
        budget_marketing: e.budget_marketing,
        meta_campaign_id: e.meta_campaign_id,
        meta_spend_cached: e.meta_spend_cached,
        prereg_spend: e.prereg_spend,
        tickets_sold: resolvedTicketsSold,
        api_tickets_sold: apiTicketsSold,
        additional_tickets_sold: additionalTicketsSold,
        additional_ticket_revenue: additionalTicketRevenue,
        // history is newest-first, so index [1] is the previous week's
        // entry. Fall back to ticket_sales_snapshots history when the
        // client-report table has never been used for this event.
        tickets_sold_previous:
          history[1]?.tickets_sold ??
          previousTicketSnapshotByEvent.get(e.id) ??
          null,
        latest_snapshot: latestSnapshot,
        history,
        freshness_at: eventFreshnessAt({
          meta: latestMetaSyncByEvent.get(e.id) ?? null,
          tickets: latestTicketSnapshotAtByEvent.get(e.id) ?? null,
        }),
        ticketing_status: {
          ...(ticketingStatusByEvent.get(e.id) ?? emptyTicketingStatus()),
          latest_ticket_snapshot_at: latestTicketSnapshotAtByEvent.get(e.id) ?? null,
          latest_ticket_source: latestTicketSnapshotSourceByEvent.get(e.id) ?? null,
          preferred_provider: (e.preferred_provider as string | null) ?? null,
        },
        ticket_tiers: ticketTiersByEvent.get(e.id) ?? [],
      };
    }),
  };
}

function groupTicketTiersByEvent(
  rows: EventTicketTierRow[],
): Map<string, EventTicketTierRow[]> {
  const byEvent = new Map<string, EventTicketTierRow[]>();
  for (const row of rows) {
    const list = byEvent.get(row.event_id) ?? [];
    list.push(row);
    byEvent.set(row.event_id, list);
  }
  return byEvent;
}

function additionalTicketTotalsByEvent(
  rows: AdditionalTicketEntry[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.event_id, (out.get(row.event_id) ?? 0) + row.tickets_count);
  }
  return out;
}

function additionalTicketRevenueTotalsByEvent(
  rows: AdditionalTicketEntry[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.event_id, (out.get(row.event_id) ?? 0) + Number(row.revenue_amount ?? 0));
  }
  return out;
}

function applyTierAdditionalTickets(
  tiersByEvent: Map<string, EventTicketTierRow[]>,
  rows: AdditionalTicketEntry[],
) {
  for (const row of rows) {
    if (row.scope !== "tier" || !row.tier_name) continue;
    const tiers = tiersByEvent.get(row.event_id);
    if (!tiers) continue;
    const tier = tiers.find((item) => item.tier_name === row.tier_name);
    if (!tier) continue;
    const apiQuantitySold = tier.api_quantity_sold ?? tier.quantity_sold;
    const additional = (tier.additional_quantity_sold ?? 0) + row.tickets_count;
    tier.api_quantity_sold = apiQuantitySold;
    tier.additional_quantity_sold = additional;
    tier.quantity_sold = apiQuantitySold + additional;
  }
}

/**
 * Attach per-tier `channel_breakdowns` to each EventTicketTierRow
 * using the (event, tier) pair from `tier_channel_allocations` and
 * `tier_channel_sales`. The 4TF channel falls back to the existing
 * event_ticket_tiers.quantity_sold + price when no explicit sales
 * row exists, which is how the auto-sync surfaces in the per-channel
 * display.
 */
function applyTierChannelBreakdowns(
  tiersByEvent: Map<string, EventTicketTierRow[]>,
  bundle: {
    channels: TierChannelRow[];
    allocations: import("./tier-channels").TierChannelAllocationRow[];
    sales: import("./tier-channels").TierChannelSaleRow[];
  },
) {
  if (bundle.channels.length === 0) return;
  const fourTfFallback = new Map<
    string,
    { quantity_sold: number; price: number | null }
  >();
  for (const [eventId, tiers] of tiersByEvent.entries()) {
    for (const tier of tiers) {
      const apiSold = tier.api_quantity_sold ?? tier.quantity_sold;
      fourTfFallback.set(`${eventId}::${tier.tier_name}`, {
        quantity_sold: apiSold,
        price: tier.price,
      });
    }
  }
  const map = buildTierChannelBreakdownMap(bundle, fourTfFallback);
  for (const [eventId, tiers] of tiersByEvent.entries()) {
    for (const tier of tiers) {
      const breakdowns = map.get(`${eventId}::${tier.tier_name}`);
      if (breakdowns && breakdowns.length > 0) {
        // Sort: automatic channels first (4TF, Eventbrite), then the
        // operator-managed channels in stable name order. Keeps the
        // venue report row layout predictable across deploys.
        breakdowns.sort((a, b) => {
          if (a.is_automatic !== b.is_automatic) {
            return a.is_automatic ? -1 : 1;
          }
          return a.channel_name.localeCompare(b.channel_name);
        });
        tier.channel_breakdowns = breakdowns;
      }
    }
  }
}

function eventFreshnessAt(input: {
  meta: string | null;
  tickets: string | null;
}): string | null {
  if (input.meta && input.tickets) {
    return input.meta < input.tickets ? input.meta : input.tickets;
  }
  return input.meta ?? input.tickets;
}

function latestMetaSyncByEventId(
  rows: DailyRollupRow[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const timestamp = row.source_meta_at ?? row.updated_at ?? null;
    if (!timestamp) continue;
    const current = out.get(row.event_id);
    if (!current || timestamp > current) {
      out.set(row.event_id, timestamp);
    }
  }
  return out;
}

function normalizeTicketSource(source: string): TicketSnapshotSource {
  if (
    source === "eventbrite" ||
    source === "fourthefans" ||
    source === "manual" ||
    source === "xlsx_import" ||
    source === "foursomething"
  ) {
    return source;
  }
  return "eventbrite";
}

function ticketSourceForProvider(provider: string): TicketSnapshotSource | null {
  if (provider === "eventbrite") return "eventbrite";
  if (provider === "fourthefans") return "fourthefans";
  if (provider === "manual") return "manual";
  if (provider === "foursomething_internal") return "foursomething";
  return null;
}

function sourcePriority(source: string): number {
  if (source === "manual") return 4;
  if (source === "xlsx_import") return 3;
  if (source === "foursomething" || source === "fourthefans") return 2;
  return 1;
}

function emptyTicketingStatus(): PortalTicketingStatus {
  return {
    linked_count: 0,
    provider: null,
    active_source: null,
    latest_ticket_snapshot_at: null,
    latest_ticket_source: null,
    preferred_provider: null,
  };
}

async function fetchTicketingStatusByEvent(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventIds: string[],
): Promise<Map<string, PortalTicketingStatus>> {
  const out = new Map<string, PortalTicketingStatus>();
  if (eventIds.length === 0) return out;

  const { data: links, error: linksError } = await admin
    .from("event_ticketing_links")
    .select("event_id, connection_id")
    .in("event_id", eventIds);
  if (linksError || !links || links.length === 0) {
    if (linksError) {
      console.warn("[client-portal-server] ticket links load failed", {
        message: linksError.message,
      });
    }
    return out;
  }

  const connectionIds = [
    ...new Set(
      links
        .map((link) => (link as { connection_id: string | null }).connection_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  if (connectionIds.length === 0) return out;

  const { data: connections, error: connectionsError } = await admin
    .from("client_ticketing_connections")
    .select("id, provider, status")
    .in("id", connectionIds);
  if (connectionsError || !connections) {
    if (connectionsError) {
      console.warn("[client-portal-server] ticket connections load failed", {
        message: connectionsError.message,
      });
    }
    return out;
  }

  const sourceByConnection = new Map<string, TicketSnapshotSource>();
  for (const connection of connections) {
    const row = connection as {
      id: string;
      provider: string;
      status: string | null;
    };
    if (row.status && row.status !== "active") continue;
    const source = ticketSourceForProvider(row.provider);
    if (source) sourceByConnection.set(row.id, source);
  }

  for (const link of links) {
    const row = link as { event_id: string; connection_id: string | null };
    const existing = out.get(row.event_id) ?? emptyTicketingStatus();
    const source =
      row.connection_id != null ? sourceByConnection.get(row.connection_id) : null;
    existing.linked_count += 1;
    if (source && !existing.provider) {
      existing.provider = source;
      existing.active_source = source;
    }
    out.set(row.event_id, existing);
  }

  return out;
}

const PORTAL_PAGE_SIZE = 1000;

async function fetchAllDailyEntries(
  admin: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
): Promise<DailyEntry[]> {
  const rows: DailyEntry[] = [];
  for (let from = 0; ; from += PORTAL_PAGE_SIZE) {
    const to = from + PORTAL_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("daily_tracking_entries")
      .select("id, event_id, date, day_spend, tickets, revenue, link_clicks, notes")
      .eq("client_id", clientId)
      .order("event_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to);

    // Soft-fail: if the legacy table doesn't exist or the query trips,
    // render the rest of the portal rather than 500-ing the page.
    if (error) {
      console.warn("[client-portal-server] daily entries load failed", {
        from,
        to,
        message: error.message,
      });
      return rows;
    }
    if (!data || data.length === 0) break;

    rows.push(
      ...data.map((r) => ({
        id: r.id as string,
        event_id: r.event_id as string,
        date: r.date as string,
        day_spend: (r.day_spend as number | null) ?? null,
        tickets: (r.tickets as number | null) ?? null,
        revenue: (r.revenue as number | null) ?? null,
        link_clicks: (r.link_clicks as number | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      })),
    );

    if (data.length < PORTAL_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllDailyRollups(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventIds: string[],
): Promise<DailyRollupRow[]> {
  const rows: DailyRollupRow[] = [];
  for (let from = 0; ; from += PORTAL_PAGE_SIZE) {
    const to = from + PORTAL_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("event_daily_rollups")
      .select(
        "event_id, date, tickets_sold, ad_spend, tiktok_spend, ad_spend_allocated, revenue, link_clicks, meta_regs, tiktok_clicks, source_meta_at, source_eventbrite_at, updated_at, ad_spend_specific, ad_spend_generic_share, ad_spend_presale",
      )
      .in("event_id", eventIds)
      .order("event_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, to);

    if (error) {
      console.warn("[client-portal-server] daily rollups load failed", {
        from,
        to,
        message: error.message,
      });
      return rows;
    }
    if (!data || data.length === 0) break;

    rows.push(
      ...data.map((r) => ({
        event_id: r.event_id as string,
        date: r.date as string,
        tickets_sold: (r.tickets_sold as number | null) ?? null,
        ad_spend: (r.ad_spend as number | null) ?? null,
        tiktok_spend: (r.tiktok_spend as number | null) ?? null,
        ad_spend_allocated: (r.ad_spend_allocated as number | null) ?? null,
        revenue: (r.revenue as number | null) ?? null,
        link_clicks: (r.link_clicks as number | null) ?? null,
        meta_regs: (r.meta_regs as number | null) ?? null,
        tiktok_clicks: (r.tiktok_clicks as number | null) ?? null,
        source_meta_at: (r.source_meta_at as string | null) ?? null,
        source_eventbrite_at: (r.source_eventbrite_at as string | null) ?? null,
        updated_at: r.updated_at as string,
        ad_spend_specific: (r.ad_spend_specific as number | null) ?? null,
        ad_spend_generic_share:
          (r.ad_spend_generic_share as number | null) ?? null,
        ad_spend_presale: (r.ad_spend_presale as number | null) ?? null,
      })),
    );

    if (data.length < PORTAL_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllTicketSalesSnapshots(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventIds: string[],
): Promise<Array<{ event_id: string; snapshot_at: string; tickets_sold: number; source: string }>> {
  const rows: Array<{
    event_id: string;
    snapshot_at: string;
    tickets_sold: number;
    source: string;
  }> = [];
  for (let from = 0; ; from += PORTAL_PAGE_SIZE) {
    const to = from + PORTAL_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("ticket_sales_snapshots")
      .select("event_id, snapshot_at, tickets_sold, source")
      .in("event_id", eventIds)
      .order("snapshot_at", { ascending: true })
      .range(from, to);

    if (error) {
      console.warn("[client-portal-server] ticket snapshots load failed", {
        from,
        to,
        message: error.message,
      });
      return rows;
    }
    if (!data || data.length === 0) break;

    rows.push(
      ...data.map((r) => ({
        event_id: r.event_id as string,
        snapshot_at: String(r.snapshot_at),
        tickets_sold: Number(r.tickets_sold ?? 0),
        source: String(r.source ?? "eventbrite"),
      })),
    );

    if (data.length < PORTAL_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllAdditionalSpend(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventIds: string[],
): Promise<
  Array<{
    event_id: string;
    date: string;
    amount: number | string | null;
    category?: string | null;
    scope?: string | null;
    venue_event_code?: string | null;
  }>
> {
  const rows: Array<{
    event_id: string;
    date: string;
    amount: number | string | null;
    category?: string | null;
    scope?: string | null;
    venue_event_code?: string | null;
  }> = [];
  for (let from = 0; ; from += PORTAL_PAGE_SIZE) {
    const to = from + PORTAL_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("additional_spend_entries")
      .select("event_id, date, amount, category, scope, venue_event_code")
      .in("event_id", eventIds)
      .range(from, to);

    if (error) {
      console.warn("[client-portal-server] additional spend load failed", {
        from,
        to,
        message: error.message,
      });
      return rows;
    }
    if (!data || data.length === 0) break;

    rows.push(
      ...data.map((r) => ({
        event_id: r.event_id as string,
        date: r.date as string,
        amount: r.amount as number | string | null,
        category: (r.category as string | null | undefined) ?? null,
        scope: (r.scope as string | null | undefined) ?? null,
        venue_event_code: (r.venue_event_code as string | null | undefined) ?? null,
      })),
    );

    if (data.length < PORTAL_PAGE_SIZE) break;
  }
  return rows;
}

async function fetchAllAdditionalTickets(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventIds: string[],
): Promise<AdditionalTicketEntry[]> {
  const rows: AdditionalTicketEntry[] = [];
  for (let from = 0; ; from += PORTAL_PAGE_SIZE) {
    const to = from + PORTAL_PAGE_SIZE - 1;
    const { data, error } = await admin
      .from("additional_ticket_entries")
      .select("*")
      .in("event_id", eventIds)
      .range(from, to);
    if (error) {
      console.warn("[client-portal-server] additional tickets load failed", {
        from,
        to,
        message: error.message,
      });
      return rows;
    }
    if (!data || data.length === 0) break;
    rows.push(...((data ?? []) as unknown as AdditionalTicketEntry[]));
    if (data.length < PORTAL_PAGE_SIZE) break;
  }
  return rows;
}
