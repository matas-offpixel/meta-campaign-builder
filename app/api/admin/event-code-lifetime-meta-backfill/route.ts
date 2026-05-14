import { NextResponse, type NextRequest } from "next/server";

import {
  upsertEventCodeLifetimeMetaCache,
} from "@/lib/db/event-code-lifetime-meta-cache";
import { fetchEventLifetimeMetaMetrics } from "@/lib/insights/meta";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/event-code-lifetime-meta-backfill
 *
 * Force-populate `event_code_lifetime_meta_cache` (migration 068) for
 * every distinct `(client_id, event_code)` pair under one or every
 * client. Used to:
 *
 *   1. Bootstrap the cache on the day the migration ships (the cron
 *      otherwise has to wait for its next tick — fine for steady-state,
 *      not for a Friday-demo deadline).
 *   2. Re-run after a Meta token refresh restores access for a venue
 *      that previously errored.
 *   3. Manually verify the fetch path on a specific venue
 *      (`event_code` filter narrows to one venue).
 *
 * Auth: cron-secret header OR an authenticated session whose user owns
 *       every targeted client. Cron-secret uses the service-role
 *       client; user sessions use the standard auth client and the RLS
 *       on `clients` filters to their own rows.
 *
 * Request body (all optional):
 *   {
 *     "client_id": "uuid",        // narrow to one client
 *     "event_code": "WC26-MANCHESTER", // narrow to one event_code
 *     "force": true               // bypass the freshness guard so a
 *                                 // recently-cached row is rewritten
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "processed": [...{ client_id, event_code, ok, reach, ... }],
 *     "summary": { ok, failed, skipped }
 *   }
 *
 * The route is idempotent — safe to run multiple times. Each
 * `(client_id, event_code)` pair triggers ONE Meta API call.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RequestBody {
  client_id?: unknown;
  event_code?: unknown;
}

