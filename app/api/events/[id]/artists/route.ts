import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  addEventArtist,
  listEventArtists,
  removeEventArtist,
  updateEventArtistBilling,
} from "@/lib/db/event-artists";

/**
 * Per-event artist roster CRUD.
 *
 * GET    list joined event_artists rows (with artist columns flattened).
 * POST   add an artist to the event.    body: { artistId, isHeadliner?, billingOrder? }
 * PATCH  update billing position.       body: { artistId, isHeadliner, billingOrder }
 * DELETE remove an artist from event.   body: { artistId }
 *
 * Auth + ownership check uses the existing events RLS — we look the event
 * up explicitly first so the caller gets a 404/403 instead of a silent 0-row.
 */

async function ensureEventOwner(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 }),
    };
  }
  const { data: ev, error } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    return {
      error: NextResponse.json({ ok: false, error: error.message }, { status: 500 }),
    };
  }
  if (!ev) {
    return {
      error: NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 }),
    };
  }
  if (ev.user_id !== user.id) {
    return {
      error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }),
    };
  }
  return { user };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureEventOwner(id);
  if ("error" in guard) return guard.error;
  const artists = await listEventArtists(id);
  return NextResponse.json({ ok: true, artists });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureEventOwner(id);
  if ("error" in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const artistId = typeof body.artistId === "string" ? body.artistId : null;
  if (!artistId) {
    return NextResponse.json(
      { ok: false, error: "`artistId` is required." },
      { status: 400 },
    );
  }

  try {
    const row = await addEventArtist(guard.user.id, id, artistId, {
      isHeadliner: body.isHeadliner === true,
      billingOrder:
        typeof body.billingOrder === "number" ? body.billingOrder : 0,
    });
    return NextResponse.json({ ok: true, eventArtist: row }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureEventOwner(id);
  if ("error" in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const artistId = typeof body.artistId === "string" ? body.artistId : null;
  if (!artistId) {
    return NextResponse.json(
      { ok: false, error: "`artistId` is required." },
      { status: 400 },
    );
  }
  const isHeadliner = body.isHeadliner === true;
  const billingOrder =
    typeof body.billingOrder === "number" ? body.billingOrder : 0;

  try {
    const row = await updateEventArtistBilling(
      id,
      artistId,
      isHeadliner,
      billingOrder,
    );
    return NextResponse.json({ ok: true, eventArtist: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update billing.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const guard = await ensureEventOwner(id);
  if ("error" in guard) return guard.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const artistId = typeof body.artistId === "string" ? body.artistId : null;
  if (!artistId) {
    return NextResponse.json(
      { ok: false, error: "`artistId` is required." },
      { status: 400 },
    );
  }

  try {
    await removeEventArtist(id, artistId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to remove artist.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
