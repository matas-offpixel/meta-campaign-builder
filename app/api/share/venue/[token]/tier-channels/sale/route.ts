import { NextResponse, type NextRequest } from "next/server";

import { assertVenueShareTokenWritable } from "@/lib/db/share-token-venue-write-scope";
import {
  deleteTierChannelSale,
  upsertTierChannelSale,
} from "@/lib/db/tier-channels";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/share/venue/[token]/tier-channels/sale
 *
 * Body: { event_id, tier_name, channel_id, tickets_sold,
 *         revenue_overridden, revenue_amount?, notes? }
 *
 * UPSERT — latest snapshot replaces the prior (event, tier, channel).
 * Revenue resolution:
 *   - revenue_overridden=true ⇒ store revenue_amount verbatim.
 *   - revenue_overridden=false ⇒ recompute price × tickets_sold from
 *     the matching event_ticket_tiers row at write time.
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
      `[venue-share-channel-sale] event ownership read failed: ${error.message}`,
    );
    return false;
  }
  return !!data;
}

async function ensureChannelBelongsToClient(
  supabase: ReturnType<typeof createServiceRoleClient>,
  channelId: string,
  clientId: string,
): Promise<{ ok: boolean; isAutomatic: boolean }> {
  const { data, error } = await supabase
    .from("tier_channels")
    .select("id, is_automatic")
    .eq("id", channelId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !data) return { ok: false, isAutomatic: false };
  return {
    ok: true,
    isAutomatic: !!(data as { is_automatic?: boolean }).is_automatic,
  };
}

async function lookupTierPrice(
  supabase: ReturnType<typeof createServiceRoleClient>,
  args: { eventId: string; tierName: string },
): Promise<number | null> {
  const { data } = await supabase
    .from("event_ticket_tiers")
    .select("price")
    .eq("event_id", args.eventId)
    .eq("tier_name", args.tierName)
    .maybeSingle();
  if (!data) return null;
  const price = (data as { price?: number | string | null }).price;
  if (price == null) return null;
  const num = typeof price === "number" ? price : Number(price);
  return Number.isFinite(num) ? num : null;
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

  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
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
  const ticketsRaw = Number(body.tickets_sold);
  const revenueOverridden = body.revenue_overridden === true;
  const revenueRaw =
    body.revenue_amount === undefined || body.revenue_amount === null
      ? 0
      : Number(body.revenue_amount);
  const notes = typeof body.notes === "string" ? body.notes : null;

  if (!eventId || !tierName || !channelId) {
    return NextResponse.json(
      { ok: false, error: "event_id, tier_name and channel_id are required" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(ticketsRaw) || ticketsRaw < 0) {
    return NextResponse.json(
      { ok: false, error: "tickets_sold must be a non-negative integer" },
      { status: 400 },
    );
  }
  if (revenueOverridden && (!Number.isFinite(revenueRaw) || revenueRaw < 0)) {
    return NextResponse.json(
      {
        ok: false,
        error: "revenue_amount must be a non-negative number when overridden",
      },
      { status: 400 },
    );
  }

  const [eventOk, channelInfo] = await Promise.all([
    ensureVenueOwnsEvent(supabase, scope, eventId),
    ensureChannelBelongsToClient(supabase, channelId, scope.clientId),
  ]);
  if (!eventOk) {
    return NextResponse.json(
      { ok: false, error: "Event does not belong to this venue" },
      { status: 403 },
    );
  }
  if (!channelInfo.ok) {
    return NextResponse.json(
      { ok: false, error: "Channel does not belong to this client" },
      { status: 403 },
    );
  }
  if (channelInfo.isAutomatic) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Automatic channels (4TF/Eventbrite) are populated by API sync. Manual entries are rejected.",
      },
      { status: 400 },
    );
  }

  const tierPrice = await lookupTierPrice(supabase, { eventId, tierName });

  try {
    const row = await upsertTierChannelSale(supabase, {
      eventId,
      tierName,
      channelId,
      ticketsSold: Math.trunc(ticketsRaw),
      revenueOverridden,
      revenueAmount: revenueOverridden ? revenueRaw : null,
      tierPrice,
      notes,
    });
    return NextResponse.json({ ok: true, sale: row });
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

  const scope = await assertVenueShareTokenWritable(token, supabase);
  if (!scope.ok) {
    return NextResponse.json(scope.body, { status: scope.status });
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
    await deleteTierChannelSale(supabase, { eventId, tierName, channelId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    );
  }
}
