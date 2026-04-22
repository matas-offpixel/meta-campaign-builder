"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Newspaper,
  Music2,
  CloudSun,
  RefreshCw,
  AlertTriangle,
  MapPin,
  Disc3,
} from "lucide-react";

/**
 * components/dashboard/events/event-activity-panel.tsx
 *
 * "Activity" tab on the event detail page. Surfaces:
 *  - Recent news mentions of event / venue / client / artists
 *  - Each linked artist's Spotify releases (recent + upcoming)
 *  - Open-Meteo weather forecast at the venue lat/lng
 *
 * Data is fetched from /api/events/[id]/activity which TTL-caches
 * each source server-side. The "Refresh now" button hits
 * /activity/refresh to bypass the cache.
 */

interface NewsItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string;
}

interface ReleaseItem {
  id: string;
  name: string;
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  album_type: string;
  spotify_url: string | null;
  cover_url: string | null;
}

interface ReleasesByArtist {
  artist_id: string;
  artist_name: string;
  spotify_id: string | null;
  releases: ReleaseItem[];
}

interface WeatherSummary {
  temperature_c: { min: number | null; max: number | null; mean: number | null };
  precipitation_mm_or_probability: number | null;
  weather_code: number | null;
  is_forecast_or_climate: "forecast" | "climate";
  date: string;
}

interface FetchedAt {
  google_news: string | null;
  spotify_releases: string | null;
  weather: string | null;
}

interface ActivityResponse {
  ok: true;
  news: NewsItem[];
  releases: ReleasesByArtist[];
  weather: WeatherSummary | null;
  fetched_at: FetchedAt;
  context: {
    has_artists: boolean;
    has_venue_coords: boolean;
    venue_id: string | null;
  };
  errors?: {
    google_news?: string;
    spotify_releases?: string;
    weather?: string;
  };
}

interface Props {
  eventId: string;
}

export function EventActivityPanel({ eventId }: Props) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const load = useCallback(
    async (opts: { refresh: boolean }) => {
      try {
        if (opts.refresh) setRefreshing(true);
        else setLoading(true);
        setTopError(null);
        const res = await fetch(
          opts.refresh
            ? `/api/events/${eventId}/activity/refresh`
            : `/api/events/${eventId}/activity`,
          {
            method: opts.refresh ? "POST" : "GET",
            cache: "no-store",
          },
        );
        const j = (await res.json()) as ActivityResponse | { ok: false; error?: string };
        if (!res.ok || !("ok" in j) || !j.ok) {
          const msg = "error" in j && j.error ? j.error : `HTTP ${res.status}`;
          setTopError(msg);
          return;
        }
        setData(j);
      } catch (err) {
        setTopError(err instanceof Error ? err.message : "Failed to load activity");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    void load({ refresh: false });
  }, [load]);

  const oldestFetchedAt = useMemo(() => {
    if (!data) return null;
    const candidates = [
      data.fetched_at.google_news,
      data.fetched_at.spotify_releases,
      data.fetched_at.weather,
    ].filter((v): v is string => !!v);
    if (candidates.length === 0) return null;
    return candidates.reduce(
      (acc, v) => (Date.parse(v) < Date.parse(acc) ? v : acc),
      candidates[0],
    );
  }, [data]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base tracking-wide">
            Activity feed
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Press, releases, and weather for this event. Cached for short
            windows; press refresh for live data.
            {oldestFetchedAt && (
              <>
                {" · "}
                Last refreshed {formatRelative(oldestFetchedAt)}.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load({ refresh: true })}
          disabled={loading || refreshing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "Refreshing…" : "Refresh now"}
        </button>
      </header>

      {topError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{topError}</span>
        </div>
      )}

      <NewsCard
        loading={loading && !data}
        items={data?.news ?? []}
        error={data?.errors?.google_news ?? null}
        fetchedAt={data?.fetched_at.google_news ?? null}
      />

      <ReleasesCard
        loading={loading && !data}
        items={data?.releases ?? []}
        error={data?.errors?.spotify_releases ?? null}
        fetchedAt={data?.fetched_at.spotify_releases ?? null}
        hasArtists={data?.context.has_artists ?? true}
      />

      <WeatherCard
        loading={loading && !data}
        weather={data?.weather ?? null}
        error={data?.errors?.weather ?? null}
        fetchedAt={data?.fetched_at.weather ?? null}
        hasVenueCoords={data?.context.has_venue_coords ?? true}
        venueId={data?.context.venue_id ?? null}
      />
    </div>
  );
}

