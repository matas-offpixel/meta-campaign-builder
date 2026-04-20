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
  /** Manual tickets_sold override on the event row itself (legacy). */
  tickets_sold: number | null;
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

export type ClientPortalData =
  | {
      ok: true;
      client: PortalClient;
      events: PortalEvent[];
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
  const share = resolved.share;
  if (!share.client_id) {
    return { ok: false, reason: "missing_client_id" };
  }

  if (options?.bumpView) {
    void bumpShareView(token, admin);
  }

  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("id, name, slug, primary_type")
    .eq("id", share.client_id)
    .maybeSingle();
  if (clientErr || !client) {
    return { ok: false, reason: "client_load_failed" };
  }

  const { data: events, error: eventsErr } = await admin
    .from("events")
    .select(
      "id, name, slug, event_code, venue_name, venue_city, venue_country, capacity, event_date, budget_marketing, tickets_sold",
    )
    .eq("client_id", share.client_id)
    .order("event_date", { ascending: true, nullsFirst: false });

  if (eventsErr) {
    return { ok: false, reason: "events_load_failed" };
  }

  const eventRows = events ?? [];
  const eventIds = eventRows.map((e) => e.id);

  const snapshotsByEvent = new Map<string, PortalSnapshot>();
  const historyByEvent = new Map<string, PortalSnapshot[]>();

  if (eventIds.length > 0) {
    const { data: snapshots } = await admin
      .from("client_report_weekly_snapshots")
      .select("event_id, tickets_sold, captured_at, week_start")
      .in("event_id", eventIds)
      .order("captured_at", { ascending: false });

    for (const row of snapshots ?? []) {
      const eventId = row.event_id as string;
      const snap: PortalSnapshot = {
        tickets_sold: row.tickets_sold,
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

  return {
    ok: true,
    client: {
      id: client.id,
      name: client.name,
      slug: client.slug,
      primary_type: client.primary_type,
    },
    events: eventRows.map((e) => ({
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
      tickets_sold: e.tickets_sold,
      latest_snapshot: snapshotsByEvent.get(e.id) ?? null,
      history: historyByEvent.get(e.id) ?? [],
    })),
  };
}
