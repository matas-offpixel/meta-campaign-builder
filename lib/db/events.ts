import { createClient } from "@/lib/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/lib/db/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EventRow = Tables<"events">;
export type EventInsert = TablesInsert<"events">;
export type EventUpdate = TablesUpdate<"events">;

export type EventStatus =
  | "upcoming"
  | "announced"
  | "on_sale"
  | "sold_out"
  | "completed"
  | "cancelled";

export const EVENT_STATUSES: EventStatus[] = [
  "upcoming",
  "announced",
  "on_sale",
  "sold_out",
  "completed",
  "cancelled",
];

/** Event with its parent client joined in — used on list + detail views. */
export type EventWithClient = EventRow & {
  client: Pick<Tables<"clients">, "id" | "name" | "slug" | "primary_type"> | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lowercase, kebab-case, strips non-alnum. Matches the DB slug uniqueness
 * constraint (user_id, slug). Caller should handle collision errors.
 */
export function slugifyEvent(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listEvents(
  userId: string,
  options?: {
    clientId?: string;
    status?: EventStatus;
    /** Only events on or after this ISO date (yyyy-mm-dd). */
    fromDate?: string;
    /** Only events on or before this ISO date (yyyy-mm-dd). */
    toDate?: string;
  },
): Promise<EventWithClient[]> {
  const supabase = createClient();
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
    console.warn("Supabase listEvents error:", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventWithClient[];
}

// ─── Get one ─────────────────────────────────────────────────────────────────

export async function getEventById(
  id: string,
): Promise<EventWithClient | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*, client:clients ( id, name, slug, primary_type )")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getEventById error:", error.message);
    return null;
  }
  return (data as unknown as EventWithClient | null) ?? null;
}

export async function getEventBySlug(
  userId: string,
  slug: string,
): Promise<EventWithClient | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .select("*, client:clients ( id, name, slug, primary_type )")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getEventBySlug error:", error.message);
    return null;
  }
  return (data as unknown as EventWithClient | null) ?? null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export type CreateEventInput = Omit<
  EventInsert,
  "id" | "created_at" | "updated_at"
>;

export async function createEventRow(
  input: CreateEventInput,
): Promise<EventRow | null> {
  const supabase = createClient();
  const payload: EventInsert = {
    ...input,
    slug: input.slug || slugifyEvent(input.name),
  };

  const { data, error } = await supabase
    .from("events")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.warn("Supabase createEvent error:", error.message);
    throw error;
  }
  return (data as EventRow) ?? null;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateEventRow(
  id: string,
  patch: EventUpdate,
): Promise<EventRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("events")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.warn("Supabase updateEvent error:", error.message);
    throw error;
  }
  return (data as EventRow) ?? null;
}

export async function setEventStatus(
  id: string,
  status: EventStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("events")
    .update({ status })
    .eq("id", id);
  if (error) {
    console.warn("Supabase setEventStatus error:", error.message);
    throw error;
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Hard delete. Linked campaign_drafts.event_id will be set to null so
 * historical campaign records survive.
 */
export async function deleteEventRow(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) {
    console.warn("Supabase deleteEvent error:", error.message);
    throw error;
  }
}
