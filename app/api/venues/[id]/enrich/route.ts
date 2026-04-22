import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getVenue, updateVenue, type VenueUpdate } from "@/lib/db/venues";
import { venueEnrichmentEnabled } from "@/lib/enrichment/feature-flag";
import {
  getPlaceDetails,
  isGooglePlacesConfigured,
  PlacesDisabledError,
  searchText,
} from "@/lib/enrichment/google-places";
import type { Json } from "@/lib/db/database.types";

/**
 * POST /api/venues/[id]/enrich
 *
 * Re-enriches a venue row from Google Places. If the row already
 * has a `google_place_id`, hits /places/{id} directly (one cheap
 * call); otherwise falls back to a textSearch with `name + city` to
 * find the place. Sticky-merge: never overwrites manually-typed
 * Meta page IDs / capacity / notes.
 */

export const runtime = "nodejs";

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

  const venue = await getVenue(id);
  if (!venue) {
    return NextResponse.json({ ok: false, error: "Venue not found" }, { status: 404 });
  }
  if (venue.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!venueEnrichmentEnabled() || !isGooglePlacesConfigured()) {
    return NextResponse.json(
      { ok: false, error: "VENUE_ENRICHMENT_DISABLED" },
      { status: 503 },
    );
  }

  try {
    let candidate =
      venue.google_place_id
        ? await getPlaceDetails(venue.google_place_id)
        : null;

    if (!candidate) {
      // Either the row had no place ID or the saved one no longer
      // resolves; fall back to a name + city search and take the
      // top hit.
      const q = [venue.name, venue.city].filter(Boolean).join(" ");
      const results = await searchText({ q, limit: 1 });
      candidate = results[0] ?? null;
    }
    if (!candidate) {
      return NextResponse.json(
        { ok: false, error: "No Google Places match for this venue." },
        { status: 404 },
      );
    }

    const patch: VenueUpdate = {
      google_place_id: candidate.id || venue.google_place_id,
      latitude: candidate.latitude ?? venue.latitude,
      longitude: candidate.longitude ?? venue.longitude,
      phone: venue.phone ?? candidate.phone,
      address_full: venue.address_full ?? candidate.address_full,
      google_maps_url: candidate.google_maps_url ?? venue.google_maps_url,
      rating: candidate.rating ?? venue.rating,
      user_ratings_total:
        candidate.user_ratings_total ?? venue.user_ratings_total,
      photo_reference: candidate.photo_reference ?? venue.photo_reference,
      website: venue.website ?? candidate.website,
      // Refresh rating data fully (it's the whole point of re-enrich)
      // by always overwriting profile_jsonb. Manual-only fields
      // (name/city/capacity/notes) stay untouched.
      profile_jsonb: candidate.raw as unknown as Json,
      enriched_at: new Date().toISOString(),
    };
    const updated = await updateVenue(id, patch);
    return NextResponse.json({ ok: true, venue: updated });
  } catch (err) {
    if (err instanceof PlacesDisabledError) {
      return NextResponse.json(
        { ok: false, error: "VENUE_ENRICHMENT_DISABLED" },
        { status: 503 },
      );
    }
    const msg = err instanceof Error ? err.message : "Enrichment failed";
    console.warn(`[api/venues/${id}/enrich] ${msg}`);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
