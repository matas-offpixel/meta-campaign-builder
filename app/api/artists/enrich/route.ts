import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { artistEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import { findArtistCandidates } from "@/lib/enrichment/artist-pipeline";
import { isSpotifyConfigured, SpotifyDisabledError } from "@/lib/enrichment/spotify";

/**
 * POST /api/artists/enrich
 *
 * Body: { q: string }
 *
 * Returns up to 5 ArtistEnrichmentCandidate rows blended from
 * Spotify + MusicBrainz so the UI can render selectable cards.
 *
 * 503 ARTIST_ENRICHMENT_DISABLED is returned when:
 *   - FEATURE_ARTIST_ENRICHMENT=false
 *   - SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are missing
 *
 * The disabled state is logged once per process from the spotify
 * module so we don't spam logs with one warn per request.
 */

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  if (!artistEnrichmentEnabled() || !isSpotifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ARTIST_ENRICHMENT_DISABLED" },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const q = typeof body.q === "string" ? body.q.trim() : "";
  if (!q) {
    return NextResponse.json(
      { ok: false, error: "`q` is required." },
      { status: 400 },
    );
  }

  try {
    const candidates = await findArtistCandidates(q, { limit: 5 });
    return NextResponse.json({ ok: true, candidates });
  } catch (err) {
    if (err instanceof SpotifyDisabledError) {
      return NextResponse.json(
        { ok: false, error: "ARTIST_ENRICHMENT_DISABLED" },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Enrichment failed";
    console.warn(`[api/artists/enrich] ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
