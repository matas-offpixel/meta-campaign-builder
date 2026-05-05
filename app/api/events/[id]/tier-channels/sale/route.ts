import { NextResponse, type NextRequest } from "next/server";

import {
  deleteTierChannelSale,
  upsertTierChannelSale,
} from "@/lib/db/tier-channels";
import { createClient } from "@/lib/supabase/server";

async function assertOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { userId: string; eventId: string; channelId: string },
): Promise<
  | { ok: true; isAutomatic: boolean; tierPrice: (tierName: string) => Promise<number | null> }
  | { ok: false; status: number; error: string }
> {
  const { data: event } = await supabase
    .from("events")
    .select("id, client_id, user_id")
    .eq("id", args.eventId)
    .maybeSingle();
  if (
    !event ||
    (event as { user_id?: string | null }).user_id !== args.userId
  ) {
    return { ok: false, status: 404, error: "Event not found" };
  }
  const clientId = (event as { client_id: string }).client_id;
  const { data: channel } = await supabase
    .from("tier_channels")
    .select("id, client_id, is_automatic")
    .eq("id", args.channelId)
    .maybeSingle();
  if (
    !channel ||
    (channel as { client_id?: string | null }).client_id !== clientId
  ) {
    return {
      ok: false,
      status: 403,
      error: "Channel does not belong to this client",
    };
  }
  const isAutomatic = !!(channel as { is_automatic?: boolean }).is_automatic;
  return {
    ok: true,
    isAutomatic,
    tierPrice: async (tierName: string) => {
      const { data: tier } = await supabase
        .from("event_ticket_tiers")
        .select("price")
        .eq("event_id", args.eventId)
        .eq("tier_name", tierName)
        .maybeSingle();
      if (!tier) return null;
      const price = (tier as { price?: number | string | null }).price;
      if (price == null) return null;
      const num = typeof price === "number" ? price : Number(price);
      return Number.isFinite(num) ? num : null;
    },
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
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
  if (!tierName || !channelId) {
    return NextResponse.json(
      { ok: false, error: "tier_name and channel_id are required" },
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

  const guard = await assertOwnership(supabase, {
    userId: user.id,
    eventId,
    channelId,
  });
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: guard.error },
      { status: guard.status },
    );
  }
  if (guard.isAutomatic) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Automatic channels are populated by API sync. Manual entries are rejected.",
      },
      { status: 400 },
    );
  }
  const tierPrice = await guard.tierPrice(tierName);

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
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
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
  const tierName =
    typeof body.tier_name === "string" ? body.tier_name.trim() : "";
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
  if (!tierName || !channelId) {
    return NextResponse.json(
      { ok: false, error: "tier_name and channel_id are required" },
      { status: 400 },
    );
  }
  const guard = await assertOwnership(supabase, {
    userId: user.id,
    eventId,
    channelId,
  });
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: guard.error },
      { status: guard.status },
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
