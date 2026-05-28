import { NextResponse, type NextRequest } from "next/server";

import {
  fetchEventDailyMetaMetrics,
  fetchEventLifetimeMetaMetrics,
} from "@/lib/insights/meta";
import type { DailyMetaMetricsRow } from "@/lib/insights/types";
import { eachInclusiveYmd } from "@/lib/dashboard/rollup-date-range";
import {
  upsertMetaRollups,
  type MetaUpsertRow,
} from "@/lib/db/event-daily-rollups";
import { upsertEventCodeLifetimeMetaCache } from "@/lib/db/event-code-lifetime-meta-cache";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { runWithConcurrency } from "@/lib/audiences/run-with-concurrency";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/rollup-canonical-clicks-lpv-backfill
 *
 * One-time historical backfill for issue #467 PR-A — the rollup writer
 * convergence. Rewrites the `link_clicks` (engagement-clicks, post-swap)
 * and `landing_page_views` columns on:
 *
 *   - `event_daily_rollups`         (per-event, per-day, 180-day window)
 *   - `event_code_lifetime_meta_cache` (per `(client_id, event_code)`,
 *     `date_preset=maximum`)
 *
 * for every event with an `event_code`. Without this backfill the new
 * columns mean two different things on either side of the merge date
 * (pre-PR rows hold `inline_link_clicks`, post-PR rows hold `clicks` /
 * "Clicks (all)"; LPV is NULL pre-PR), which breaks every historical
 * comparison the downstream surfaces draw.
 *
 * Idempotent. Each Meta Insights call replaces the corresponding row's
 * `link_clicks` + `landing_page_views` columns. The non-touched Meta
 * columns (`ad_spend`, `meta_reach`, `meta_purchases`, …) are also
 * rewritten because `upsertMetaRollups` writes the full Meta payload —
 * acceptable here because the same Meta call is the upstream source
 * (no double-source skew possible within one request).
 *
 * Auth: Bearer `CRON_SECRET` only. The route is cron-only-by-policy —
 * not a dashboard surface — so no user-session fallback like the
 * lifetime-cache backfill.
 *
 * Request body (all optional):
 *   {
 *     "event_code": "WC26-EDINBURGH",  // narrow to one event_code
 *     "client_id": "uuid",             // narrow to one client
 *     "days_back": 180                 // override window (default 180)
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "window": { "since": "2026-…", "until": "2026-…" },
 *     "event_codes_processed": 47,
 *     "rows_updated_rollup": 8,123,
 *     "rows_updated_cache": 47,
 *     "errors": [{ event_code, reason, message }]
 *   }
 *
 * Concurrency capped at 3 per `runWithConcurrency` — matches the PR
 * #379 backfill pattern (Meta /insights rate-limits aggressively at
 * 5+ simultaneous account-level reads).
 *
 * Run via Vercel MCP after deploy lands. Verify by re-querying the
 * same window on a sample event_code (e.g. WC26-EDINBURGH) and
 * confirming `link_clicks` now matches "Clicks (all)" in Ads Manager
 * (vs the pre-PR "Link clicks" value).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const DEFAULT_DAYS_BACK = 180;
const CONCURRENCY = 3;

interface RequestBody {
  event_code?: unknown;
  client_id?: unknown;
  days_back?: unknown;
}

interface ProcessedSummary {
  event_codes_processed: number;
  rows_updated_rollup: number;
  rows_updated_cache: number;
  errors: Array<{
    event_code: string;
    client_id: string | null;
    reason: string;
    message: string;
  }>;
}

interface EventTuple {
  id: string;
  user_id: string;
  client_id: string | null;
  event_code: string;
  ad_account_id: string | null;
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

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const filterEventCode =
    typeof body.event_code === "string" && body.event_code.length > 0
      ? body.event_code
      : null;
  const filterClientId =
    typeof body.client_id === "string" && body.client_id.length > 0
      ? body.client_id
      : null;
  const daysBack =
    typeof body.days_back === "number" &&
    Number.isFinite(body.days_back) &&
    body.days_back > 0 &&
    body.days_back <= 365
      ? Math.floor(body.days_back)
      : DEFAULT_DAYS_BACK;

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

