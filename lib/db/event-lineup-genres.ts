/**
 * The lineup's genres for one event, for the event form's Genre suggestion
 * (design record 2026-11-16-genre-key.html, GK2: "… from the lineup").
 *
 * artists.genres through event_artists, headliners first, then billing
 * order. Read at render time, never written. A failed read is no lineup:
 * the suggestion falls back to nothing, never to a guess.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type Db = Pick<SupabaseClient, "from">;

type LinkRow = {
  is_headliner: boolean | null;
  billing_order: number | null;
  artist: { genres: string[] | null } | { genres: string[] | null }[] | null;
};

export function lineupGenresFrom(rows: readonly LinkRow[]): string[] {
  const sorted = [...rows].sort(
    (a, b) => Number(Boolean(b.is_headliner)) - Number(Boolean(a.is_headliner)) || (a.billing_order ?? 0) - (b.billing_order ?? 0),
  );
  const out: string[] = [];
  for (const row of sorted) {
    const artists = Array.isArray(row.artist) ? row.artist : row.artist ? [row.artist] : [];
    for (const artist of artists) for (const genre of artist.genres ?? []) if (genre.trim()) out.push(genre.trim());
  }
  return out;
}

export async function loadLineupGenres(db: Db, eventId: string): Promise<string[]> {
  const { data, error } = await db
    .from("event_artists")
    .select("is_headliner, billing_order, artist:artists ( genres )")
    .eq("event_id", eventId)
    .order("billing_order", { ascending: true })
    .range(0, 199);
  if (error) {
    console.warn("[loadLineupGenres] read failed:", error.message);
    return [];
  }
  return lineupGenresFrom((data ?? []) as unknown as LinkRow[]);
}
