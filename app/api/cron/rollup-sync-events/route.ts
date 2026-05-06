import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { loadRollupSyncCronEligibility } from "@/lib/dashboard/cron-eligibility";
import { warnMetaReconcileDriftForTopRollupEvents } from "@/lib/dashboard/rollup-meta-reconcile-log";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";

/**
 * GET /api/cron/rollup-sync-events
 *
 * Vercel Cron entry point that walks every event with an active
 * ticketing connection AND `general_sale_at` within the last 60 days,
 * and runs `runRollupSyncForEvent` for each. Pre-PR #67 the Daily
 * Tracker rollups only populated when a staffer opened the dashboard
 * event page — events nobody touched all day showed stale "—" rows
 * and clients on the `/share/report/[token]` URL saw the same gap.
 *
 * Cadence: configured in `vercel.json`. Runs on a schedule that hits
 * each event at least once per day; the runner itself is idempotent
 * so over-frequent runs are wasteful but not harmful.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Same
 * shape as the other cron entries. 401 on mismatch.
 *
 * Eligibility:
 *   - Existing operational legs: ticketing-linked events, sale-date
 *     window events, and event-level Google Ads accounts.
 *   - Event-code fallback: on-sale/live events with populated event_code
 *     and event_date null or within the last 180 days. This keeps Meta
 *     rollups warm for internal-ticketing clients whose campaigns still
 *     follow the bracketed `[EVENT_CODE]` convention.
 *
 * Per-event isolation:
 *   - Each event runs inside its own try/catch so one Meta rate-limit
 *     can't abort the whole batch.
 *   - Per-event timing is logged (start, completion, leg outcomes) so
 *     Vercel logs surface which events are consistently failing.
 *
 * Service-role posture:
 *   - Cron runs without a user session, so we use the service-role
 *     client. The runner writes rollup rows under each event's
 *     OWNING `user_id`, never under a synthetic system user — so
 *     the per-user `event_daily_rollups` RLS still gates dashboard
 *     reads correctly.
 */

export const maxDuration = 800;

interface EventToSync {
  id: string;
  user_id: string;
  client_id: string | null;
  event_code: string | null;
  event_timezone: string | null;
  event_date: string | null;
  general_sale_at: string | null;
  tiktok_account_id: string | null;
  google_ads_account_id: string | null;
  client: {
    meta_ad_account_id: string | null;
    tiktok_account_id: string | null;
    google_ads_account_id: string | null;
  } | null;
}

interface EventSyncResult {
  eventId: string;
  ok: boolean;
  metaOk: boolean;
  metaError: string | null;
  eventbriteOk: boolean;
  eventbriteError: string | null;
  tiktokOk: boolean;
  tiktokError: string | null;
  googleAdsOk: boolean;
  googleAdsError: string | null;
  rowsUpserted: number;
  durationMs: number;
}