  // Compute the Meta window. `until` = today; `since` = today - (daysBack - 1)
  // so a 180-day window inclusive ends up as exactly 180 calendar days.
  const untilDate = new Date();
  const sinceDate = new Date(untilDate);
  sinceDate.setDate(sinceDate.getDate() - (daysBack - 1));
  const window = { since: ymd(sinceDate), until: ymd(untilDate) };

  // Pull every event with an event_code + a Meta ad account. Group by
  // (client_id, event_code) afterwards — the lifetime cache key — but
  // also keep the per-event identity to run the rollup writer for each
  // sibling event_id under the same code (the rollup writes are
  // per-event-day, not per-event-code-day).
  const { data: rawEvents, error: listErr } = await supabase
    .from("events")
    .select(
      "id, user_id, client_id, event_code, client:clients ( meta_ad_account_id )",
    )
    .not("event_code", "is", null);

  if (listErr) {
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 },
    );
  }

  type RawEv = {
    id: string;
    user_id: string;
    client_id: string | null;
    event_code: string | null;
    client:
      | { meta_ad_account_id: string | null }
      | Array<{ meta_ad_account_id: string | null }>
      | null;
  };

  const events: EventTuple[] = [];
  for (const raw of (rawEvents ?? []) as unknown as RawEv[]) {
    if (!raw.event_code) continue;
    if (filterEventCode && raw.event_code !== filterEventCode) continue;
    if (filterClientId && raw.client_id !== filterClientId) continue;
    const clientRel = Array.isArray(raw.client) ? raw.client[0] : raw.client;
    const adAccountId = clientRel?.meta_ad_account_id ?? null;
    events.push({
      id: raw.id,
      user_id: raw.user_id,
      client_id: raw.client_id,
      event_code: raw.event_code,
      ad_account_id: adAccountId,
    });
  }

  // Group by event_code so we only do ONE lifetime call per code even
  // when N events share it. Pick the first event under each code as
  // the "owner" for token + ad account resolution; rollup writes still
  // fan out across every sibling event_id.
  const byCode = new Map<string, EventTuple[]>();
  for (const ev of events) {
    const bucket = byCode.get(ev.event_code) ?? [];
    bucket.push(ev);
    byCode.set(ev.event_code, bucket);
  }

  const codes = [...byCode.keys()].sort();

  const summary: ProcessedSummary = {
    event_codes_processed: 0,
    rows_updated_rollup: 0,
    rows_updated_cache: 0,
    errors: [],
  };

  await runWithConcurrency(codes, CONCURRENCY, async (eventCode) => {
    const siblings = byCode.get(eventCode) ?? [];
    if (siblings.length === 0) return;
    const owner = siblings[0]!;
    if (!owner.ad_account_id) {
      summary.errors.push({
        event_code: eventCode,
        client_id: owner.client_id,
        reason: "no_ad_account",
        message: "owner event has no Meta ad account",
      });
      return;
    }

    let token: string;
    try {
      ({ token } = await resolveServerMetaToken(supabase, owner.user_id));
    } catch (err) {
      summary.errors.push({
        event_code: eventCode,
        client_id: owner.client_id,
        reason: "token_resolution_failed",
        message: err instanceof Error ? err.message : "Unknown error",
      });
      return;
    }

    // ─── Daily rollup leg ─────────────────────────────────────────
    // Fan out per-sibling — Meta returns the same campaign filter
    // result, but the rollup row is keyed `(event_id, date)` so each
    // sibling under the same code gets its own write.
    let dailyOk = false;
    let dailyRows: MetaUpsertRow[] = [];
    try {
      const meta = await fetchEventDailyMetaMetrics({
        eventCode,
        adAccountId: owner.ad_account_id,
        token,
        since: window.since,
        until: window.until,
      });
      if (!meta.ok) {
        summary.errors.push({
          event_code: eventCode,
          client_id: owner.client_id,
          reason: meta.error.reason,
          message: meta.error.message,
        });
      } else {
        dailyRows = zeroPadMetaRows(meta.days, window);
        dailyOk = true;
      }
    } catch (err) {
      summary.errors.push({
        event_code: eventCode,
        client_id: owner.client_id,
        reason: "daily_fetch_threw",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    if (dailyOk) {
      for (const ev of siblings) {
        try {
          const upsert = await upsertMetaRollups(supabase, {
            userId: ev.user_id,
            eventId: ev.id,
            rows: dailyRows,
          });
          summary.rows_updated_rollup += upsert.upserted;
        } catch (err) {
          summary.errors.push({
            event_code: eventCode,
            client_id: ev.client_id,
            reason: "rollup_upsert_failed",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }
    }

    // ─── Lifetime cache leg ───────────────────────────────────────
    // One call per event_code regardless of sibling count.
    if (!owner.client_id) {
      // Lifetime cache is keyed `(client_id, event_code)`. Sibling
      // events with no client are dropped from the cache leg only —
      // the daily rollups still ran above.
      summary.event_codes_processed += 1;
      return;
    }
    try {
      const lifetime = await fetchEventLifetimeMetaMetrics({
        eventCode,
        adAccountId: owner.ad_account_id,
        token,
      });
      if (!lifetime.ok) {
        summary.errors.push({
          event_code: eventCode,
          client_id: owner.client_id,
          reason: lifetime.error.reason,
          message: lifetime.error.message,
        });
      } else {
        const upsert = await upsertEventCodeLifetimeMetaCache(supabase, {
          clientId: owner.client_id,
          eventCode,
          meta_reach: nullIfZero(lifetime.totals.reach),
          meta_impressions: nullIfZero(lifetime.totals.impressions),
          meta_link_clicks: nullIfZero(lifetime.totals.linkClicks),
          meta_landing_page_views: nullIfZero(
            lifetime.totals.landingPageViews,
          ),
          meta_regs: nullIfZero(lifetime.totals.metaRegs),
          meta_video_plays_3s: nullIfZero(lifetime.totals.videoPlays3s),
          meta_video_plays_15s: nullIfZero(lifetime.totals.videoPlays15s),
          meta_video_plays_p100: nullIfZero(lifetime.totals.videoPlaysP100),
          meta_engagements: nullIfZero(lifetime.totals.engagements),
          campaign_names: lifetime.campaignNames,
        });
        if (upsert.ok) {
          summary.rows_updated_cache += 1;
        } else {
          summary.errors.push({
            event_code: eventCode,
            client_id: owner.client_id,
            reason: "cache_upsert_failed",
            message: upsert.error,
          });
        }
      }
    } catch (err) {
      summary.errors.push({
        event_code: eventCode,
        client_id: owner.client_id,
        reason: "lifetime_fetch_threw",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    summary.event_codes_processed += 1;
  });

  const ok = summary.errors.length === 0;
  return NextResponse.json(
    {
      ok,
      window,
      ...summary,
    },
    { status: ok ? 200 : 207 },
  );
}

function nullIfZero(value: number): number | null {
  return value > 0 ? Math.round(value) : null;
}

// Mirrors `zeroPadMetaRows` in `app/api/admin/event-rollup-backfill/route.ts`
// — kept inline so this route can run standalone (the source helper
// isn't exported). PR-B (the funnel-pacing surface rebuild) is a good
// time to extract the shared helper into `lib/dashboard/`.
function zeroPadMetaRows(
  rows: DailyMetaMetricsRow[],
  windowArg: { since: string; until: string },
): MetaUpsertRow[] {
  const byDate = new Map<string, MetaUpsertRow>();
  for (const row of rows) {
    byDate.set(row.day, {
      date: row.day,
      ad_spend: row.spend,
      ad_spend_presale: row.presaleSpend ?? 0,
      link_clicks: row.linkClicks,
      landing_page_views: row.landingPageViews,
      meta_regs: row.metaRegs,
      meta_purchases: row.metaPurchases ?? 0,
      meta_leads: row.metaLeads ?? 0,
      meta_impressions: row.impressions,
      meta_reach: row.reach,
      meta_video_plays_3s: row.videoPlays3s,
      meta_video_plays_15s: row.videoPlays15s,
      meta_video_plays_p100: row.videoPlaysP100,
      meta_engagements: row.engagements,
    });
  }
  for (const date of eachInclusiveYmd(windowArg.since, windowArg.until)) {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        ad_spend: 0,
        ad_spend_presale: 0,
        link_clicks: 0,
        landing_page_views: 0,
        meta_regs: 0,
        meta_purchases: 0,
        meta_leads: 0,
        meta_impressions: 0,
        meta_reach: 0,
        meta_video_plays_3s: 0,
        meta_video_plays_15s: 0,
        meta_video_plays_p100: 0,
        meta_engagements: 0,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
