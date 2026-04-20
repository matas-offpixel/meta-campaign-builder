import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteVenue,
  getVenue,
  updateVenue,
  type VenueUpdate,
} from "@/lib/db/venues";

/**
 * Per-venue CRUD. Auth + ownership check on every method — RLS would 0-row
 * cross-tenant updates silently and we want the 403 to be unmissable.
 */

const PATCH_FIELDS: Array<keyof VenueUpdate> = [
  "name",
  "city",
  "country",
  "capacity",
  "address",
  "meta_page_id",
  "meta_page_name",
  "website",
  "notes",
];

function buildPatch(body: Record<string, unknown>): VenueUpdate {
  const patch: Record<string, unknown> = {};
  for (const k of PATCH_FIELDS) {
    if (k in body) patch[k] = body[k];
  }
  return patch as VenueUpdate;
}

async function ensureOwner(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }) };
  }
  const venue = await getVenue(id);
  if (!venue) {
    return { error: NextResponse.json({ ok: false, error: "Venue not found" }, { status: 404 }) };
  }
  if (venue.user_id !== user.id) {
    return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { user, venue };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureOwner(id);
  if ("error" in guard) return guard.error;
  return NextResponse.json({ ok: true, venue: guard.venue });
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
    const venue = await updateVenue(id, patch);
    return NextResponse.json({ ok: true, venue });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update venue.";
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
    await deleteVenue(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete venue.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
