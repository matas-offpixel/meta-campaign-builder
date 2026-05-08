import { NextResponse, type NextRequest } from "next/server";

import { warmCreativeThumbnailsForGroups } from "@/lib/meta/creative-thumbnail-warm";
import { refreshActiveCreativesForEvent } from "@/lib/reporting/active-creatives-refresh-runner";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/show-week-burst
 *
 * Show-week tighter cadence layered on top of the base 3×/day Meta
 * crons (mig PR-E `vercel.json`). Runs only against events whose
 * `event_date` falls in the next 7 days — exactly the window where
 * an extra refresh per few hours is worth the Meta-call budget.
 *
 * For each in-window event we run:
 *   - `runRollupSyncForEvent` (per-event Meta + ticketing legs)
 *   - `refreshActiveCreativesForEvent` (preset snapshots + thumbnail warm)
 *
 * This is the SAME work the base crons already do for these events;
 * the burst run just makes it happen 3 extra times/day so the
 * Live indicator stays fresh through ticket-sale launch + show-day
 * pacing. Outside show-week (the other 90% of events), the base 3×
 * cadence handles them.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Same
 * shape as the other crons.
 *
 * Per-event isolation: each event runs inside its own try/catch so a
 * single-event Meta error can't abort the whole burst sweep.
 *
 * Service-role posture: identical to refresh-active-creatives —
 * no user session; rollup writes land under each event's owning
 * `user_id`.
 */

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const SHOW_WEEK_DAYS = 7;

