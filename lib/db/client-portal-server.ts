import "server-only";

import { bumpShareView, resolveShareByToken } from "@/lib/db/report-shares";
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
}

export interface PortalClient {
  id: string;
  name: string;
  slug: string | null;
  primary_type: string | null;
}

/**
 * One day's tracker entry for one event. Mirrors the
 * `daily_tracking_entries` row introduced in migration 025; the UI
 * (`components/share/daily-tracker.tsx`) groups entries by event_id
 * and pads any missing calendar days between the earliest entry and
 * today so the venue table can show a continuous timeline.
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
 */
export interface DailyRollupRow {
  event_id: string;
  ad_spend: number | null;
}

/**
 * Slim `additional_spend_entries` row for the same reason. The
 * topline sums amounts across the client; category / date / label
 * are only relevant per-event where the share-report page already
 * owns that data.
 */
export interface AdditionalSpendRow {
  event_id: string;
  amount: number;
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
       * Drives the client-wide topline aggregator (sum of ad_spend)
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

  return loadPortalForClientId(share.client_id);
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
      "id, name, slug, event_code, venue_name, venue_city, venue_country, capacity, event_date, budget_marketing, tickets_sold, prereg_spend, meta_campaign_id, meta_spend_cached",
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
  // client_id (not event_ids) so the query is one round-trip even
  // when the event list is long. Ordered (event_id, date ASC) so the
  // UI can group/iterate without re-sorting.
  let dailyEntries: DailyEntry[] = [];
  {
    const { data: rows, error: dailyErr } = await admin
      .from("daily_tracking_entries")
      .select("id, event_id, date, day_spend, tickets, revenue, link_clicks, notes")
      .eq("client_id", clientId)
      .order("event_id", { ascending: true })
      .order("date", { ascending: true });
    // Soft-fail: if the table doesn't exist yet (migration 025 not
    // applied) or the query trips, render the rest of the portal with
    // an empty tracker rather than 500-ing the whole page.
    if (!dailyErr && rows) {
      dailyEntries = rows.map((r) => ({
        id: r.id as string,
        event_id: r.event_id as string,
        date: r.date as string,
        day_spend: (r.day_spend as number | null) ?? null,
        tickets: (r.tickets as number | null) ?? null,
        revenue: (r.revenue as number | null) ?? null,
        link_clicks: (r.link_clicks as number | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      }));
    }
  }

  // Event daily rollups (`event_daily_rollups`) — the source of truth
  // for paid-media spend across events. Filtered by event_ids rather
  // than client_id because the rollup table doesn't carry client_id;
  // the events already are scoped to the token's client so this is
  // safe and also RLS-safe under service-role.
  let dailyRollups: DailyRollupRow[] = [];
  if (eventIds.length > 0) {
    const { data: rows } = await admin
      .from("event_daily_rollups")
      .select("event_id, ad_spend")
      .in("event_id", eventIds);
    if (rows) {
      dailyRollups = rows.map((r) => ({
        event_id: r.event_id as string,
        ad_spend: (r.ad_spend as number | null) ?? null,
      }));
    }
  }

  // Additional (off-Meta) spend for the same events. The entries
  // table is user-scoped, not client-scoped, so we filter by
  // event_ids under service role; service role bypasses RLS which
  // is the correct behavior for a token-resolved portal read.
  let additionalSpend: AdditionalSpendRow[] = [];
  if (eventIds.length > 0) {
    const { data: rows } = await admin
      .from("additional_spend_entries")
      .select("event_id, amount")
      .in("event_id", eventIds);
    if (rows) {
      additionalSpend = rows
        .map((r) => ({
          event_id: r.event_id as string,
          amount: typeof r.amount === "number" ? r.amount : Number(r.amount ?? 0),
        }))
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
    events: eventRows.map((e) => {
      const history = historyByEvent.get(e.id) ?? [];
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
        budget_marketing: e.budget_marketing,
        meta_campaign_id: e.meta_campaign_id,
        meta_spend_cached: e.meta_spend_cached,
        prereg_spend: e.prereg_spend,
        tickets_sold: e.tickets_sold,
        // history is newest-first, so index [1] is the previous week's
        // entry. Null when the client only has one (or zero) updates.
        tickets_sold_previous: history[1]?.tickets_sold ?? null,
        latest_snapshot: snapshotsByEvent.get(e.id) ?? null,
        history,
      };
    }),
  };
}
