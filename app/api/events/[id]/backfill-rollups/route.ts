import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";
import { syncMailchimpAudienceDailyHistory } from "@/lib/mailchimp/sync";

/**
 * POST /api/events/[id]/backfill-rollups
 *
 * Triggers a historical rollup backfill for the given event using a
 * configurable date window. Designed for brand_campaign events and any
 * event where the daily rollup table is sparse (e.g. the event was
 * created before the cron started tracking it).
 *
 * Wraps `runRollupSyncForEvent` with `rollupWindowDays` set to the
 * caller-specified window (default: 180 days) so the Meta + TikTok +
 * Google Ads legs each fetch the full historical day-by-day breakdown
 * via their `time_increment=1` / `dimensions:["stat_time_day"]` calls.
 *
 * The upsert is idempotent — the `(event_id, date)` unique constraint
 * in `event_daily_rollups` means re-running a backfill is safe.
 *
 * Auth: signed-in user; event must belong to them.
 *
 * Body (JSON, optional):
 *   { windowDays?: number }   — default 180
 *
 * Response:
 *   { ok, rowsUpserted, summary }
 */
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
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({})) as { windowDays?: unknown };
  const windowDays = typeof body.windowDays === "number" && body.windowDays > 0
    ? Math.min(body.windowDays, 730)
    : 180;

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, kind, event_code, event_timezone, event_date, client_id, mailchimp_audience_id, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id, mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const eventCode = (event.event_code as string | null) ?? null;
  const eventTimezone = (event.event_timezone as string | null) ?? null;
  const eventDate = (event.event_date as string | null) ?? null;
  const eventKind = (event.kind as string | null) ?? null;
  const clientId = (event.client_id as string | null) ?? null;
  const eventMailchimpAudienceId = (event.mailchimp_audience_id as string | null) ?? null;
  const eventTikTokAccountId =
    (event.tiktok_account_id as string | null) ?? null;
  const eventGoogleAdsAccountId =
    (event.google_ads_account_id as string | null) ?? null;

  const clientRel = event.client as
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null; mailchimp_account_id: string | null; mailchimp_audience_id: string | null }
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null; mailchimp_account_id: string | null; mailchimp_audience_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);
  const clientTikTokAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.tiktok_account_id ?? null)
    : (clientRel?.tiktok_account_id ?? null);
  const clientGoogleAdsAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.google_ads_account_id ?? null)
    : (clientRel?.google_ads_account_id ?? null);
  const clientMailchimpAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.mailchimp_account_id ?? null)
    : (clientRel?.mailchimp_account_id ?? null);
  const clientMailchimpAudienceId = Array.isArray(clientRel)
    ? (clientRel[0]?.mailchimp_audience_id ?? null)
    : (clientRel?.mailchimp_audience_id ?? null);

  console.info(
    `[backfill-rollups] start event_id=${eventId} event_code=${eventCode ?? "<null>"} window=${windowDays}d ad_account=${adAccountId ?? "<null>"}`,
  );

  const result = await runRollupSyncForEvent({
    supabase,
    eventId,
    userId: user.id,
    eventCode,
    eventTimezone,
    adAccountId,
    clientId,
    eventDate,
    eventTikTokAccountId,
    clientTikTokAccountId,
    eventGoogleAdsAccountId,
    clientGoogleAdsAccountId,
    rollupWindowDays: windowDays,
  });

  // For brand_campaign events, also sync Mailchimp daily history.
  let mailchimpOk = true;
  let mailchimpError: string | null = null;
  let mailchimpRowsWritten = 0;
  if (eventKind === "brand_campaign") {
    try {
      const mailchimpResult = await syncMailchimpAudienceDailyHistory(
        supabase,
        {
          id: eventId,
          user_id: user.id,
          kind: eventKind,
          mailchimp_audience_id: eventMailchimpAudienceId,
          client_id: clientId,
          client: clientMailchimpAccountId != null || clientMailchimpAudienceId != null
            ? { mailchimp_account_id: clientMailchimpAccountId, mailchimp_audience_id: clientMailchimpAudienceId }
            : null,
        },
        Math.min(windowDays, 180),
      );
      mailchimpOk = mailchimpResult.ok;
      mailchimpError = mailchimpResult.error ?? null;
      mailchimpRowsWritten = mailchimpResult.rowsWritten;
      console.info(
        `[backfill-rollups] mailchimp event_id=${eventId} ok=${mailchimpOk} rows=${mailchimpRowsWritten}${mailchimpError ? ` error=${mailchimpError}` : ""}`,
      );
    } catch (err) {
      mailchimpOk = false;
      mailchimpError = err instanceof Error ? err.message : String(err);
      console.error(`[backfill-rollups] mailchimp event_id=${eventId} threw: ${mailchimpError}`);
    }
  }

  console.info(
    `[backfill-rollups] done event_id=${eventId} ok=${result.ok} rows=${result.summary.rowsUpserted}`,
  );

  return NextResponse.json({
    ok: result.ok && mailchimpOk,
    rowsUpserted: result.summary.rowsUpserted,
    windowDays,
    summary: {
      metaOk: result.summary.metaOk,
      metaError: result.summary.metaError,
      tiktokOk: result.summary.tiktokOk,
      tiktokError: result.summary.tiktokError,
      googleAdsOk: result.summary.googleAdsOk,
      googleAdsError: result.summary.googleAdsError,
      mailchimpOk,
      mailchimpError,
      mailchimpRowsWritten,
    },
  });
}
