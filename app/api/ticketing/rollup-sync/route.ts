import { after } from "next/server";
import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";
import { warmCreativeThumbnailsAfterRollupSync } from "@/lib/meta/creative-thumbnail-after-rollup-sync";
import { shouldQueueThumbnailWarmAfterRollupSync } from "@/lib/meta/thumbnail-warm-after-rollup-sync";

/**
 * POST /api/ticketing/rollup-sync?eventId=X
 *
 * Owner-session entry point for the per-event daily rollup sync.
 * Auth = the signed-in user; the event must belong to them.
 *
 * The actual leg orchestration (Meta + Eventbrite fetch, upsert,
 * diagnostics) lives in `lib/dashboard/rollup-sync-runner.ts` so the
 * same routine can also run from:
 *   - the public share-token route
 *     (`/api/ticketing/rollup-sync/by-share-token/[token]`) wired into
 *     the share page's Refresh button (PR #67)
 *   - the daily Vercel cron
 *     (`/api/cron/rollup-sync-events`) so rollups stay warm for events
 *     no one opens in the dashboard (PR #67)
 *
 * Response shape (unchanged from the pre-refactor inline route):
 *   {
 *     ok: boolean,                      // true when both legs ok
 *     summary: { metaOk, metaError, ... rowsUpserted },
 *     meta: SyncLegResult,              // legacy per-leg detail kept
 *     eventbrite: SyncLegResult,        // for backwards compat
 *     diagnostics: { ... }              // env / scope / counts — safe
 *                                       // to log to the browser
 *   }
 *
 *   Status codes:
 *     200 — both legs succeeded (rowsUpserted may be 0 when nothing
 *           to write yet — that's a valid steady state, not an error).
 *     207 — at least one leg succeeded and at least one failed.
 *     200 with ok=false — both legs failed.
 *
 * Sits next to the existing `/api/ticketing/sync` route (which writes
 * a single `ticket_sales_snapshots` row) — the snapshot route stays
 * the source of truth for "current cumulative" numbers; this route
 * powers the per-day breakdown.
 */
export async function POST(req: NextRequest) {
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

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, event_code, event_timezone, event_date, client_id, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
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
  const clientId = (event.client_id as string | null) ?? null;
  const eventTikTokAccountId = (event.tiktok_account_id as string | null) ?? null;
  const eventGoogleAdsAccountId =
    (event.google_ads_account_id as string | null) ?? null;
  // Same single-vs-array unwrap as /spend-by-day; Supabase returns the
  // join as either depending on schema definition.
  const clientRel = event.client as
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null }
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null }[]
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

  console.info(
    `[rollup-sync/route] invoking runner event_id=${eventId} event_code=${eventCode ?? "<null>"} client_id=${clientId ?? "<null>"} event_date=${eventDate ?? "<null>"} ad_account=${adAccountId ?? "<null>"}`,
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
  });

  const ticketingSkipped = result.summary.eventbriteReason === "not_linked";
  const eventsSynced = result.summary.eventbriteOk ? 1 : 0;
  const eventsSkipped = ticketingSkipped ? 1 : 0;
  const message = ticketingSkipped
    ? "No connected ticketing provider for this event. Link events first."
    : result.summary.eventbriteOk
      ? "Ticketing provider synced successfully."
      : undefined;

  const thumbnailWarmQueued = shouldQueueThumbnailWarmAfterRollupSync({
    metaOk: result.summary.metaOk,
    adAccountId,
    eventCode,
  });

  if (thumbnailWarmQueued) {
    const warmUserId = user.id;
    const warmEventId = eventId;
    const warmEventCode = eventCode;
    const warmAdAccountId = adAccountId;
    after(async () => {
      try {
        const admin = createServiceRoleClient();
        const n = await warmCreativeThumbnailsAfterRollupSync({
          admin,
          eventId: warmEventId,
          userId: warmUserId,
          eventCode: warmEventCode,
          adAccountId: warmAdAccountId,
        });
        console.info(
          `[rollup-sync/route] deferred thumbnail warm cached=${n} event_id=${warmEventId}`,
        );
      } catch (err) {
        console.warn("[rollup-sync/route] deferred thumbnail warm failed", err);
      }
    });
  }

  return NextResponse.json(
    {
      ok: result.ok,
      eventsSynced,
      eventsSkipped,
      skippedReason: ticketingSkipped ? "Not linked" : undefined,
      message,
      thumbnailWarmQueued,
      summary: result.summary,
      meta: result.meta,
      tiktok: result.tiktok,
      googleAds: result.googleAds,
      eventbrite: result.eventbrite,
      diagnostics: result.diagnostics,
    },
    { status: result.ok ? 200 : result.anyOk ? 207 : 200 },
  );
}
