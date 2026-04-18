import "server-only";

import { createClient } from "@/lib/supabase/server";
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
    .select("*, client:clients ( id, name, slug, primary_type )")
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
  },
): Promise<EventWithClient[]> {
  const supabase = await createClient();
  let query = supabase
    .from("events")
    .select("*, client:clients ( id, name, slug, primary_type )")
    .eq("user_id", userId)
    .order("event_date", { ascending: true, nullsFirst: false });

  if (options?.clientId) query = query.eq("client_id", options.clientId);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.fromDate) query = query.gte("event_date", options.fromDate);
  if (options?.toDate) query = query.lte("event_date", options.toDate);

  const { data, error } = await query;
  if (error) {
    console.warn("Supabase listEventsServer error:", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventWithClient[];
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
