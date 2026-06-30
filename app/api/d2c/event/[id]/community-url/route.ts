/**
 * PATCH /api/d2c/event/[id]/community-url
 *
 * Sets the WhatsApp community URL on the event's d2c_event_copy row — the only
 * required human runtime input before approving the community early-access
 * send. RLS-scoped to the signed-in owner of the event.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { updateD2CEventCopyFields } from "@/lib/db/d2c";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  if (!eventId) {
    return NextResponse.json({ ok: false, error: "event id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let communityUrl = "";
  try {
    const body = (await req.json()) as { community_url?: string };
    communityUrl = typeof body.community_url === "string" ? body.community_url.trim() : "";
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (communityUrl && !/^https?:\/\//i.test(communityUrl)) {
    return NextResponse.json(
      { ok: false, error: "community_url must be an http(s) URL." },
      { status: 400 },
    );
  }

  // Ownership: the event must belong to the user.
  const { data: event } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!event || event.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }

  const updated = await updateD2CEventCopyFields(supabase, eventId, {
    whatsappCommunityUrl: communityUrl || null,
  });
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "No copy snapshot for this event yet." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, copy: updated });
}
