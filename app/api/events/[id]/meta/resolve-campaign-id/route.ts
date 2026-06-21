import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { listCampaignsForEvent } from "@/lib/insights/meta";
import { withActPrefix } from "@/lib/meta/ad-account-id";

/**
 * POST /api/events/[id]/meta/resolve-campaign-id
 *
 * Resolves the Meta campaign ID(s) for an event and persists them to
 * `events.meta_campaign_id`. Accepts two auth methods:
 *   1. Bearer CRON_SECRET — trusted ops/backfill path.
 *   2. Supabase session cookie — in-app path (ownership checked).
 *
 * Use this endpoint to one-time backfill events.meta_campaign_id for events
 * where the cron's name-based CONTAIN discovery is flaky (e.g. Ironworks).
 * After running, the rollup-sync cron uses the persisted ID directly.
 *
 * Returns:
 *   { ok: true, meta_campaign_id: "id1,id2", campaign_names: ["..."] }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  // ── Bearer auth (ops / cron path) ─────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const isCronAuthed =
    cronSecret.length > 0 &&
    (authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim() === cronSecret.trim()
      : authHeader.trim() === cronSecret.trim());

  // ── Session auth (in-app path) ─────────────────────────────────────────────
  let authUserId: string | null = null;
  if (!isCronAuthed) {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 },
      );
    }
    authUserId = user.id;
  }

  const supabase = createServiceRoleClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: eventRow, error: eventError } = await sb
    .from("events")
    .select(
      "id, user_id, event_code, meta_campaign_id, client:clients ( meta_ad_account_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return NextResponse.json(
      { ok: false, error: eventError.message },
      { status: 500 },
    );
  }
  if (!eventRow) {
    return NextResponse.json(
      { ok: false, error: "Event not found." },
      { status: 404 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = eventRow as unknown as any;

  if (!isCronAuthed && ev.user_id !== authUserId) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  const eventCode: string | null = ev.event_code ?? null;
  if (!eventCode?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Event has no event_code set." },
      { status: 400 },
    );
  }

  const clientRel = Array.isArray(ev.client) ? ev.client[0] : ev.client;
  const adAccountId: string | null = clientRel?.meta_ad_account_id ?? null;
  if (!adAccountId?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Client has no Meta ad account linked." },
      { status: 400 },
    );
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, ev.user_id);
    token = resolved.token;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Meta token resolution failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  let campaigns: Array<{ id: string; name: string }>;
  try {
    campaigns = await listCampaignsForEvent({
      adAccountId: withActPrefix(adAccountId),
      eventCode,
      token,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Meta campaign list failed: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 },
    );
  }

  if (campaigns.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `No Meta campaigns found for event_code=${eventCode} in account=${adAccountId}.`,
      },
      { status: 404 },
    );
  }

  const campaignId = campaigns.map((c) => c.id).join(",");
  const campaignNames = campaigns.map((c) => c.name);

  const { error: updateError } = await sb
    .from("events")
    .update({ meta_campaign_id: campaignId })
    .eq("id", eventId);

  if (updateError) {
    return NextResponse.json(
      { ok: false, error: `DB update failed: ${updateError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    meta_campaign_id: campaignId,
    campaign_names: campaignNames,
  });
}
