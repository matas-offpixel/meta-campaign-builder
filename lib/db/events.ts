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

// ─── Draft link helpers ─────────────────────────────────────────────────────
//
// These live in events.ts (not drafts.ts) so that the creator module remains
// untouched. They read/write `campaign_drafts.event_id` directly — a column
// added in migration 003.

/** Shape of a campaign draft row as surfaced on the event hub. */
export type EventLinkedDraft = {
  id: string;
  name: string | null;
  objective: string | null;
  status: "draft" | "published" | "archived";
  updated_at: string;
};

/**
 * Attach (or detach) an event to an existing campaign draft by setting
 * campaign_drafts.event_id. Pass `null` to unlink.
 *
 * Called after a new draft is created from the event hub, so the creator
 * route can pick it up via query param *or* by reading the column in future.
 */
export async function linkDraftToEvent(
  draftId: string,
  eventId: string | null,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("campaign_drafts")
    .update({ event_id: eventId })
    .eq("id", draftId);
  if (error) {
    console.warn("Supabase linkDraftToEvent error:", error.message);
    throw error;
  }
}

/** List campaign drafts linked to a given event, newest first. */
export async function listDraftsForEvent(
  eventId: string,
): Promise<EventLinkedDraft[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, objective, status, updated_at")
    .eq("event_id", eventId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("Supabase listDraftsForEvent error:", error.message);
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
