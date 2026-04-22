import "server-only";

/**
 * lib/enrichment/event-activity.ts
 *
 * Orchestration layer for the per-event activity panel. Pulls
 * - Google News mentions (RSS, no key)
 * - Spotify recent + upcoming releases per linked artist
 * - Open-Meteo weather forecast at the venue lat/lng
 *
 * Each source is wrapped in its own try / catch so a single failure
 * doesn't 500 the whole panel — the response always carries partial
 * data + an `errors` map keyed by source.
 *
 * TTL semantics live in the route handlers; this module is pure
 * "fetch once, normalise" logic so the route can decide when to use
 * the cache vs invalidate it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

import { searchNews, type NewsItem } from "./google-news";
import {
  getRecentReleases,
  type ReleaseItem,
  SpotifyDisabledError,
} from "./spotify-releases";
import { getForecast, type WeatherSummary } from "./weather";

export type { NewsItem, ReleaseItem, WeatherSummary };

export interface EventActivityArtist {
  artist_id: string;
  name: string;
  spotify_id: string | null;
  billing_order: number;
}

export interface EventActivityContext {
  eventId: string;
  eventName: string;
  eventDate: string | null;
  venueId: string | null;
  venueName: string | null;
  venueCity: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  clientName: string | null;
  artists: EventActivityArtist[];
}

export interface ReleasesByArtist {
  artist_id: string;
  artist_name: string;
  spotify_id: string | null;
  releases: ReleaseItem[];
}

export interface ActivityErrors {
  google_news?: string;
  spotify_releases?: string;
  weather?: string;
}

const NEWS_QUERY_CHAR_BUDGET = 400;

/** Compose the Google News query string (defensive about missing parts). */
export function composeNewsQuery(ctx: EventActivityContext): string {
  const parts: string[] = [];
  const push = (raw: string | null | undefined) => {
    const v = (raw ?? "").trim();
    if (v) parts.push(`"${v.replace(/"/g, "")}"`);
  };
  push(ctx.eventName);
  push(ctx.venueName);
  push(ctx.clientName);

  // Trim the artist list to fit within the char budget. Sorted by
  // billing_order ascending — headliners win.
  const artistTerms = [...ctx.artists]
    .sort((a, b) => a.billing_order - b.billing_order)
    .slice(0, 3)
    .map((a) => (a.name ?? "").trim())
    .filter((n) => n.length > 0)
    .map((n) => `"${n.replace(/"/g, "")}"`);

  let query = parts.join(" OR ");
  for (const term of artistTerms) {
    const candidate = query ? `${query} OR ${term}` : term;
    if (candidate.length > NEWS_QUERY_CHAR_BUDGET) break;
    query = candidate;
  }
  return query;
}

export async function fetchNews(ctx: EventActivityContext): Promise<NewsItem[]> {
  const q = composeNewsQuery(ctx);
  if (!q) return [];
  return await searchNews(q, { lookbackDays: 30, limit: 10 });
}

export async function fetchReleases(
  ctx: EventActivityContext,
): Promise<ReleasesByArtist[]> {
  const artistsWithSpotify = ctx.artists.filter((a) => !!a.spotify_id);
  if (artistsWithSpotify.length === 0) return [];

  // Fan out — each artist is one Spotify call, all share the cached
  // bearer in lib/enrichment/spotify.ts so token rotation is amortised.
  const results = await Promise.all(
    artistsWithSpotify.map(async (a) => {
      try {
        const releases = await getRecentReleases(a.spotify_id as string, {
          lookbackDays: 90,
          lookaheadDays: 180,
        });
        return {
          artist_id: a.artist_id,
          artist_name: a.name,
          spotify_id: a.spotify_id,
          releases,
        } satisfies ReleasesByArtist;
      } catch (err) {
        // SpotifyDisabledError bubbles up so the route can map it; any
        // other per-artist error becomes a row with no releases so the
        // UI still labels them.
        if (err instanceof SpotifyDisabledError) throw err;
        console.warn(
          `[event-activity] releases failed for artist=${a.artist_id}:`,
          err,
        );
        return {
          artist_id: a.artist_id,
          artist_name: a.name,
          spotify_id: a.spotify_id,
          releases: [],
        } satisfies ReleasesByArtist;
      }
    }),
  );
  return results;
}

