import { NextResponse, type NextRequest } from "next/server";

import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import {
  deleteTierChannelAllocation,
  upsertTierChannelAllocation,
} from "@/lib/db/tier-channels";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/share/venue/[token]/tier-channels/allocation
 *
 * Body: { event_id, tier_name, channel_id, allocation_count, notes? }
 *
 * UPSERT semantics — the latest write replaces the prior allocation for
 * (event_id, tier_name, channel_id). Requires `can_edit=true` on the
 * share token. The endpoint asserts the (event_id, channel_id) belong
 * to the venue scope before writing.
 *
 * DELETE supported with the same body shape (channel_id + tier_name +
 * event_id) so operators can remove an allocation entry without
 * setting it to 0.
 */

async function ensureVenueOwnsEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  scope: { clientId: string; eventCode: string },
  eventId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("id", eventId)
    .eq("client_id", scope.clientId)
    .eq("event_code", scope.eventCode)
    .maybeSingle();
  if (error) {
    console.warn(
      `[venue-share-channel-allocation] event ownership read failed: ${error.message}`,
    );
    return false;
  }
  return !!data;
}

async function ensureChannelBelongsToClient(
  supabase: ReturnType<typeof createServiceRoleClient>,
  channelId: string,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tier_channels")
    .select("id")
    .eq("id", channelId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    console.warn(
      `[venue-share-channel-allocation] channel ownership read failed: ${error.message}`,
    );
    return false;
  }
  return !!data;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const tierName =
    typeof body.tier_name === "string" ? body.tier_name.trim() : "";
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
  const allocationRaw = Number(body.allocation_count);
  const notes = typeof body.notes === "string" ? body.notes : null;

  const scope = await assertVenueShareTokenWritable(token, supabase, {
    eventId,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }

  if (!eventId || !tierName || !channelId) {
    return NextResponse.json(
      { ok: false, error: "event_id, tier_name and channel_id are required" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(allocationRaw) || allocationRaw < 0) {
    return NextResponse.json(
      { ok: false, error: "allocation_count must be a non-negative integer" },
      { status: 400 },
    );
  }

  const [eventOk, channelOk] = await Promise.all([
    ensureVenueOwnsEvent(supabase, scope, eventId),
    ensureChannelBelongsToClient(supabase, channelId, scope.clientId),
  ]);
  if (!eventOk) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this venue" },
      { status: 403 },
    );
  }
  if (!channelOk) {
    return NextResponse.json(
      { ok: false, error: "Channel does not belong to this client" },
      { status: 403 },
    );
  }

  try {
    const row = await upsertTierChannelAllocation(supabase, {
      eventId,
      tierName,
      channelId,
      allocationCount: Math.trunc(allocationRaw),
      notes,
    });
    return NextResponse.json({ ok: true, allocation: row });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const eventId = typeof body.event_id === "string" ? body.event_id : "";
  const tierName =
    typeof body.tier_name === "string" ? body.tier_name.trim() : "";
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";

  const scope = await assertVenueShareTokenWritable(token, supabase, {
    eventId,
  });
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
  }
  if (!eventId || !tierName || !channelId) {
    return NextResponse.json(
      { ok: false, error: "event_id, tier_name and channel_id are required" },
      { status: 400 },
    );
  }
  const eventOk = await ensureVenueOwnsEvent(supabase, scope, eventId);
  if (!eventOk) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this venue" },
      { status: 403 },
    );
  }
  try {
    await deleteTierChannelAllocation(supabase, {
      eventId,
      tierName,
      channelId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
