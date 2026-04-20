import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  ArtistRow,
  EventArtistJoined,
  EventArtistRow,
} from "@/lib/types/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side helpers for the `event_artists` junction (migration 020).
//
// listEventArtists returns the joined shape (artist columns flattened in)
// which is what every consumer actually wants. Mutation helpers stay narrow:
// add / remove / re-bill — there's deliberately no bulk replace because
// that would mask which row caused a constraint violation.
// ─────────────────────────────────────────────────────────────────────────────

export type { EventArtistRow, EventArtistJoined };

export async function listEventArtists(
  eventId: string,
): Promise<EventArtistJoined[]> {
  const supabase = await createClient();
  // PostgREST embedded select so we get the artist row alongside the
  // junction row in a single round-trip. Sort by billing_order then name
  // so the UI list reads predictably.
  const { data, error } = await supabase
    .from("event_artists")
    .select(
      "id, event_id, artist_id, is_headliner, billing_order, artist:artists ( name, genres, meta_page_id, meta_page_name )",
    )
    .eq("event_id", eventId)
    .order("billing_order", { ascending: true });

  if (error) {
    console.warn("[event-artists listEventArtists]", error.message);
    return [];
  }

  type ArtistEmbed = Pick<
    ArtistRow,
    "name" | "genres" | "meta_page_id" | "meta_page_name"
  >;

  return (data ?? [])
    .map((row) => {
      // PostgREST types FK embeds as an array even on many-to-one; normalise.
      const artistRel = row.artist as ArtistEmbed | ArtistEmbed[] | null;
      const artist = Array.isArray(artistRel) ? artistRel[0] ?? null : artistRel;
      return {
        id: row.id,
        event_id: row.event_id,
        artist_id: row.artist_id,
        is_headliner: row.is_headliner,
        billing_order: row.billing_order,
        artist_name: artist?.name ?? "(unknown artist)",
        genres: artist?.genres ?? [],
        meta_page_id: artist?.meta_page_id ?? null,
        meta_page_name: artist?.meta_page_name ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.billing_order - b.billing_order ||
        a.artist_name.localeCompare(b.artist_name),
    );
}

interface AddOpts {
  isHeadliner?: boolean;
  billingOrder?: number;
}

export async function addEventArtist(
  userId: string,
  eventId: string,
  artistId: string,
  opts: AddOpts = {},
): Promise<EventArtistRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_artists")
    .insert({
      user_id: userId,
      event_id: eventId,
      artist_id: artistId,
      is_headliner: opts.isHeadliner ?? false,
      billing_order: opts.billingOrder ?? 0,
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("addEventArtist returned no row");
  return data;
}

export async function removeEventArtist(
  eventId: string,
  artistId: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("event_artists")
    .delete()
    .eq("event_id", eventId)
    .eq("artist_id", artistId);
  if (error) throw new Error(error.message);
}

export async function updateEventArtistBilling(
  eventId: string,
  artistId: string,
  isHeadliner: boolean,
  billingOrder: number,
): Promise<EventArtistRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_artists")
    .update({ is_headliner: isHeadliner, billing_order: billingOrder })
    .eq("event_id", eventId)
    .eq("artist_id", artistId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
