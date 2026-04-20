import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  VenueInsert,
  VenueRow,
  VenueUpdate,
} from "@/lib/types/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side CRUD for the `venues` table introduced in migration 020.
//
// All helpers are RLS-bound — callers don't pass user_id; the cookie session
// resolves it. Insert helpers take a userId because the row's user_id column
// is owned, not derived from auth.uid() during the INSERT path.
// ─────────────────────────────────────────────────────────────────────────────

export type { VenueRow, VenueInsert, VenueUpdate };

export async function listVenues(userId: string): Promise<VenueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) {
    console.warn("[venues listVenues]", error.message);
    return [];
  }
  return data ?? [];
}

export async function getVenue(id: string): Promise<VenueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[venues getVenue]", error.message);
    return null;
  }
  return data;
}

export async function createVenue(
  userId: string,
  input: Omit<VenueInsert, "user_id">,
): Promise<VenueRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .insert({ ...input, user_id: userId })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("createVenue returned no row");
  return data;
}

export async function updateVenue(
  id: string,
  patch: VenueUpdate,
): Promise<VenueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteVenue(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("venues").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Count events linked to each venue. Returns Map<venue_id, count>.
 * Used by the venues management page to show "X events" per row.
 */
export async function countEventsByVenue(
  userId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("venue_id")
    .eq("user_id", userId);
  const counts = new Map<string, number>();
  if (error || !data) return counts;
  for (const row of data) {
    if (!row.venue_id) continue;
    counts.set(row.venue_id, (counts.get(row.venue_id) ?? 0) + 1);
  }
  return counts;
}
