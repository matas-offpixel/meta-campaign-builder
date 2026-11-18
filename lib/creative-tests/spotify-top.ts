/**
 * CT3: Spotify's top tracks for an act, up to 10, in Spotify's order, never
 * re-sorted. Read once a day per act (spotify_top_tracks_cache, migration
 * 255). Spotify is read for the list of tracks only: nothing here downloads
 * audio or reads a preview (CT2).
 *
 * When Spotify doesn't answer (no credentials, an error, no Spotify id on the
 * act), the picker says so and lists the Drive files (CT3). A stale cache row
 * is still used when the fresh read fails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SNIPPET, type TopTrack } from "./snippet.ts";

type Db = Pick<SupabaseClient, "from">;

export const SPOTIFY_MARKET = "GB";

export type TopTracksRead = { ok: true; tracks: TopTrack[]; fetchedAt: string; cached: boolean } | { ok: false; reason: string };

export type SpotifyFetch = (spotifyArtistId: string, market: string) => Promise<{ id: string; name: string }[]>;

/** GET /v1/artists/{id}/top-tracks?market=GB, through the app's client-credentials token. */
export const fetchTopTracks: SpotifyFetch = async (spotifyArtistId, market) => {
  const { getAppToken } = await import("../enrichment/spotify.ts");
  const token = await getAppToken();
  const res = await fetch(`https://api.spotify.com/v1/artists/${encodeURIComponent(spotifyArtistId)}/top-tracks?market=${encodeURIComponent(market)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Spotify top tracks: HTTP ${res.status}`);
  const json = (await res.json()) as { tracks?: { id?: string; name?: string }[] };
  return (json.tracks ?? []).filter((t): t is { id: string; name: string } => Boolean(t.id && t.name));
};

/** Spotify's order, first 10, ranked from 1. */
export function rankTracks(raw: readonly { id: string; name: string }[]): TopTrack[] {
  return raw.slice(0, SNIPPET.topTracks).map((t, i) => ({ id: t.id, title: t.name, rank: i + 1 }));
}

export function isFresh(fetchedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(fetchedAt) < SNIPPET.spotifyCacheMs;
}

export async function readTopTracks(
  db: Db,
  input: { artistId: string; spotifyArtistId: string | null; userId: string },
  deps: { fetch?: SpotifyFetch; now?: Date } = {},
): Promise<TopTracksRead> {
  const now = deps.now ?? new Date();
  const cached = await db.from("spotify_top_tracks_cache").select("tracks, fetched_at").eq("artist_id", input.artistId).eq("market", SPOTIFY_MARKET).maybeSingle();
  if (cached.error) throw new Error(`spotify_top_tracks_cache: ${cached.error.message}`);
  const row = cached.data as { tracks: TopTrack[]; fetched_at: string } | null;
  if (row && isFresh(row.fetched_at, now)) return { ok: true, tracks: row.tracks, fetchedAt: row.fetched_at, cached: true };
  if (!input.spotifyArtistId) return row ? { ok: true, tracks: row.tracks, fetchedAt: row.fetched_at, cached: true } : { ok: false, reason: "no_spotify_id" };
  try {
    const tracks = rankTracks(await (deps.fetch ?? fetchTopTracks)(input.spotifyArtistId, SPOTIFY_MARKET));
    const fetchedAt = now.toISOString();
    const write = await db
      .from("spotify_top_tracks_cache")
      .upsert({ artist_id: input.artistId, market: SPOTIFY_MARKET, user_id: input.userId, tracks, fetched_at: fetchedAt }, { onConflict: "artist_id,market" });
    if (write.error) throw new Error(`spotify_top_tracks_cache: ${write.error.message}`);
    return { ok: true, tracks, fetchedAt, cached: false };
  } catch (err) {
    if (row) return { ok: true, tracks: row.tracks, fetchedAt: row.fetched_at, cached: true };
    return { ok: false, reason: err instanceof Error ? err.message.slice(0, 200) : "spotify_error" };
  }
}
