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
//
// TODO(post-020): drop the `as never` casts below once the generated
// `database.types.ts` includes the `venues` table.
// ─────────────────────────────────────────────────────────────────────────────

export type { VenueRow, VenueInsert, VenueUpdate };

export async function listVenues(userId: string): Promise<VenueRow[]> {
  const supabase = await createClient();
  // TODO(post-020): typed `from("venues")`.
  const { data, error } = await supabase
    .from("venues" as never)
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });
  if (error) {
    console.warn("[venues listVenues]", error.message);
    return [];
  }
  return ((data as unknown as VenueRow[]) ?? []) as VenueRow[];
}

export async function getVenue(id: string): Promise<VenueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[venues getVenue]", error.message);
    return null;
  }
  return (data as unknown as VenueRow | null) ?? null;
}

export async function createVenue(
  userId: string,
  input: Omit<VenueInsert, "user_id">,
): Promise<VenueRow> {
  const supabase = await createClient();
  const payload = { ...input, user_id: userId } as unknown as Record<string, unknown>;
  const { data, error } = await supabase
    .from("venues" as never)
    .insert(payload as never)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("createVenue returned no row");
  return data as unknown as VenueRow;
}

export async function updateVenue(
  id: string,
  patch: VenueUpdate,
): Promise<VenueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("venues" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as VenueRow | null) ?? null;
}

export async function deleteVenue(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("venues" as never)
    .delete()
    .eq("id", id);
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
  for (const row of data as Array<{ venue_id?: string | null }>) {
    if (!row.venue_id) continue;
    counts.set(row.venue_id, (counts.get(row.venue_id) ?? 0) + 1);
  }
  return counts;
}
