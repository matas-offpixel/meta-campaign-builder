import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { artistEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import { isSpotifyConfigured } from "@/lib/enrichment/spotify";

/**
 * GET /api/artists/enrichment-health
 *
 * Used by the artists UI to decide whether to render the "Search
 * Spotify & MusicBrainz" panel. Cheap probe — no external calls,
 * just reads env vars and the feature flag.
 *
 * MusicBrainz needs no key, so it's reported as "ok" whenever the
 * feature flag is on. Real outages surface as `error` later when
 * the route actually fetches; the UI only uses this to gate render
 * not to make routing decisions.
 */

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const flagOn = artistEnrichmentEnabled();
  const spotifyConfigured = isSpotifyConfigured();
  return NextResponse.json({
    ok: true,
    enabled: flagOn && spotifyConfigured,
    flag: flagOn,
    spotify: spotifyConfigured ? "ok" : "missing_creds",
    musicbrainz: "ok",
  });
}
