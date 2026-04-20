import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ArtistInsert,
  ArtistRow,
  ArtistUpdate,
} from "@/lib/types/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side CRUD for the `artists` table (migration 020).
//
// Mirrors lib/db/venues.ts. Genre filter is applied with the PostgREST `cs.`
// (contains) operator so it leans on the GIN index on artists.genres rather
// than fetching everything and filtering in memory.
//
// TODO(post-020): drop the `as never` casts once types regenerate.
// ─────────────────────────────────────────────────────────────────────────────

export type { ArtistRow, ArtistInsert, ArtistUpdate };

export async function listArtists(
  userId: string,
  options?: { genre?: string },
): Promise<ArtistRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("artists" as never)
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (options?.genre) {
    // text[] contains operator — `.contains` on PostgREST = `cs.{value}`
    query = query.contains("genres", [options.genre]);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[artists listArtists]", error.message);
    return [];
  }
  return ((data as unknown as ArtistRow[]) ?? []) as ArtistRow[];
}

export async function getArtist(id: string): Promise<ArtistRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artists" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[artists getArtist]", error.message);
    return null;
  }
  return (data as unknown as ArtistRow | null) ?? null;
}

export async function createArtist(
  userId: string,
  input: Omit<ArtistInsert, "user_id">,
): Promise<ArtistRow> {
  const supabase = await createClient();
  const payload = { ...input, user_id: userId } as unknown as Record<string, unknown>;
  const { data, error } = await supabase
    .from("artists" as never)
    .insert(payload as never)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("createArtist returned no row");
  return data as unknown as ArtistRow;
}

export async function updateArtist(
  id: string,
  patch: ArtistUpdate,
): Promise<ArtistRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artists" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as ArtistRow | null) ?? null;
}

export async function deleteArtist(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("artists" as never)
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Per-artist event count for the artists management page. Goes through
 * event_artists rather than denormalising onto the artist row so the count
 * stays accurate when events get added/removed.
 */
export async function countEventsByArtist(
  userId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_artists" as never)
    .select("artist_id")
    .eq("user_id", userId);
  const counts = new Map<string, number>();
  if (error || !data) return counts;
  for (const row of data as Array<{ artist_id?: string | null }>) {
    if (!row.artist_id) continue;
    counts.set(row.artist_id, (counts.get(row.artist_id) ?? 0) + 1);
  }
  return counts;
}
