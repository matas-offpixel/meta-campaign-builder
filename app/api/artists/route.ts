import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createArtist, listArtists } from "@/lib/db/artists";

/**
 * GET  /api/artists?genre=Techno  list every artist; optional genre filter
 *      uses Postgres array contains (`cs.{Techno}`).
 * POST /api/artists                create a new artist; required: name.
 */

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const genre = req.nextUrl.searchParams.get("genre")?.trim() || undefined;
  const artists = await listArtists(user.id, genre ? { genre } : undefined);
  return NextResponse.json({ ok: true, artists });
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
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "`name` is required." },
      { status: 400 },
    );
  }

  const genres = Array.isArray(body.genres)
    ? (body.genres as unknown[]).filter((g): g is string => typeof g === "string")
    : [];

  try {
    const artist = await createArtist(user.id, {
      name,
      genres,
      meta_page_id:
        typeof body.meta_page_id === "string" ? body.meta_page_id : null,
      meta_page_name:
        typeof body.meta_page_name === "string" ? body.meta_page_name : null,
      instagram_handle:
        typeof body.instagram_handle === "string"
          ? body.instagram_handle
          : null,
      spotify_id: typeof body.spotify_id === "string" ? body.spotify_id : null,
      website: typeof body.website === "string" ? body.website : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return NextResponse.json({ ok: true, artist }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
