import "server-only";

/**
 * lib/enrichment/artist-pipeline.ts
 *
 * Orchestrates the Spotify → MusicBrainz → merger pipeline used by
 * both /api/artists/enrich (search-by-name) and
 * /api/artists/[id]/enrich (re-enrich an existing record). Kept
 * separate from the route handlers so both call sites share the same
 * fan-out + matching rules.
 */

import { searchArtists as spotifySearch, getArtist as spotifyGetArtist } from "./spotify";
import {
  searchArtists as mbSearch,
  getArtistWithUrls as mbGetArtistWithUrls,
  type MusicBrainzCandidate,
  type MusicBrainzUrls,
} from "./musicbrainz";
import {
  mergeArtistCandidate,
  pickBestMusicBrainzMatch,
  type ArtistEnrichmentCandidate,
} from "./artist-merger";

/**
 * Resolve up to N enrichment candidates from a free-text query.
 * Pipeline:
 *  1. Spotify search → top 5 artists.
 *  2. For the top 3 (parallelised), MusicBrainz search → best
 *     name match → MB detail with url-rels.
 *  3. Merge each Spotify result with its MB hit (if any). The
 *     remaining (4th, 5th) Spotify-only results are still returned
 *     so the user has more rows to pick from when MB is patchy.
 */
export async function findArtistCandidates(
  q: string,
  options: { limit?: number } = {},
): Promise<ArtistEnrichmentCandidate[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 5);
  const spotifyResults = await spotifySearch(trimmed, { limit });
  if (spotifyResults.length === 0) return [];

  // Cap MB enrichment at the top 3 to stay well under MB's 1 req/sec
  // limit on a single user click. The 4th + 5th Spotify results
  // surface as Spotify-only candidates so Matas still has options.
  const mbEligible = spotifyResults.slice(0, 3);
  const mbHits = await Promise.all(
    mbEligible.map(async (sp) => {
      try {
        const hits = await mbSearch(sp.name, { limit: 5 });
        const best = pickBestMusicBrainzMatch(sp.name, hits);
        if (!best) return null;
        const detail = await mbGetArtistWithUrls(best.id);
        return detail;
      } catch (err) {
        // MB failures are common (rate-limit, transient 503) and
        // never worth failing the whole search over — fall back to
        // Spotify-only for this candidate.
        console.warn(
          `[artist-pipeline] MusicBrainz lookup failed for "${sp.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }),
  );

  const merged: ArtistEnrichmentCandidate[] = spotifyResults.map((sp, idx) => {
    const mb = idx < mbHits.length ? mbHits[idx] : null;
    return mergeArtistCandidate(sp, mb);
  });
  return merged;
}

/**
 * Re-enrich an existing artist row. If `spotifyId` is known we go
 * straight to /artists/{id}; otherwise fall back to a search by
 * name. MB enrichment runs the same way as in `findArtistCandidates`.
 */
export async function enrichExistingArtist(
  args: { name: string; spotifyId: string | null },
): Promise<ArtistEnrichmentCandidate | null> {
  const spotifyArtist = args.spotifyId
    ? (await spotifyGetArtist(args.spotifyId).catch(() => null)) ??
      (await spotifySearch(args.name, { limit: 1 }).then((arr) => arr[0] ?? null))
    : (await spotifySearch(args.name, { limit: 1 }).then((arr) => arr[0] ?? null));

  if (!spotifyArtist) return null;

  let mbDetail: { artist: MusicBrainzCandidate; urls: MusicBrainzUrls } | null = null;
  try {
    const hits = await mbSearch(spotifyArtist.name, { limit: 5 });
    const best = pickBestMusicBrainzMatch(spotifyArtist.name, hits);
    if (best) mbDetail = await mbGetArtistWithUrls(best.id);
  } catch (err) {
    console.warn(
      `[artist-pipeline] MusicBrainz re-enrich failed for "${spotifyArtist.name}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return mergeArtistCandidate(spotifyArtist, mbDetail);
}
