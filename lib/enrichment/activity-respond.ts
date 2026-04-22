import "server-only";

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadEventContext,
  fetchNews,
  fetchReleases,
  fetchWeather,
  type ActivityErrors,
  type EventActivityContext,
  type NewsItem,
  type ReleasesByArtist,
  type WeatherSummary,
} from "@/lib/enrichment/event-activity";
import {
  readSnapshot,
  upsertSnapshot,
  type ActivitySource,
} from "@/lib/db/event-activity-snapshots";
import { SpotifyDisabledError } from "@/lib/enrichment/spotify";

/**
 * Shared respond() body for the activity GET / refresh routes.
 * Lives outside the route files so we don't export non-handler
 * symbols from a route module (Next.js disallows this).
 */

export const TTL_MS: Record<ActivitySource, number> = {
  google_news: 6 * 60 * 60 * 1000,
  spotify_releases: 24 * 60 * 60 * 1000,
  weather: 1 * 60 * 60 * 1000,
};

interface FetchedAt {
  google_news: string | null;
  spotify_releases: string | null;
  weather: string | null;
}

export interface ActivityResponseContext {
  has_artists: boolean;
  has_venue_coords: boolean;
  venue_id: string | null;
}

export interface ActivityResponse {
  ok: true;
  news: NewsItem[];
  releases: ReleasesByArtist[];
  weather: WeatherSummary | null;
  fetched_at: FetchedAt;
  context: ActivityResponseContext;
  errors?: ActivityErrors;
}

export async function respondActivity(
  eventId: string,
  opts: { force: boolean },
): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let ctx: EventActivityContext | null;
  try {
    ctx = await loadEventContext({ supabase, userId: user.id, eventId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load event";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
  if (!ctx) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }

  const errors: ActivityErrors = {};
  const fetched_at: FetchedAt = {
    google_news: null,
    spotify_releases: null,
    weather: null,
  };

  const [news, releases, weather] = await Promise.all([
    runSource<NewsItem[]>({
      supabase,
      userId: user.id,
      eventId,
      source: "google_news",
      force: opts.force,
      empty: [],
      live: () => fetchNews(ctx as EventActivityContext),
      onError: (m) => {
        errors.google_news = m;
      },
      onFetchedAt: (at) => {
        fetched_at.google_news = at;
      },
    }),
    runSource<ReleasesByArtist[]>({
      supabase,
      userId: user.id,
      eventId,
      source: "spotify_releases",
      force: opts.force,
      empty: [],
      live: () => fetchReleases(ctx as EventActivityContext),
      onError: (m) => {
        errors.spotify_releases = m;
      },
      onFetchedAt: (at) => {
        fetched_at.spotify_releases = at;
      },
    }),
    runSource<WeatherSummary | null>({
      supabase,
      userId: user.id,
      eventId,
      source: "weather",
      force: opts.force,
      empty: null,
      live: () => fetchWeather(ctx as EventActivityContext),
      onError: (m) => {
        errors.weather = m;
      },
      onFetchedAt: (at) => {
        fetched_at.weather = at;
      },
    }),
  ]);

  const body: ActivityResponse = {
    ok: true,
    news,
    releases,
    weather,
    fetched_at,
    context: {
      has_artists: ctx.artists.length > 0,
      has_venue_coords:
        ctx.venueLatitude != null && ctx.venueLongitude != null,
      venue_id: ctx.venueId,
    },
  };
  if (Object.keys(errors).length > 0) body.errors = errors;
  return NextResponse.json(body);
}

interface RunArgs<T> {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  eventId: string;
  source: ActivitySource;
  force: boolean;
  empty: T;
  live: () => Promise<T>;
  onError: (msg: string) => void;
  onFetchedAt: (iso: string | null) => void;
}

async function runSource<T>(args: RunArgs<T>): Promise<T> {
  const ttl = TTL_MS[args.source];
  const cached = await readSnapshot<T>({
    supabase: args.supabase,
    userId: args.userId,
    eventId: args.eventId,
    source: args.source,
  });

  if (!args.force && cached) {
    const ageMs = Date.now() - Date.parse(cached.fetched_at);
    if (Number.isFinite(ageMs) && ageMs < ttl) {
      args.onFetchedAt(cached.fetched_at);
      return cached.payload;
    }
  }

  try {
    const payload = await args.live();
    args.onFetchedAt(new Date().toISOString());
    await upsertSnapshot({
      supabase: args.supabase,
      userId: args.userId,
      eventId: args.eventId,
      source: args.source,
      payload,
    });
    return payload;
  } catch (err) {
    const msg =
      err instanceof SpotifyDisabledError
        ? "Spotify enrichment disabled (creds missing)."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    args.onError(msg);
    if (cached) {
      args.onFetchedAt(cached.fetched_at);
      return cached.payload;
    }
    args.onFetchedAt(null);
    return args.empty;
  }
}
