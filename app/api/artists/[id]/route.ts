import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteArtist,
  getArtist,
  updateArtist,
  type ArtistUpdate,
} from "@/lib/db/artists";

const PATCH_FIELDS: Array<keyof ArtistUpdate> = [
  "name",
  "genres",
  "meta_page_id",
  "meta_page_name",
  "instagram_handle",
  "spotify_id",
  "website",
  "notes",
];

function buildPatch(body: Record<string, unknown>): ArtistUpdate {
  const patch: Record<string, unknown> = {};
  for (const k of PATCH_FIELDS) {
    if (k in body) patch[k] = body[k];
  }
  return patch as ArtistUpdate;
}

async function ensureOwner(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }) };
  }
  const artist = await getArtist(id);
  if (!artist) {
    return { error: NextResponse.json({ ok: false, error: "Artist not found" }, { status: 404 }) };
  }
  if (artist.user_id !== user.id) {
    return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { user, artist };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureOwner(id);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ ok: true, artist: guard.artist });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureOwner(id);
  if ("error" in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const patch = buildPatch(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No updatable fields provided." },
      { status: 400 },
    );
  }

  try {
    const artist = await updateArtist(id, patch);
    return NextResponse.json({ ok: true, artist });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureOwner(id);
  if ("error" in guard) return guard.error;

  try {
    await deleteArtist(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
