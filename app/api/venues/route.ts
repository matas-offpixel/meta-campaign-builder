import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createVenue, listVenues } from "@/lib/db/venues";
import type { Json } from "@/lib/db/database.types";

/**
 * GET /api/venues — list every venue the signed-in user owns.
 * POST /api/venues — create a new venue. Required: name, city.
 *
 * RLS bounds the read; the auth check below short-circuits unauth'd traffic
 * so we don't hit Supabase for nothing.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const venues = await listVenues(user.id);
  return NextResponse.json({ ok: true, venues });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
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

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  if (!name || !city) {
    return NextResponse.json(
      { ok: false, error: "Both `name` and `city` are required." },
      { status: 400 },
    );
  }

  // Optional enrichment fields — only persisted when present so a
  // bare {name,city} POST keeps the original behaviour intact.
  const stringOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  const numberOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  try {
    const venue = await createVenue(user.id, {
      name,
      city,
      country: typeof body.country === "string" ? body.country : "GB",
      capacity: numberOrNull(body.capacity),
      address: stringOrNull(body.address),
      meta_page_id: stringOrNull(body.meta_page_id),
      meta_page_name: stringOrNull(body.meta_page_name),
      website: stringOrNull(body.website),
      notes: stringOrNull(body.notes),
      google_place_id: stringOrNull(body.google_place_id),
      latitude: numberOrNull(body.latitude),
      longitude: numberOrNull(body.longitude),
      phone: stringOrNull(body.phone),
      address_full: stringOrNull(body.address_full),
      google_maps_url: stringOrNull(body.google_maps_url),
      rating: numberOrNull(body.rating),
      user_ratings_total: numberOrNull(body.user_ratings_total),
      photo_reference: stringOrNull(body.photo_reference),
      ...(body.profile_jsonb && typeof body.profile_jsonb === "object"
        ? { profile_jsonb: body.profile_jsonb as unknown as Json }
        : {}),
    });
    return NextResponse.json({ ok: true, venue }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create venue.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
