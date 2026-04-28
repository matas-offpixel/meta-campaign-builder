import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  additionalSpendTotalsByDate,
  sumAdditionalSpendAmounts,
} from "@/lib/db/additional-spend-sum";

/**
 * CRUD for `additional_spend_entries` (migration 044). Off-Meta spend
 * tracked per event/day for Performance Summary + Daily Tracker.
 *
 * Scope (migration 053):
 *   - `event` — default; pinned to a single `event_id`.
 *   - `venue` — pivots on `venue_event_code`, rolls up across every
 *     event under the client that shares the code. `event_id` stays
 *     non-null (points at any event in the group) so RLS stays
 *     unchanged; the reporting layer aggregates by
 *     `(client_id, venue_event_code)` rather than `event_id`.
 */

export type AdditionalSpendCategory =
  | "PR"
  | "INFLUENCER"
  | "PRINT"
  | "RADIO"
  | "OTHER";

export type AdditionalSpendScope = "event" | "venue";

export interface AdditionalSpendEntry {
  id: string;
  user_id: string;
  event_id: string;
  date: string;
  amount: number;
  category: AdditionalSpendCategory;
  label: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** Default `'event'` on rows written pre-migration-053. */
  scope: AdditionalSpendScope;
  /** Non-null only when `scope='venue'`. */
  venue_event_code: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any, any, any>;

function asAny(s: AnySupabase): AnySupabase {
  return s;
}

export async function getAdditionalSpendEntryById(
  supabase: AnySupabase,
  id: string,
): Promise<AdditionalSpendEntry | null> {
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[additional-spend get]", error.message);
    return null;
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function listAdditionalSpendForEvent(
  supabase: AnySupabase,
  eventId: string,
): Promise<AdditionalSpendEntry[]> {
  // Per-event surface only shows scope='event' rows. Venue-scope
  // rows surface on the venue report, not on the individual event
  // card — filtering here keeps the per-event totals from double-
  // counting a venue-scope row that also happens to FK to this event.
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .select("*")
    .eq("event_id", eventId)
    .eq("scope", "event")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[additional-spend list]", error.message);
    return [];
  }
  return (data ?? []) as unknown as AdditionalSpendEntry[];
}

/**
 * List venue-scope rows under a (client_id, venue_event_code) pair.
 * Joins through `events` for RLS / ownership — we filter on
 * `events.client_id` client-side after loading the candidate rows
 * because Supabase doesn't expose cross-table filtering in one query
 * without a view. The set is small (handful of rows per venue) so
 * the extra round-trip is fine.
 */
export async function listAdditionalSpendForVenue(
  supabase: AnySupabase,
  clientId: string,
  eventCode: string,
): Promise<AdditionalSpendEntry[]> {
  // Fetch every scope='venue' row for this code. `user_id` is enforced
  // by RLS on the authenticated client; the service-role client will
  // return everything, which is the correct behaviour for token-
  // resolved reads.
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .select("*, events!inner(client_id)")
    .eq("scope", "venue")
    .eq("venue_event_code", eventCode)
    .eq("events.client_id", clientId)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.warn("[additional-spend list venue]", error.message);
    return [];
  }
  // Strip the joined `events` column from the return shape so callers
  // see a flat `AdditionalSpendEntry` the same as the per-event list.
  return (data ?? []).map((r) => {
    const { events: _events, ...rest } = r as Record<string, unknown>;
    return rest as unknown as AdditionalSpendEntry;
  });
}

/** @deprecated Use sumAdditionalSpendAmounts from additional-spend-sum.ts */
export const sumAdditionalSpendInWindow = sumAdditionalSpendAmounts;

/** @deprecated Use additionalSpendTotalsByDate from additional-spend-sum.ts */
export const additionalSpendByDate = additionalSpendTotalsByDate;

export async function insertAdditionalSpendEntry(
  supabase: AnySupabase,
  args: {
    userId: string;
    eventId: string;
    date: string;
    amount: number;
    category: AdditionalSpendCategory;
    label: string;
    notes: string | null;
    /**
     * Defaults to `'event'` when omitted so pre-migration-053 callers
     * keep the legacy contract. Venue-scope rows must also pass
     * `venueEventCode` — the DB check constraint enforces the pairing.
     */
    scope?: AdditionalSpendScope;
    venueEventCode?: string | null;
  },
): Promise<AdditionalSpendEntry | null> {
  const scope: AdditionalSpendScope = args.scope ?? "event";
  const venueEventCode = scope === "venue" ? (args.venueEventCode ?? null) : null;
  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .insert({
      user_id: args.userId,
      event_id: args.eventId,
      date: args.date,
      amount: args.amount,
      category: args.category,
      label: args.label,
      notes: args.notes,
      scope,
      venue_event_code: venueEventCode,
    })
    .select("*")
    .single();
  if (error) {
    console.warn("[additional-spend insert]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function updateAdditionalSpendEntry(
  supabase: AnySupabase,
  args: {
    id: string;
    userId: string;
    date?: string;
    amount?: number;
    category?: AdditionalSpendCategory;
    label?: string;
    notes?: string | null;
  },
): Promise<AdditionalSpendEntry | null> {
  const patch: Record<string, unknown> = {};
  if (args.date !== undefined) patch.date = args.date;
  if (args.amount !== undefined) patch.amount = args.amount;
  if (args.category !== undefined) patch.category = args.category;
  if (args.label !== undefined) patch.label = args.label;
  if (args.notes !== undefined) patch.notes = args.notes;

  const { data, error } = await asAny(supabase)
    .from("additional_spend_entries")
    .update(patch)
    .eq("id", args.id)
    .eq("user_id", args.userId)
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[additional-spend update]", error.message);
    throw new Error(error.message);
  }
  return (data as unknown as AdditionalSpendEntry) ?? null;
}

export async function deleteAdditionalSpendEntry(
  supabase: AnySupabase,
  args: { id: string; userId: string },
): Promise<boolean> {
  const { error } = await asAny(supabase)
    .from("additional_spend_entries")
    .delete()
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) {
    console.warn("[additional-spend delete]", error.message);
    throw new Error(error.message);
  }
  return true;
}