export async function fetchWeather(
  ctx: EventActivityContext,
): Promise<WeatherSummary | null> {
  if (
    ctx.venueLatitude == null ||
    ctx.venueLongitude == null ||
    !ctx.eventDate
  ) {
    return null;
  }
  return await getForecast({
    lat: ctx.venueLatitude,
    lng: ctx.venueLongitude,
    date: ctx.eventDate,
  });
}

/**
 * Pull the event + venue + linked-artist context the activity panel
 * needs. Returns null if the event isn't owned by the caller.
 *
 * Data sourcing:
 * - events row gives us name / event_date / venue_id / client_id
 * - clients row (one extra round-trip) gives us the client name
 * - venues row (skipped if venue_id is null) gives us lat/lng + name
 * - event_artists join gives us linked artists; we then look up
 *   spotify_id on each artist row in one IN-list call.
 */
export async function loadEventContext(args: {
  supabase: SupabaseClient<Database>;
  userId: string;
  eventId: string;
}): Promise<EventActivityContext | null> {
  const { supabase, userId, eventId } = args;

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, name, event_date, venue_id, venue_name, venue_city, client_id, user_id",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) throw new Error(eventErr.message);
  if (!event || event.user_id !== userId) return null;

  // Client name — one cheap lookup.
  let clientName: string | null = null;
  if (event.client_id) {
    const { data: client } = await supabase
      .from("clients")
      .select("name")
      .eq("id", event.client_id)
      .maybeSingle();
    clientName = (client?.name as string | null) ?? null;
  }

  // Venue lat/lng (post-Task-B). Falls back gracefully if Task B
  // hasn't merged yet — `latitude`/`longitude` columns may not exist
  // and the .select() will error; we wrap in try/catch.
  let venueLat: number | null = null;
  let venueLng: number | null = null;
  let venueName: string | null = event.venue_name ?? null;
  if (event.venue_id) {
    try {
      const { data: venue } = await supabase
        .from("venues")
        .select("name, latitude, longitude")
        .eq("id", event.venue_id)
        .maybeSingle();
      if (venue) {
        venueName = (venue.name as string | null) ?? venueName;
        venueLat = (venue.latitude as number | null) ?? null;
        venueLng = (venue.longitude as number | null) ?? null;
      }
    } catch (err) {
      console.warn("[event-activity] venue lookup failed:", err);
    }
  }

  // Linked artists with spotify_id — one round-trip via the join.
  const artists: EventActivityArtist[] = [];
  const { data: ea } = await supabase
    .from("event_artists")
    .select(
      "artist_id, billing_order, artist:artists ( name, spotify_id )",
    )
    .eq("event_id", eventId)
    .order("billing_order", { ascending: true });
  for (const row of ea ?? []) {
    type ArtistEmbed = { name: string | null; spotify_id: string | null };
    const rel = row.artist as ArtistEmbed | ArtistEmbed[] | null;
    const artist = Array.isArray(rel) ? rel[0] ?? null : rel;
    artists.push({
      artist_id: row.artist_id as string,
      name: (artist?.name as string | null) ?? "(unknown)",
      spotify_id: (artist?.spotify_id as string | null) ?? null,
      billing_order: (row.billing_order as number | null) ?? 0,
    });
  }

  return {
    eventId: event.id as string,
    eventName: (event.name as string) ?? "",
    eventDate: (event.event_date as string | null) ?? null,
    venueId: (event.venue_id as string | null) ?? null,
    venueName,
    venueCity: (event.venue_city as string | null) ?? null,
    venueLatitude: venueLat,
    venueLongitude: venueLng,
    clientName,
    artists,
  };
}
