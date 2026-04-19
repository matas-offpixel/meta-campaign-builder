import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isPendingAction } from "@/lib/dashboard/format";
import type {
  EventWithClient,
  EventLinkedDraft,
  EventStatus,
} from "./events";

/**
 * Server-side counterparts to lib/db/events.ts read helpers.
 *
 * Lives in a separate file because lib/supabase/server.ts pulls in
 * `next/headers`, which can't be bundled into client components.
 */

export async function getEventByIdServer(
  id: string,
): Promise<EventWithClient | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*, client:clients ( id, name, slug, primary_type, meta_business_id, meta_ad_account_id, meta_pixel_id )")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getEventByIdServer error:", error.message);
    return null;
  }
  return (data as unknown as EventWithClient | null) ?? null;
}

export async function listEventsServer(
  userId: string,
  options?: {
    clientId?: string;
    status?: EventStatus;
    fromDate?: string;
    toDate?: string;
    /**
     * Substring filter on event name and venue name. Applied in memory
     * after fetch (post-RLS dataset is bounded), avoiding the need for
     * PostgREST .or() escaping of user input. Trimmed; empty/null is
     * treated as no filter.
     */
    q?: string | null;
    /**
     * Pending-action filter: events with an imminent milestone (within
     * PENDING_HORIZON_DAYS) and no linked campaign draft yet. Requires
     * a parallel campaign_drafts read; applied in memory.
     */
    pendingAction?: boolean;
  },
): Promise<EventWithClient[]> {
  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select("*, client:clients ( id, name, slug, primary_type, meta_business_id, meta_ad_account_id, meta_pixel_id )")
    .eq("user_id", userId)
    .order("event_date", { ascending: true, nullsFirst: false });

  if (options?.clientId) query = query.eq("client_id", options.clientId);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.fromDate) query = query.gte("event_date", options.fromDate);
  if (options?.toDate) query = query.lte("event_date", options.toDate);

  // Fan out the draft-map fetch in parallel with the events query when
  // pendingAction is requested — single round-trip wall time.
  const draftMapPromise = options?.pendingAction
    ? listDraftMapForUserServer(userId)
    : Promise.resolve(
        new Map<string, { id: string; updated_at: string }>(),
      );

  const [{ data, error }, draftMap] = await Promise.all([
    query,
    draftMapPromise,
  ]);

  if (error) {
    console.warn("Supabase listEventsServer error:", error.message);
    return [];
  }
  let rows = (data ?? []) as unknown as EventWithClient[];

  if (options?.q) {
    const needle = options.q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((e) => {
        const name = e.name?.toLowerCase() ?? "";
        const venue = e.venue_name?.toLowerCase() ?? "";
        return name.includes(needle) || venue.includes(needle);
      });
    }
  }

  if (options?.pendingAction) {
    const now = new Date();
    rows = rows.filter((e) => isPendingAction(e, draftMap, now));
  }

  return rows;
}

/**
 * Server-side mirror of lib/db/events#listDraftsForUserByEvent. Same
 * semantics: latest-updated draft per event_id, RLS-scoped to userId.
 * Lives here (not in events.ts) because it imports the server Supabase
 * client; the browser variant stays in events.ts for client components.
 */
async function listDraftMapForUserServer(
  userId: string,
): Promise<Map<string, { id: string; updated_at: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, event_id, updated_at")
    .eq("user_id", userId)
    .not("event_id", "is", null)
    .order("updated_at", { ascending: false });

  const map = new Map<string, { id: string; updated_at: string }>();
  if (error) {
    console.warn("Supabase listDraftMapForUserServer error:", error.message);
    return map;
  }
  for (const row of data ?? []) {
    const eventId = row.event_id as string | null;
    if (!eventId || map.has(eventId)) continue;
    map.set(eventId, {
      id: row.id as string,
      updated_at: row.updated_at as string,
    });
  }
  return map;
}

export async function listDraftsForEventServer(
  eventId: string,
): Promise<EventLinkedDraft[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, objective, status, updated_at")
    .eq("event_id", eventId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("Supabase listDraftsForEventServer error:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    objective: (row.objective as string | null) ?? null,
    status: ((row.status as EventLinkedDraft["status"] | null) ?? "draft"),
    updated_at: row.updated_at as string,
  }));
}
