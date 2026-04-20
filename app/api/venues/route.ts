import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createVenue, listVenues } from "@/lib/db/venues";

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

  try {
    const venue = await createVenue(user.id, {
      name,
      city,
      country: typeof body.country === "string" ? body.country : "GB",
      capacity:
        typeof body.capacity === "number"
          ? body.capacity
          : body.capacity === null
            ? null
            : null,
      address: typeof body.address === "string" ? body.address : null,
      meta_page_id:
        typeof body.meta_page_id === "string" ? body.meta_page_id : null,
      meta_page_name:
        typeof body.meta_page_name === "string" ? body.meta_page_name : null,
      website: typeof body.website === "string" ? body.website : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, venue }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create venue.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
