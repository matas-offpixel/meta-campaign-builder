import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
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
 *   - Event has at least one row in `event_ticketing_links` (i.e.
 *     someone bound it to an Eventbrite event in the dashboard).
 *   - Event's `general_sale_at` is within the last 60 days.
 *   - Past-event sweep: a `general_sale_at` 30 days ago covers
 *     events that have already happened — useful because revenue
 *     trickle (refunds, late comps) keeps changing for ~2 weeks
 *     after the show. Bounding to 60 days keeps the cron under any
 *     reasonable function timeout for a typical 4tF roster size.
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

  // Pull the union of:
  //   - events with at least one event_ticketing_links row, and
  //   - events whose `general_sale_at` is within the last 60 days
  // We query separately and merge on event id, because Supabase's
  // PostgREST doesn't expose a clean OR across a join + a column.
  // Each query is small (tens of rows on the current 4tF roster),
  // so a client-side union is cheaper than wiring an RPC.

  // Window: include the next 60 days too so we keep tracking events
  // currently in pre-sale. Past-event window is 60 days as well so
  // we cover late-arriving refunds / comp scans on already-run shows.
  const nowMs = Date.now();
  const sinceMs = nowMs - 60 * 24 * 60 * 60 * 1000;
  const untilMs = nowMs + 60 * 24 * 60 * 60 * 1000;
  const sinceISO = new Date(sinceMs).toISOString();
  const untilISO = new Date(untilMs).toISOString();

  // 1) Events with active ticketing links — a one-row-per-link table,
  //    so we de-dup downstream.
  const { data: linkedRows, error: linkedErr } = await supabase
    .from("event_ticketing_links")
    .select("event_id");
  if (linkedErr) {
    return NextResponse.json(
      { ok: false, error: linkedErr.message },
      { status: 500 },
    );
  }
  const linkedIds = new Set<string>(
    (linkedRows ?? [])
      .map((r) => (r as { event_id: string | null }).event_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  // 2) Events with general_sale_at in the rolling window.
  const { data: dateRows, error: dateErr } = await supabase
    .from("events")
    .select("id")
    .gte("general_sale_at", sinceISO)
    .lte("general_sale_at", untilISO);
  if (dateErr) {
    return NextResponse.json(
      { ok: false, error: dateErr.message },
      { status: 500 },
    );
  }
  const dateIds = new Set<string>(
    (dateRows ?? [])
      .map((r) => (r as { id: string }).id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );

  // Intersection. The user spec asks for events with BOTH an active
  // ticketing connection AND a general_sale_at within the last 60
  // days — we honor that intersection here. (Events with a ticketing
  // link but `general_sale_at` outside the window are skipped — they
  // either haven't been planned yet or are old enough that the
  // rollup window itself doesn't cover them.)
  const eligibleIds = Array.from(linkedIds).filter((id) => dateIds.has(id));

  if (eligibleIds.length === 0) {
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
      `[cron rollup-sync-events] no eligible events; window=${sinceISO}..${untilISO}`,
    );
    return NextResponse.json(empty);
  }

  // Hydrate the eligible event rows with the columns the runner needs.
  const { data: rawEvents, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, client_id, event_code, event_timezone, event_date, general_sale_at, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .in("id", eligibleIds);
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  const events = (rawEvents ?? []) as unknown as EventToSync[];

  console.log(
    `[cron rollup-sync-events] considering=${events.length} window=${sinceISO}..${untilISO}`,
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
      results.push({
        eventId: event.id,
        ok: result.ok,
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

  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}
