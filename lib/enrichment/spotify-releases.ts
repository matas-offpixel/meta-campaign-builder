import "server-only";

/**
 * lib/enrichment/spotify-releases.ts
 *
 * Recent + upcoming releases for a given Spotify artist. Reuses the
 * client-credentials token cache from lib/enrichment/spotify.ts (so
 * we don't hit Spotify's token endpoint twice per render).
 *
 * Filtering: Spotify's `/artists/{id}/albums` returns the artist's
 * full back catalogue ordered by release date desc. We trim to the
 * requested window after fetching — there's no `since`/`until`
 * parameter on the endpoint and 20 albums is plenty for the artists
 * we'd ever surface in an event preview.
 */

import { getAppToken, SpotifyDisabledError } from "./spotify";

const SPOTIFY_API = "https://api.spotify.com/v1";

export interface ReleaseItem {
  id: string;
  name: string;
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  album_type: string;
  spotify_url: string | null;
  cover_url: string | null;
}

interface RawAlbum {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  external_urls?: { spotify?: string };
  images?: { url: string; width?: number; height?: number }[];
}

function pickCover(images: RawAlbum["images"]): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort(
    (a, b) => (b.width ?? 0) - (a.width ?? 0),
  );
  const preferred = sorted.find((i) => (i.width ?? 0) <= 300) ?? sorted[0];
  return preferred?.url ?? null;
}

function parseReleaseDate(album: RawAlbum): number {
  // Coarse precision (year / year-month) → assume Jan 1 / 1st of month.
  const raw = album.release_date;
  if (album.release_date_precision === "year") {
    return Date.parse(`${raw}-01-01`);
  }
  if (album.release_date_precision === "month") {
    return Date.parse(`${raw}-01`);
  }
  return Date.parse(raw);
}

export { SpotifyDisabledError };

export async function getRecentReleases(
  artistId: string,
  opts: { lookbackDays?: number; lookaheadDays?: number; market?: string } = {},
): Promise<ReleaseItem[]> {
  const id = artistId.trim();
  if (!id) return [];
  const lookbackDays = Math.max(opts.lookbackDays ?? 90, 1);
  const lookaheadDays = Math.max(opts.lookaheadDays ?? 180, 1);
  const market = opts.market ?? "GB";

  const token = await getAppToken();
  const url = new URL(`${SPOTIFY_API}/artists/${encodeURIComponent(id)}/albums`);
  url.searchParams.set("include_groups", "album,single");
  url.searchParams.set("limit", "20");
  url.searchParams.set("market", market);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Spotify /artists/{id}/albums failed: HTTP ${res.status} ${text.slice(0, 200)}`,
    );
  }
  const j = (await res.json()) as { items?: RawAlbum[] };
  const items = j.items ?? [];

  const now = Date.now();
  const minTs = now - lookbackDays * 86_400_000;
  const maxTs = now + lookaheadDays * 86_400_000;
  const filtered = items
    .filter((a) => {
      const ts = parseReleaseDate(a);
      return !Number.isNaN(ts) && ts >= minTs && ts <= maxTs;
    })
    .map<ReleaseItem>((a) => ({
      id: a.id,
      name: a.name,
      release_date: a.release_date,
      release_date_precision: a.release_date_precision,
      album_type: a.album_type,
      spotify_url: a.external_urls?.spotify ?? null,
      cover_url: pickCover(a.images),
    }))
    .sort((a, b) => parseReleaseDate(a as unknown as RawAlbum) - parseReleaseDate(b as unknown as RawAlbum));

  return filtered;
}