// ─── News ────────────────────────────────────────────────────────────────────

interface NewsCardProps {
  loading: boolean;
  items: NewsItem[];
  error: string | null;
  fetchedAt: string | null;
}

function NewsCard({ loading, items, error, fetchedAt }: NewsCardProps) {
  return (
    <Card
      title="Press mentions"
      icon={<Newspaper className="h-4 w-4 text-muted-foreground" />}
      sub={fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : null}
      error={error}
    >
      {loading ? (
        <SkeletonRows count={3} />
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No recent mentions found across the event, venue, client, or
          headline artists.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 8).map((n) => (
            <li key={n.url} className="flex items-start gap-3 py-2.5">
              <a
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group min-w-0 flex-1 text-sm"
              >
                <span className="block truncate font-medium underline-offset-2 group-hover:underline">
                  {n.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {n.source ?? "Unknown source"} · {formatRelative(n.publishedAt)}
                </span>
              </a>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Releases ────────────────────────────────────────────────────────────────

interface ReleasesCardProps {
  loading: boolean;
  items: ReleasesByArtist[];
  error: string | null;
  fetchedAt: string | null;
  hasArtists: boolean;
}

function ReleasesCard({
  loading,
  items,
  error,
  fetchedAt,
  hasArtists,
}: ReleasesCardProps) {
  // useState lazy initialiser is the React-sanctioned escape hatch
  // for reading from Date.now() without violating purity rules. We
  // bucket releases into past/upcoming based on this snapshot — the
  // exact second doesn't matter, day-precision does.
  const [now] = useState(() => Date.now());
  return (
    <Card
      title="Artist releases"
      icon={<Music2 className="h-4 w-4 text-muted-foreground" />}
      sub={fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : null}
      error={error}
    >
      {loading ? (
        <SkeletonRows count={3} />
      ) : !hasArtists ? (
        <p className="text-xs text-muted-foreground">
          Link artists on this event to see their recent and upcoming
          releases.
        </p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          None of the linked artists have a Spotify ID populated yet —
          enrich them from the Artists page to surface releases here.
        </p>
      ) : (
        <div className="space-y-5">
          {items.map((group) => {
            const past = group.releases
              .filter((r) => Date.parse(r.release_date) <= now)
              .slice(-3)
              .reverse();
            const upcoming = group.releases
              .filter((r) => Date.parse(r.release_date) > now)
              .slice(0, 3);

            return (
              <div key={group.artist_id}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">
                  {group.artist_name}
                  {group.spotify_id == null && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      (no Spotify ID)
                    </span>
                  )}
                </h3>
                {past.length === 0 && upcoming.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No releases in the last 90 / next 180 days.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    <ReleaseList label="Recent" items={past} />
                    <ReleaseList label="Upcoming" items={upcoming} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ReleaseList({ label, items }: { label: string; items: ReleaseItem[] }) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-md px-1 py-1 text-xs"
            >
              {r.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={r.cover_url}
                  alt=""
                  className="h-8 w-8 flex-shrink-0 rounded object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-muted">
                  <Disc3 className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-muted-foreground">
                  {formatReleaseDate(r)} · {r.album_type}
                </p>
              </div>
              {r.spotify_url && (
                <a
                  href={r.spotify_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  title="Open in Spotify"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Weather ─────────────────────────────────────────────────────────────────

interface WeatherCardProps {
  loading: boolean;
  weather: WeatherSummary | null;
  error: string | null;
  fetchedAt: string | null;
  hasVenueCoords: boolean;
  venueId: string | null;
}

function WeatherCard({
  loading,
  weather,
  error,
  fetchedAt,
  hasVenueCoords,
  venueId,
}: WeatherCardProps) {
  return (
    <Card
      title="Weather"
      icon={<CloudSun className="h-4 w-4 text-muted-foreground" />}
      sub={fetchedAt ? `Updated ${formatRelative(fetchedAt)}` : null}
      error={error}
    >
      {loading ? (
        <SkeletonRows count={1} />
      ) : !hasVenueCoords ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <p>
            No latitude / longitude on this event&apos;s venue.{" "}
            {venueId ? (
              <Link
                href={`/venues/${venueId}`}
                className="underline-offset-2 hover:underline"
              >
                Enrich the venue
              </Link>
            ) : (
              "Link a venue to this event to enable forecasts."
            )}{" "}
            for a forecast.
          </p>
        </div>
      ) : !weather ? (
        <p className="text-xs text-muted-foreground">
          No forecast available for this date — Open-Meteo couldn&apos;t
          return data for the requested coordinates.
        </p>
      ) : (
        <div className="flex items-end gap-6">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">
                {formatTemp(weather)}
              </span>
              <span className="text-xs text-muted-foreground">
                {weather.is_forecast_or_climate === "forecast"
                  ? "Forecast"
                  : "Climate estimate"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {describeWeatherCode(weather.weather_code)}
            </p>
          </div>
          {weather.precipitation_mm_or_probability != null && (
            <div className="text-xs">
              <p className="text-muted-foreground">
                {weather.is_forecast_or_climate === "forecast"
                  ? "Rain chance"
                  : "Total rainfall"}
              </p>
              <p className="text-sm font-medium tabular-nums">
                {weather.is_forecast_or_climate === "forecast"
                  ? `${Math.round(weather.precipitation_mm_or_probability)}%`
                  : `${weather.precipitation_mm_or_probability.toFixed(1)} mm`}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Shared chrome ───────────────────────────────────────────────────────────

interface CardProps {
  title: string;
  icon: React.ReactNode;
  sub?: string | null;
  error?: string | null;
  children: React.ReactNode;
}

function Card({ title, icon, sub, error, children }: CardProps) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {icon}
          <div>
            <h3 className="font-heading text-sm tracking-wide">{title}</h3>
            {sub && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {children}
    </section>
  );
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" />
      ))}
    </div>
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────

const RTF = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diffMin = Math.round((ts - Date.now()) / 60_000);
  const abs = Math.abs(diffMin);
  if (abs < 60) return RTF.format(diffMin, "minute");
  const diffH = Math.round(diffMin / 60);
  if (Math.abs(diffH) < 48) return RTF.format(diffH, "hour");
  const diffD = Math.round(diffH / 24);
  return RTF.format(diffD, "day");
}

function formatReleaseDate(r: ReleaseItem): string {
  const date = new Date(`${r.release_date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return r.release_date;
  if (r.release_date_precision === "year") {
    return date.toLocaleDateString("en-GB", { year: "numeric" });
  }
  if (r.release_date_precision === "month") {
    return date.toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
    });
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTemp(w: WeatherSummary): string {
  // Forecast: show min / max range. Climate: show mean as the only signal.
  if (w.is_forecast_or_climate === "forecast") {
    const min = w.temperature_c.min;
    const max = w.temperature_c.max;
    if (min == null && max == null) return "—";
    if (min != null && max != null) {
      return `${Math.round(min)}° / ${Math.round(max)}°C`;
    }
    return `${Math.round((min ?? max) as number)}°C`;
  }
  const mean = w.temperature_c.mean;
  return mean != null ? `${Math.round(mean)}°C` : "—";
}

function describeWeatherCode(code: number | null): string {
  // WMO weather code (Open-Meteo). We pick the broadest band that's
  // still meaningful at a glance — fine-grained codes are nice to
  // have but not worth the table.
  if (code == null) return "—";
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 49) return "Fog";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Showers";
  if (code <= 99) return "Thunderstorm";
  return `Code ${code}`;
}