interface BurstEventRow {
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

interface BurstEventResult {
  eventId: string;
  ok: boolean;
  rollupOk: boolean;
  rollupError: string | null;
  rollupRowsUpserted: number;
  refreshOk: boolean;
  refreshError: string | null;
  presetsWritten: number;
  durationMs: number;
}

interface BurstResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  /** "burst" tier — paired with "base" on the underlying crons. */
  cadence_tier: "burst";
  windowDays: number;
  eventsConsidered: number;
  eventsProcessed: number;
  totalRowsUpserted: number;
  totalPresetsRefreshed: number;
  results: BurstEventResult[];
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

function clientRelToFlat(
  rel: BurstEventRow["client"] | BurstEventRow["client"][],
): {
  metaAdAccountId: string | null;
  tiktokAccountId: string | null;
  googleAdsAccountId: string | null;
} {
  const flat = Array.isArray(rel) ? (rel[0] ?? null) : rel;
  return {
    metaAdAccountId: flat?.meta_ad_account_id ?? null,
    tiktokAccountId: flat?.tiktok_account_id ?? null,
    googleAdsAccountId: flat?.google_ads_account_id ?? null,
  };
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

  // In-window eligibility: event_date BETWEEN now() AND now() + 7
  // days. We then narrow further by either-or signal:
  //   - has an event_ticketing_links row (live ticket signal), OR
  //   - has a meta_campaign_id (live ad signal)
  // Both signals are the same ones the base cron eligibility uses.
  const now = new Date();
  const since = now.toISOString().slice(0, 10);
  const until = new Date(now.getTime() + SHOW_WEEK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: rawEvents, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, client_id, event_code, event_timezone, event_date, general_sale_at, tiktok_account_id, google_ads_account_id, meta_campaign_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .gte("event_date", since)
    .lte("event_date", until);
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  const candidateEvents = (rawEvents ?? []) as unknown as Array<
    BurstEventRow & { meta_campaign_id: string | null }
  >;

  // Ticketing-link signal: pull every event_id that has a row,
  // intersect with the candidate set. Cheaper than a per-event
  // exists() round-trip.
  const candidateIds = candidateEvents.map((e) => e.id);
  const ticketingIds = new Set<string>();
  if (candidateIds.length > 0) {
    const { data: linkRows, error: linkErr } = await supabase
      .from("event_ticketing_links")
      .select("event_id")
      .in("event_id", candidateIds);
    if (linkErr) {
      console.warn(
        `[cron show-week-burst] ticketing link lookup failed: ${linkErr.message}`,
      );
    } else {
      for (const row of (linkRows ?? []) as { event_id: string | null }[]) {
        if (row.event_id) ticketingIds.add(row.event_id);
      }
    }
  }

  const events = candidateEvents.filter((e) => {
    if (ticketingIds.has(e.id)) return true;
    if (e.meta_campaign_id) return true;
    return false;
  });

  console.log(
    `[cron show-week-burst] cadence=burst window=${since}..${until} candidates=${candidateEvents.length} eligible=${events.length}`,
  );

  if (events.length === 0) {
    const finishedAt = new Date().toISOString();
    const empty: BurstResponse = {
      ok: true,
      startedAt,
      finishedAt,
      cadence_tier: "burst",
      windowDays: SHOW_WEEK_DAYS,
      eventsConsidered: 0,
      eventsProcessed: 0,
      totalRowsUpserted: 0,
      totalPresetsRefreshed: 0,
      results: [],
    };
    return NextResponse.json(empty);
  }

  const results: BurstEventResult[] = [];
  let totalRowsUpserted = 0;
  let totalPresetsRefreshed = 0;

  for (const event of events) {
    const t0 = Date.now();
    const { metaAdAccountId, tiktokAccountId, googleAdsAccountId } =
      clientRelToFlat(event.client);
    const adAccountId = metaAdAccountId;
    const eventDate = event.event_date ? new Date(event.event_date) : null;

    // Rollup leg.
    let rollupOk = false;
    let rollupError: string | null = null;
    let rollupRowsUpserted = 0;
    try {
      const rollup = await runRollupSyncForEvent({
        supabase,
        eventId: event.id,
        userId: event.user_id,
        eventCode: event.event_code,
        eventTimezone: event.event_timezone,
        adAccountId,
        clientId: event.client_id,
        eventDate: event.event_date,
        eventTikTokAccountId: event.tiktok_account_id,
        clientTikTokAccountId: tiktokAccountId,
        eventGoogleAdsAccountId: event.google_ads_account_id,
        clientGoogleAdsAccountId: googleAdsAccountId,
      });
      rollupOk = rollup.summary.synced;
      rollupRowsUpserted = rollup.summary.rowsUpserted;
      totalRowsUpserted += rollupRowsUpserted;
    } catch (err) {
      rollupError = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron show-week-burst] rollup event=${event.id} threw: ${rollupError}`,
      );
    }

    // Refresh-active-creatives leg. Run regardless of rollup outcome —
    // independent Meta call shape; one failing doesn't predict the
    // other. Snapshot writes refuse on kind="skip"|"error" inside the
    // runner per the existing contract, so a degraded result still
    // produces a sane response.
    let refreshOk = false;
    let refreshError: string | null = null;
    let presetsWritten = 0;
    try {
      const refresh = await refreshActiveCreativesForEvent({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
        eventId: event.id,
        userId: event.user_id,
        eventCode: event.event_code,
        adAccountId,
        eventDate,
        onSnapshotWritten: async ({ payload }) => {
          await warmCreativeThumbnailsForGroups({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            supabase: supabase as any,
            userId: event.user_id,
            adAccountId,
            groups: payload.groups,
          });
        },
      });
      refreshOk = refresh.ok;
      presetsWritten = refresh.presetResults.filter(
        (p) => p.wroteSnapshot,
      ).length;
      totalPresetsRefreshed += presetsWritten;
    } catch (err) {
      refreshError = err instanceof Error ? err.message : String(err);
      console.error(
        `[cron show-week-burst] refresh event=${event.id} threw: ${refreshError}`,
      );
    }

    results.push({
      eventId: event.id,
      ok: rollupOk && refreshOk,
      rollupOk,
      rollupError,
      rollupRowsUpserted,
      refreshOk,
      refreshError,
      presetsWritten,
      durationMs: Date.now() - t0,
    });
  }

  const finishedAt = new Date().toISOString();
  const allOk = results.every((r) => r.ok);
  const response: BurstResponse = {
    ok: allOk,
    startedAt,
    finishedAt,
    cadence_tier: "burst",
    windowDays: SHOW_WEEK_DAYS,
    eventsConsidered: events.length,
    eventsProcessed: results.length,
    totalRowsUpserted,
    totalPresetsRefreshed,
    results,
  };

  console.log(
    `[cron show-week-burst] cadence=burst done events=${results.length} all_ok=${allOk} rollup_rows=${totalRowsUpserted} presets_written=${totalPresetsRefreshed}`,
  );

  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}
