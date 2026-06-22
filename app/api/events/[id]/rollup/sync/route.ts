import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";

/**
 * POST /api/events/[id]/rollup/sync
 *
 * Runs `runRollupSyncForEvent` for a single event. Useful when the bulk
 * `/api/cron/rollup-sync-events` endpoint times out (Vercel 60 s limit on
 * manually-triggered calls) or when an ops script needs to force-refresh
 * one event after a config change (e.g. `meta_campaign_id` was just
 * persisted via `/meta/resolve-campaign-id`).
 *
 * Auth: Bearer CRON_SECRET OR Supabase session (event ownership checked).
 *
 * Mirrors the structure of `/meta/resolve-campaign-id` — same dual-auth
 * pattern and same event select as the bulk cron.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  // ── Dual auth (mirrors /meta/resolve-campaign-id) ──────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const isCronAuthed =
    cronSecret.length > 0 &&
    (authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim() === cronSecret.trim()
      : authHeader.trim() === cronSecret.trim());

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

  // Same select shape as the cron uses for each event.
  const { data: rawEvent, error: eventErr } = await sb
    .from("events")
    .select(
      "id, user_id, client_id, kind, event_code, event_timezone, event_date, event_start_at, general_sale_at, mailchimp_audience_id, tiktok_account_id, google_ads_account_id, meta_campaign_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id, mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!rawEvent) {
    return NextResponse.json(
      { ok: false, error: "Event not found." },
      { status: 404 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = rawEvent as unknown as any;

  if (!isCronAuthed && ev.user_id !== authUserId) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  // Resolve client-level account IDs from the joined clients row.
  const clientRel = Array.isArray(ev.client) ? ev.client[0] : ev.client;
  const adAccountId: string | null = clientRel?.meta_ad_account_id ?? null;
  const clientTikTokAccountId: string | null =
    clientRel?.tiktok_account_id ?? null;
  const clientGoogleAdsAccountId: string | null =
    clientRel?.google_ads_account_id ?? null;

  try {
    const result = await runRollupSyncForEvent({
      supabase,
      eventId: ev.id,
      userId: ev.user_id,
      clientId: ev.client_id,
      eventCode: ev.event_code,
      eventTimezone: ev.event_timezone,
      eventDate: ev.event_date,
      adAccountId,
      eventTikTokAccountId: ev.tiktok_account_id,
      clientTikTokAccountId,
      eventGoogleAdsAccountId: ev.google_ads_account_id,
      clientGoogleAdsAccountId,
      metaCampaignId: ev.meta_campaign_id,
      // venueAllocatorCompletedKeys omitted — single-event sync doesn't batch
    });

    return NextResponse.json({
      ok: result.anyOk,
      summary: result.summary,
      legs: {
        meta: result.meta.reason ?? (result.meta.ok ? "ok" : "error"),
        tiktok: result.tiktok.reason ?? (result.tiktok.ok ? "ok" : "error"),
        googleAds:
          result.googleAds.reason ?? (result.googleAds.ok ? "ok" : "error"),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
