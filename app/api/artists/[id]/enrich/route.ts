import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getArtist, updateArtist } from "@/lib/db/artists";
import { artistEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import { enrichExistingArtist } from "@/lib/enrichment/artist-pipeline";
import { isSpotifyConfigured, SpotifyDisabledError } from "@/lib/enrichment/spotify";
import type { ArtistUpdate } from "@/lib/db/artists";
import type { Json } from "@/lib/db/database.types";

/**
 * POST /api/artists/[id]/enrich
 *
 * Re-enriches the artist row from Spotify (and best-effort MB),
 * then writes the merged candidate back to the row + sets
 * `enriched_at = now()`. Returns the updated row.
 *
 * Existing manual fields stay sticky: we never overwrite a non-null
 * `meta_page_id` / `meta_page_name` (Matas types those by hand) and
 * we only fill `genres` if the row's current array is empty — Matas
 * curates a small set of in-house genres separately from Spotify's
 * (often noisier) tags.
 */

export const runtime = "nodejs";

// `profile_jsonb` is typed as the recursive `Json` alias on the DB
// row; we keep a Record<string, unknown> in the merger and cast at
// the persistence boundary. The cast is safe because every value we
// put in profile_jsonb is JSON.stringify-friendly by construction.
type ArtistMetaUpdate = ArtistUpdate;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const artist = await getArtist(id);
  if (!artist) {
    return NextResponse.json({ ok: false, error: "Artist not found" }, { status: 404 });
  }
  if (artist.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!artistEnrichmentEnabled() || !isSpotifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ARTIST_ENRICHMENT_DISABLED" },
      { status: 503 },
    );
  }

  try {
    const candidate = await enrichExistingArtist({
      name: artist.name,
      spotifyId: artist.spotify_id,
    });
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "No Spotify match for this artist." },
        { status: 404 },
      );
    }

    // Sticky-merge: keep manual values where they exist. Never
    // overwrite Matas-typed Meta page IDs or instagram handles, and
    // only fill genres if the row currently has none (Spotify's
    // genre tagging is noisier than the in-house list).
    const patch: ArtistMetaUpdate = {
      spotify_id: artist.spotify_id ?? candidate.spotify_id,
      musicbrainz_id: artist.musicbrainz_id ?? candidate.musicbrainz_id,
      popularity_score: candidate.popularity_score,
      profile_image_url: artist.profile_image_url ?? candidate.profile_image_url,
      instagram_handle: artist.instagram_handle ?? candidate.instagram_handle,
      facebook_page_url: artist.facebook_page_url ?? candidate.facebook_page_url,
      tiktok_handle: artist.tiktok_handle ?? candidate.tiktok_handle,
      soundcloud_url: artist.soundcloud_url ?? candidate.soundcloud_url,
      beatport_url: artist.beatport_url ?? candidate.beatport_url,
      bandcamp_url: artist.bandcamp_url ?? candidate.bandcamp_url,
      website: artist.website ?? candidate.website,
      profile_jsonb: candidate.profile_jsonb as unknown as Json,
      enriched_at: new Date().toISOString(),
    };
    if ((artist.genres ?? []).length === 0 && candidate.genres.length > 0) {
      patch.genres = candidate.genres;
    }

    const updated = await updateArtist(id, patch);
    return NextResponse.json({ ok: true, artist: updated });
  } catch (err) {
    if (err instanceof SpotifyDisabledError) {
      return NextResponse.json(
        { ok: false, error: "ARTIST_ENRICHMENT_DISABLED" },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Enrichment failed";
    console.warn(`[api/artists/${id}/enrich] ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
