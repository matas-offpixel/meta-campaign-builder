import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { venueEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import {
  isGooglePlacesConfigured,
  PlacesDisabledError,
  searchText,
  type PlacesLocationBias,
} from "@/lib/enrichment/google-places";

/**
 * POST /api/venues/enrich
 *
 * Body: { q: string, locationBias?: PlacesLocationBias }
 *
 * Calls Google Places (New) :searchText with a UK rectangle bias by
 * default. Returns up to 5 normalised candidates the UI renders as
 * selectable cards. Disabled state surfaces as 503
 * VENUE_ENRICHMENT_DISABLED so the UI can hide the search panel.
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

  if (!venueEnrichmentEnabled() || !isGooglePlacesConfigured()) {
    return NextResponse.json(
      { ok: false, error: "VENUE_ENRICHMENT_DISABLED" },
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

  const locationBias =
    body.locationBias && typeof body.locationBias === "object"
      ? (body.locationBias as PlacesLocationBias)
      : undefined;

  try {
    const candidates = await searchText({ q, locationBias, limit: 5 });
    return NextResponse.json({ ok: true, candidates });
  } catch (err) {
    if (err instanceof PlacesDisabledError) {
      return NextResponse.json(
        { ok: false, error: "VENUE_ENRICHMENT_DISABLED" },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Enrichment failed";
    console.warn(`[api/venues/enrich] ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
