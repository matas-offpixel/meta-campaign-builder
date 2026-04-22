/**
 * lib/enrichment/artist-merger.ts
 *
 * Combines a Spotify artist + best-effort MusicBrainz hit into a
 * normalised ArtistEnrichmentCandidate. The merger is intentionally
 * pure (no I/O) so it's trivially unit-testable from fixtures.
 *
 * Spotify is treated as the primary source (canonical genres,
 * popularity, image). MusicBrainz fills in the social / external
 * links that Spotify doesn't expose (Instagram, Facebook, TikTok,
 * SoundCloud, Bandcamp, Beatport, official homepage). When both
 * agree on Spotify ID we prefer Spotify's; when they disagree we
 * trust Spotify and stash the MB-derived ID under
 * `profile_jsonb.musicbrainz.spotify_id` for debug.
 */

import type { SpotifyArtist } from "./spotify";
import type { MusicBrainzCandidate, MusicBrainzUrls } from "./musicbrainz";

export interface ArtistEnrichmentCandidate {
  // Identity
  name: string;
  spotify_id: string | null;
  musicbrainz_id: string | null;

  // Spotify-derived
  genres: string[];
  popularity_score: number | null;
  profile_image_url: string | null;

  // MusicBrainz-derived socials
  instagram_handle: string | null;
  facebook_page_url: string | null;
  tiktok_handle: string | null;
  soundcloud_url: string | null;
  beatport_url: string | null;
  bandcamp_url: string | null;
  website: string | null;

  // Raw merged blob — kept verbatim for debug + future fields without
  // requiring another migration. Shape:
  //   { spotify: SpotifyArtist | null, musicbrainz: { artist, urls } | null }
  profile_jsonb: Record<string, unknown>;
}

/**
 * Strip whitespace, lowercase, and remove non-alphanumeric chars.
 * "DJ Tennis (Live)" → "djtennislive". Used by name-match scoring
 * so "Sub Focus" and "sub-focus" collapse to the same key.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Standard Levenshtein distance (iterative, two-row variant). Cap
 * the input length defensively — a 200-char artist name is already
 * suspect and an O(n*m) blowup on adversarial input is not worth
 * handling.
 */
export function levenshtein(a: string, b: string): number {
  const aLen = Math.min(a.length, 256);
  const bLen = Math.min(b.length, 256);
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  let prev = new Array<number>(bLen + 1);
  let curr = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j += 1) prev[j] = j;
  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bLen];
}

/**
 * Best MB candidate for the given Spotify name. Returns the entry
 * with the smallest Levenshtein distance on normalised names, but
 * only if that distance is ≤ 3 — anything looser is too likely to
 * be a different artist with a similar name (e.g. "Sasha" the DJ
 * vs the dozens of other "Sasha"s on MB).
 */
export function pickBestMusicBrainzMatch(
  spotifyName: string,
  candidates: MusicBrainzCandidate[],
): MusicBrainzCandidate | null {
  if (candidates.length === 0) return null;
  const target = normaliseName(spotifyName);
  let best: { candidate: MusicBrainzCandidate; distance: number } | null = null;
  for (const c of candidates) {
    const distance = levenshtein(target, normaliseName(c.name));
    if (!best || distance < best.distance) {
      best = { candidate: c, distance };
    }
  }
  if (!best || best.distance > 3) return null;
  return best.candidate;
}

export function mergeArtistCandidate(
  spotify: SpotifyArtist,
  musicbrainz: { artist: MusicBrainzCandidate; urls: MusicBrainzUrls } | null,
): ArtistEnrichmentCandidate {
  const urls = musicbrainz?.urls ?? null;
  const profile_jsonb: Record<string, unknown> = {
    spotify: {
      id: spotify.id,
      name: spotify.name,
      genres: spotify.genres,
      popularity: spotify.popularity,
      followers: spotify.followers,
      external_url: spotify.external_url,
      image_url: spotify.image_url,
    },
    musicbrainz: musicbrainz
      ? {
          artist: musicbrainz.artist,
          urls: musicbrainz.urls,
        }
      : null,
  };
  return {
    name: spotify.name,
    spotify_id: spotify.id,
    musicbrainz_id: musicbrainz?.artist.id ?? null,
    genres: spotify.genres,
    popularity_score: spotify.popularity,
    profile_image_url: spotify.image_url,
    instagram_handle: urls?.instagram_handle ?? null,
    facebook_page_url: urls?.facebook_page_url ?? null,
    tiktok_handle: urls?.tiktok_handle ?? null,
    soundcloud_url: urls?.soundcloud_url ?? null,
    beatport_url: urls?.beatport_url ?? null,
    bandcamp_url: urls?.bandcamp_url ?? null,
    website: urls?.website ?? null,
    profile_jsonb,
  };
}