interface ProcessedRow {
  client_id: string;
  event_code: string;
  ok: boolean;
  reach: number | null;
  impressions: number | null;
  campaigns: number;
  reason?: string;
  error?: string;
}

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    // Empty body is fine — defaults to "every client, every event_code"
    body = {};
  }

  const filterClientId =
    typeof body.client_id === "string" && body.client_id.length > 0
      ? body.client_id
      : null;
  const filterEventCode =
    typeof body.event_code === "string" && body.event_code.length > 0
      ? body.event_code
      : null;

  // Cron-secret callers get the service-role client (bypasses RLS).
  // Authenticated dashboard sessions go through the standard auth
  // client and pick up the user-scoped RLS on `clients` — so a user
  // accidentally pointing this at someone else's client_id gets an
  // empty events list rather than a permission leak.
  const cronAuthorized = isCronAuthorized(req);
  let supabase: Awaited<ReturnType<typeof createClient>>;
  if (cronAuthorized) {
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
  } else {
    supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  // Pull distinct (client_id, event_code, user_id, ad_account) tuples.
  // user_id is needed to resolve the OAuth token; ad_account hangs off
  // `clients`. We also want to walk only events with a populated
  // event_code (ungrouped events have nothing to cache).
  let eventsQuery = supabase
    .from("events")
    .select(
      "client_id, event_code, user_id, client:clients ( meta_ad_account_id )",
    )
    .not("event_code", "is", null);
  if (filterClientId) eventsQuery = eventsQuery.eq("client_id", filterClientId);
  if (filterEventCode)
    eventsQuery = eventsQuery.eq("event_code", filterEventCode);

  const { data: rawEvents, error: listErr } = await eventsQuery;
  if (listErr) {
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 },
    );
  }

  // Collapse to one entry per (client_id, event_code). The first row
  // for the pair sets the `user_id` and `ad_account_id` — every event
  // under the same client carries the same client/account anyway.
  type Tuple = {
    client_id: string;
    event_code: string;
    user_id: string;
    ad_account_id: string | null;
  };
  const byPair = new Map<string, Tuple>();
  for (const row of rawEvents ?? []) {
    const r = row as unknown as {
      client_id: string;
      event_code: string;
      user_id: string;
      client?: { meta_ad_account_id: string | null } | null;
    };
    if (!r.client_id || !r.event_code || !r.user_id) continue;
    const key = `${r.client_id}\u0000${r.event_code}`;
    if (byPair.has(key)) continue;
    byPair.set(key, {
      client_id: r.client_id,
      event_code: r.event_code,
      user_id: r.user_id,
      ad_account_id: r.client?.meta_ad_account_id ?? null,
    });
  }

  const processed: ProcessedRow[] = [];
  let okCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (const tuple of byPair.values()) {
    if (!tuple.ad_account_id) {
      skipCount += 1;
      processed.push({
        client_id: tuple.client_id,
        event_code: tuple.event_code,
        ok: false,
        reach: null,
        impressions: null,
        campaigns: 0,
        reason: "no_ad_account",
      });
      continue;
    }
    try {
      const { token } = await resolveServerMetaToken(supabase, tuple.user_id);
      const lifetime = await fetchEventLifetimeMetaMetrics({
        eventCode: tuple.event_code,
        adAccountId: tuple.ad_account_id,
        token,
      });
      if (!lifetime.ok) {
        failCount += 1;
        processed.push({
          client_id: tuple.client_id,
          event_code: tuple.event_code,
          ok: false,
          reach: null,
          impressions: null,
          campaigns: 0,
          reason: lifetime.error.reason,
          error: lifetime.error.message,
        });
        continue;
      }
      const upsert = await upsertEventCodeLifetimeMetaCache(supabase, {
        clientId: tuple.client_id,
        eventCode: tuple.event_code,
        meta_reach: lifetime.totals.reach > 0 ? Math.round(lifetime.totals.reach) : null,
        meta_impressions:
          lifetime.totals.impressions > 0
            ? Math.round(lifetime.totals.impressions)
            : null,
        meta_link_clicks:
          lifetime.totals.linkClicks > 0
            ? Math.round(lifetime.totals.linkClicks)
            : null,
        meta_regs:
          lifetime.totals.metaRegs > 0
            ? Math.round(lifetime.totals.metaRegs)
            : null,
        meta_video_plays_3s:
          lifetime.totals.videoPlays3s > 0
            ? Math.round(lifetime.totals.videoPlays3s)
            : null,
        meta_video_plays_15s:
          lifetime.totals.videoPlays15s > 0
            ? Math.round(lifetime.totals.videoPlays15s)
            : null,
        meta_video_plays_p100:
          lifetime.totals.videoPlaysP100 > 0
            ? Math.round(lifetime.totals.videoPlaysP100)
            : null,
        meta_engagements:
          lifetime.totals.engagements > 0
            ? Math.round(lifetime.totals.engagements)
            : null,
        campaign_names: lifetime.campaignNames,
      });
      if (upsert.ok) {
        okCount += 1;
        processed.push({
          client_id: tuple.client_id,
          event_code: tuple.event_code,
          ok: true,
          reach: lifetime.totals.reach,
          impressions: lifetime.totals.impressions,
          campaigns: lifetime.campaignNames.length,
        });
      } else {
        failCount += 1;
        processed.push({
          client_id: tuple.client_id,
          event_code: tuple.event_code,
          ok: false,
          reach: null,
          impressions: null,
          campaigns: lifetime.campaignNames.length,
          error: upsert.error,
        });
      }
    } catch (err) {
      failCount += 1;
      processed.push({
        client_id: tuple.client_id,
        event_code: tuple.event_code,
        ok: false,
        reach: null,
        impressions: null,
        campaigns: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    summary: {
      total: byPair.size,
      ok: okCount,
      failed: failCount,
      skipped: skipCount,
    },
  });
}