interface CronResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  eventsConsidered: number;
  eventsProcessed: number;
  totalRowsUpserted: number;
  results: EventSyncResult[];
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  let eligibility: Awaited<ReturnType<typeof loadRollupSyncCronEligibility>>;
  try {
    eligibility = await loadRollupSyncCronEligibility(supabase);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Eligibility query failed",
      },
      { status: 500 },
    );
  }

  if (eligibility.eligibleIds.length === 0) {
    const finishedAt = new Date().toISOString();
    const empty: CronResponse = {
      ok: true,
      startedAt,
      finishedAt,
      eventsConsidered: 0,
      eventsProcessed: 0,
      totalRowsUpserted: 0,
      results: [],
    };
    console.log(
      `[cron rollup-sync-events] no eligible events; linked_and_dated=${eligibility.linkedAndDatedIds.length} ticketing=${eligibility.ticketingIds.length} sale_date=${eligibility.saleDateIds.length} google_ads=${eligibility.googleAdsIds.length} code_match=${eligibility.codeMatchIds.length} total=0 window=${eligibility.sinceISO}..${eligibility.untilISO}`,
    );
    return NextResponse.json(empty);
  }

  // Hydrate the eligible event rows with the columns the runner needs.
  const { data: rawEvents, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, client_id, event_code, event_timezone, event_date, general_sale_at, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .in("id", eligibility.eligibleIds);
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  const events = (rawEvents ?? []) as unknown as EventToSync[];

  console.log(
    `[cron rollup-sync-events] considering=${events.length} linked_and_dated=${eligibility.linkedAndDatedIds.length} ticketing=${eligibility.ticketingIds.length} sale_date=${eligibility.saleDateIds.length} google_ads=${eligibility.googleAdsIds.length} code_match=${eligibility.codeMatchIds.length} total=${eligibility.eligibleIds.length} window=${eligibility.sinceISO}..${eligibility.untilISO}`,
  );

  const results: EventSyncResult[] = [];
  let totalRowsUpserted = 0;

  for (const event of events) {
    const t0 = Date.now();
    try {
      const clientRel = event.client as
        | {
            meta_ad_account_id: string | null;
            tiktok_account_id: string | null;
            google_ads_account_id: string | null;
          }
        | Array<{
            meta_ad_account_id: string | null;
            tiktok_account_id: string | null;
            google_ads_account_id: string | null;
          }>
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
      const hasGoogleAdsAccount = Boolean(
        event.google_ads_account_id ?? clientGoogleAdsAccountId,
      );

      const result = await runRollupSyncForEvent({
        supabase,
        eventId: event.id,
        userId: event.user_id,
        eventCode: event.event_code,
        eventTimezone: event.event_timezone,
        adAccountId,
        clientId: event.client_id,
        eventDate: event.event_date,
        eventTikTokAccountId: event.tiktok_account_id,
        clientTikTokAccountId,
        eventGoogleAdsAccountId: event.google_ads_account_id,
        clientGoogleAdsAccountId,
      });

      totalRowsUpserted += result.summary.rowsUpserted;
      const eventOk =
        result.summary.synced &&
        (!hasGoogleAdsAccount || result.summary.googleAdsOk);
      results.push({
        eventId: event.id,
        ok: eventOk,
        metaOk: result.summary.metaOk,
        metaError: result.summary.metaError,
        eventbriteOk: result.summary.eventbriteOk,
        eventbriteError: result.summary.eventbriteError,
        tiktokOk: result.summary.tiktokOk,
        tiktokError: result.summary.tiktokError,
        googleAdsOk: result.summary.googleAdsOk,
        googleAdsError: result.summary.googleAdsError,
        rowsUpserted: result.summary.rowsUpserted,
        durationMs: Date.now() - t0,
      });
    } catch (err) {
      // Per-event isolation — one Meta rate limit shouldn't abort
      // the whole batch. Log + record + continue.
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[cron rollup-sync-events] event=${event.id} threw: ${message}`,
      );
      results.push({
        eventId: event.id,
        ok: false,
        metaOk: false,
        metaError: message,
        eventbriteOk: false,
        eventbriteError: message,
        tiktokOk: false,
        tiktokError: message,
        googleAdsOk: false,
        googleAdsError: message,
        rowsUpserted: 0,
        durationMs: Date.now() - t0,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const allOk = results.every((r) => r.ok);
  const response: CronResponse = {
    ok: allOk,
    startedAt,
    finishedAt,
    eventsConsidered: events.length,
    eventsProcessed: results.length,
    totalRowsUpserted,
    results,
  };

  console.log(
    `[cron rollup-sync-events] done events=${results.length} all_ok=${allOk} total_rows=${totalRowsUpserted}`,
  );

  try {
    await warnMetaReconcileDriftForTopRollupEvents(supabase);
  } catch (err) {
    console.warn(
      `[cron rollup-sync-events] meta reconcile log skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}
