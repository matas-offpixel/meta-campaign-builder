import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createArtist, listArtists } from "@/lib/db/artists";
import type { Json } from "@/lib/db/database.types";

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

  // Optional enrichment fields — only persisted when present so a
  // bare {name,genres} POST keeps the original behaviour intact.
  const stringOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  const numberOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  try {
    const artist = await createArtist(user.id, {
      name,
      genres,
      meta_page_id: stringOrNull(body.meta_page_id),
      meta_page_name: stringOrNull(body.meta_page_name),
      instagram_handle: stringOrNull(body.instagram_handle),
      spotify_id: stringOrNull(body.spotify_id),
      website: stringOrNull(body.website),
      notes: stringOrNull(body.notes),
      musicbrainz_id: stringOrNull(body.musicbrainz_id),
      facebook_page_url: stringOrNull(body.facebook_page_url),
      tiktok_handle: stringOrNull(body.tiktok_handle),
      soundcloud_url: stringOrNull(body.soundcloud_url),
      beatport_url: stringOrNull(body.beatport_url),
      bandcamp_url: stringOrNull(body.bandcamp_url),
      profile_image_url: stringOrNull(body.profile_image_url),
      popularity_score: numberOrNull(body.popularity_score),
      ...(body.profile_jsonb && typeof body.profile_jsonb === "object"
        ? { profile_jsonb: body.profile_jsonb as unknown as Json }
        : {}),
    });
    return NextResponse.json({ ok: true, artist }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
