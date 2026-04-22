import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { venueEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import { isGooglePlacesConfigured } from "@/lib/enrichment/google-places";

/**
 * GET /api/venues/enrichment-health
 *
 * Cheap probe used by the venues UI to decide whether to render the
 * "Search Google Places" panel. No external calls — just env + flag.
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

  const flagOn = venueEnrichmentEnabled();
  const placesConfigured = isGooglePlacesConfigured();
  return NextResponse.json({
    ok: true,
    enabled: flagOn && placesConfigured,
    flag: flagOn,
    places: placesConfigured ? "ok" : "missing_key",
  });
}
