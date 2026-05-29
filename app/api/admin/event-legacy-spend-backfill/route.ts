import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { graphGetWithToken } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import {
  metaCampaignFilterPrefix,
  campaignMatchesBracketedEventCode,
} from "@/lib/insights/meta-event-code-match";
import { fetchEventDailyMetaMetrics } from "@/lib/insights/meta";
import {
  upsertMetaRollups,
  type MetaUpsertRow,
} from "@/lib/db/event-daily-rollups";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { FOURTHEFANS_CLIENT_ID } from "@/lib/dashboard/rollup-meta-reconcile-log";
import { createServiceRoleClient, createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * The live cron window is 60 days (PR #479 cap — Edinburgh pagination fix).
 * This backfill covers everything BEFORE that window so the two ranges are
 * disjoint and there is zero risk of write-collision with the live cron.
 */
const LIVE_CRON_WINDOW_DAYS = 60;

// ─── Types ───────────────────────────────────────────────────────────────────

interface CampaignMeta {
  id: string;
  name: string;
  start_time?: string;
  created_time?: string;
}

interface GraphPaged<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

interface EventResult {
  event_id: string;
  event_code: string;
  window: { since: string; until: string } | null;
  skipped?: boolean;
  skip_reason?: string;
  campaigns_seen: number;
  rows_written: number;
  spend_added_gbp: number;
  error?: string;
}

interface RequestBody {
  event_id?: unknown;
  client_id?: unknown;
}

type EvRow = {
  id: string;
  user_id: string;
  client_id: string | null;
  event_code: string | null;
  client: {
    meta_ad_account_id: string | null;
  } | null;
};

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

// ─── Campaign metadata fetch ──────────────────────────────────────────────────

/**
 * Fetches all campaigns for the given event_code from the ad account,
 * including PAUSED and ARCHIVED so we can find the earliest start_time.
 * Intentionally does NOT call fetchEventDailyMetaMetrics (which we must
 * not modify) — this is a lightweight metadata-only query.
 */
async function fetchCampaignMetadata(args: {
  adAccountId: string;
  eventCode: string;
  token: string;
}): Promise<CampaignMeta[]> {
  const { adAccountId, eventCode, token } = args;
  const account = withActPrefix(adAccountId);
  const filterPrefix = metaCampaignFilterPrefix(eventCode);
  // Campaigns edge uses field "name", not "campaign.name" (that prefix is for
  // insights-level filtering only). See listCampaignsForEvent in meta.ts.
  const filtering = JSON.stringify([
    { field: "name", operator: "CONTAIN", value: filterPrefix },
  ]);
  const effectiveStatus = JSON.stringify(["ACTIVE", "PAUSED", "ARCHIVED"]);

  const matched: CampaignMeta[] = [];
  let after: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params: Record<string, string> = {
      fields: "id,name,start_time,created_time",
      filtering,
      effective_status: effectiveStatus,
      limit: "200",
    };
    if (after) params.after = after;

    const res = await graphGetWithToken<GraphPaged<CampaignMeta>>(
      `/${account}/campaigns`,
      params,
      token,
    );

    for (const c of res.data ?? []) {
      if (campaignMatchesBracketedEventCode(c.name, eventCode)) {
        matched.push(c);
      }
    }

    const nextCursor = res.paging?.cursors?.after;
    if (!res.paging?.next || !nextCursor || nextCursor === after) break;
    after = nextCursor;
  }

  return matched;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayMinusDays(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function parseYmd(s: string): Date {
  const d = new Date(s);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ─── Core backfill logic ──────────────────────────────────────────────────────

async function backfillEvent(
  admin: ReturnType<typeof createServiceRoleClient>,
  event: EvRow,
): Promise<EventResult> {
  const eventCode = event.event_code ?? "";
  const clientRel = event.client as
    | { meta_ad_account_id: string | null }
    | Array<{ meta_ad_account_id: string | null }>
    | null;
  const client = Array.isArray(clientRel) ? clientRel[0] : clientRel;
  const adAccountId = client?.meta_ad_account_id ?? null;

  const base: Pick<EventResult, "event_id" | "event_code"> = {
    event_id: event.id,
    event_code: eventCode,
  };

  if (!eventCode) {
    return {
      ...base,
      window: null,
      skipped: true,
      skip_reason: "no_event_code",
      campaigns_seen: 0,
      rows_written: 0,
      spend_added_gbp: 0,
    };
  }

  if (!adAccountId) {
    return {
      ...base,
      window: null,
      skipped: true,
      skip_reason: "no_ad_account",
      campaigns_seen: 0,
      rows_written: 0,
      spend_added_gbp: 0,
    };
  }

  try {
    const { token } = await resolveServerMetaToken(admin, event.user_id);

    // Step 1: fetch campaign metadata (start_time + created_time) so we can
    // determine the earliest date any campaign was active. Include ARCHIVED
    // so fully-stopped legacy campaigns are not missed.
    const campaigns = await fetchCampaignMetadata({
      adAccountId,
      eventCode,
      token,
    });

    if (campaigns.length === 0) {
      return {
        ...base,
        window: null,
        skipped: true,
        skip_reason: "no_matching_campaigns",
        campaigns_seen: 0,
        rows_written: 0,
        spend_added_gbp: 0,
      };
    }

    // Step 2: compute the historical window.
    // since = MIN(start_time, created_time) across all matching campaigns.
    // until = today - LIVE_CRON_WINDOW_DAYS (exclusive of the live cron range).
    let earliest: Date | null = null;
    for (const c of campaigns) {
      const candidates = [c.start_time, c.created_time].filter(Boolean) as string[];
      for (const ts of candidates) {
        const d = parseYmd(ts.slice(0, 10));
        if (earliest === null || d < earliest) earliest = d;
      }
    }

    if (!earliest) {
      return {
        ...base,
        window: null,
        skipped: true,
        skip_reason: "no_campaign_dates",
        campaigns_seen: campaigns.length,
        rows_written: 0,
        spend_added_gbp: 0,
      };
    }

    const since = ymd(earliest);
    // until = today - LIVE_CRON_WINDOW_DAYS. The live cron uses
    // since = today - (LIVE_CRON_WINDOW_DAYS - 1), so its first day is
    // today - 59d = March 31. Our until = today - 60d = March 30, which
    // is disjoint — no write-collision risk between this backfill and the
    // live cron.
    const until = ymd(todayMinusDays(LIVE_CRON_WINDOW_DAYS));

    if (since >= until) {
      return {
        ...base,
        window: { since, until },
        skipped: true,
        skip_reason: "window_covered_by_live_cron",
        campaigns_seen: campaigns.length,
        rows_written: 0,
        spend_added_gbp: 0,
      };
    }

    // Step 3: fetch daily metrics for the historical window.
    // We deliberately do NOT zero-pad — historical days with no spend should
    // stay absent. Zero-padding would clobber rows written by the live cron
    // for any overlap and inflate row counts.
    const result = await fetchEventDailyMetaMetrics({
      eventCode,
      adAccountId,
      token,
      since,
      until,
    });

    if (!result.ok) {
      return {
        ...base,
        window: { since, until },
        campaigns_seen: campaigns.length,
        rows_written: 0,
        spend_added_gbp: 0,
        error: result.error.message,
      };
    }

    const days = result.days;
    if (days.length === 0) {
      return {
        ...base,
        window: { since, until },
        campaigns_seen: campaigns.length,
        rows_written: 0,
        spend_added_gbp: 0,
      };
    }

    // Convert DailyMetaMetricsRow → MetaUpsertRow (no zero padding).
    const rows: MetaUpsertRow[] = days.map((row) => ({
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
    }));

    const { upserted } = await upsertMetaRollups(admin, {
      userId: event.user_id,
      eventId: event.id,
      rows,
    });

    const spendAdded = rows.reduce((sum, r) => sum + (r.ad_spend ?? 0), 0);

    return {
      ...base,
      window: { since, until },
      campaigns_seen: campaigns.length,
      rows_written: upserted,
      spend_added_gbp: Math.round(spendAdded * 100) / 100,
    };
  } catch (err) {
    return {
      ...base,
      window: null,
      campaigns_seen: 0,
      rows_written: 0,
      spend_added_gbp: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const hasEventId = typeof body.event_id === "string" && body.event_id.length > 0;
  const hasClientId = typeof body.client_id === "string" && body.client_id.length > 0;

  if (!hasEventId && !hasClientId) {
    return NextResponse.json(
      { ok: false, error: "Provide either event_id or client_id in the request body" },
      { status: 400 },
    );
  }

  // client_id mode requires cron-secret auth (same as force=true in existing backfill).
  if (hasClientId && !isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "client_id mode requires Authorization: Bearer <CRON_SECRET>" },
      { status: 401 },
    );
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  // ── event_id mode: session-auth + ownership check ──────────────────────────
  if (hasEventId) {
    const eventId = body.event_id as string;

    const { data: event, error: eventErr } = await admin
      .from("events")
      .select("id, user_id, client_id, event_code, client:clients ( meta_ad_account_id )")
      .eq("id", eventId)
      .maybeSingle();

    if (eventErr) {
      return NextResponse.json({ ok: false, error: eventErr.message }, { status: 500 });
    }
    if (!event) {
      return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
    }

    // Verify the caller owns this event.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }
    if (user.id !== event.user_id) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const result = await backfillEvent(admin, event as unknown as EvRow);
    const ok = !result.error;
    return NextResponse.json(
      { ok, events_processed: 1, results: [result] },
      { status: ok ? 200 : 207 },
    );
  }

  // ── client_id mode: bearer-auth, process all events for the client ─────────
  const clientId = body.client_id as string;

  // Safety guard: only allow the 4theFans client in the first version to
  // prevent accidental wide fan-out across other clients.
  if (clientId !== FOURTHEFANS_CLIENT_ID) {
    return NextResponse.json(
      {
        ok: false,
        error: `client_id ${clientId} is not in the approved list. ` +
          `Only the 4theFans client (${FOURTHEFANS_CLIENT_ID}) is supported currently.`,
      },
      { status: 400 },
    );
  }

  const { data: rawEvents, error: listErr } = await admin
    .from("events")
    .select("id, user_id, client_id, event_code, client:clients ( meta_ad_account_id )")
    .eq("client_id", clientId)
    .not("event_code", "is", null);

  if (listErr) {
    return NextResponse.json({ ok: false, error: listErr.message }, { status: 500 });
  }

  const events = (rawEvents ?? []) as unknown as EvRow[];
  const results: EventResult[] = [];

  for (const event of events) {
    const result = await backfillEvent(admin, event);
    results.push(result);
    console.info("[legacy-backfill]", {
      event_id: event.id,
      event_code: event.event_code,
      skipped: result.skipped ?? false,
      skip_reason: result.skip_reason,
      window: result.window,
      campaigns_seen: result.campaigns_seen,
      rows_written: result.rows_written,
      spend_added_gbp: result.spend_added_gbp,
      error: result.error,
    });
  }

  const ok = results.every((r) => !r.error);
  return NextResponse.json(
    { ok, events_processed: results.length, results },
    { status: ok ? 200 : 207 },
  );
}
