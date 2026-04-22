import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { getEventByIdServer } from "@/lib/db/events-server";
import {
  fetchActiveCreativesForEvent,
  FacebookAuthExpiredError,
} from "@/lib/reporting/active-creatives-fetch";
import type { CreativeRow } from "@/lib/reporting/active-creatives-group";

/**
 * GET /api/events/[id]/active-creatives
 *
 * Returns one row per ACTIVE creative running across all Meta
 * campaigns linked to this event. "Linked" follows the same
 * convention as `/api/reporting/event-campaigns`: campaigns whose
 * name contains the event_code (case-insensitive) on the client's
 * default ad account.
 *
 * Why per-event, live, no cache: the panel answers the operational
 * question "what creatives are spending right now". A 5-minute-old
 * snapshot is misleading once a campaign goes paused. The 60s
 * maxDuration is more than enough — a single event typically maps
 * to ≤ 4 campaigns; a worst-case Junction-2-style account with 10
 * linked campaigns still fits comfortably under the cap thanks to
 * the concurrency-3 semaphore (Meta gets unhappy at 10+ parallel
 * /ads calls on one account).
 *
 * The actual Meta plumbing now lives in
 * `lib/reporting/active-creatives-fetch.ts` so the share-side
 * server component can call the same fetcher with a service-role-
 * resolved owner token. This handler is the authed-user wrapper
 * that adds Supabase session resolution + the user-facing JSON
 * envelope.
 *
 * Response shape:
 *   { ok: true,
 *     creatives: CreativeRow[],
 *     ad_account_id, event_code,
 *     fetched_at: ISO,
 *     meta: { campaigns_total, campaigns_failed, ads_fetched,
 *             dropped_no_creative, truncated } }
 *
 * Failure modes (`ok: false`):
 *   - "not_signed_in"        — 401
 *   - "event_not_found"      — 404
 *   - "no_event_code"        — 200, creatives=[]
 *   - "no_ad_account"        — 200, creatives=[]
 *   - "no_linked_campaigns"  — 200, creatives=[]
 *   - "auth_expired"         — 401 (FB OAuthException / code 190)
 *   - "meta_token_failed"    — 502
 *   - "meta_campaigns_failed" — 502 (the fetch helper threw a
 *     non-auth error before it could fan out — distinct from
 *     per-campaign ad failures, which are swallowed inside the
 *     helper and counted in `meta.campaigns_failed`)
 */

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteMeta {
  campaigns_total: number;
  campaigns_failed: number;
  ads_fetched: number;
  dropped_no_creative: number;
  truncated: boolean;
  /**
   * Backstop bucket for per-ad insight rows that didn't match any
   * AdInput (almost always ARCHIVED / DELETED ads with historical
   * spend in the window). Always present so the panel can render
   * an "Other / unattributed" footer line — `ads_count === 0`
   * means everything reconciled.
   */
  unattributed: {
    ads_count: number;
    spend: number;
    impressions: number;
    clicks: number;
    inline_link_clicks: number;
    landingPageViews: number;
    registrations: number;
    purchases: number;
  };
}

function emptyMeta(): RouteMeta {
  return {
    campaigns_total: 0,
    campaigns_failed: 0,
    ads_fetched: 0,
    dropped_no_creative: 0,
    truncated: false,
    unattributed: {
      ads_count: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      inline_link_clicks: 0,
      landingPageViews: 0,
      registrations: 0,
      purchases: 0,
    },
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "not_signed_in", error: "Not signed in" },
      { status: 401 },
    );
  }

  const event = await getEventByIdServer(eventId);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_found", error: "Event not found" },
      { status: 404 },
    );
  }

  const eventCode = event.event_code?.trim() ?? "";
  const adAccountIdRaw =
    (event.client?.meta_ad_account_id as string | null | undefined) ?? null;

  if (!eventCode) {
    return NextResponse.json({
      ok: true,
      reason: "no_event_code",
      creatives: [],
      ad_account_id: adAccountIdRaw,
      event_code: null,
      fetched_at: new Date().toISOString(),
      meta: emptyMeta(),
    });
  }
  if (!adAccountIdRaw) {
    return NextResponse.json({
      ok: true,
      reason: "no_ad_account",
      creatives: [],
      ad_account_id: null,
      event_code: eventCode,
      fetched_at: new Date().toISOString(),
      meta: emptyMeta(),
    });
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "meta_token_failed",
        error: err instanceof Error ? err.message : "No Meta token available",
      },
      { status: 502 },
    );
  }

  let result;
  try {
    result = await fetchActiveCreativesForEvent({
      adAccountId: adAccountIdRaw,
      eventCode,
      token,
    });
  } catch (err) {
    if (err instanceof FacebookAuthExpiredError) {
      return NextResponse.json(
        {
          ok: false,
          reason: "auth_expired",
          error: "Facebook session expired — reconnect to refresh.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reason: "meta_campaigns_failed",
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  if (result.meta.campaigns_total === 0) {
    return NextResponse.json({
      ok: true,
      reason: "no_linked_campaigns",
      creatives: [],
      ad_account_id: result.ad_account_id,
      event_code: eventCode,
      fetched_at: new Date().toISOString(),
      meta: emptyMeta(),
    });
  }

  const payload: {
    ok: true;
    creatives: CreativeRow[];
    ad_account_id: string;
    event_code: string;
    fetched_at: string;
    meta: RouteMeta;
  } = {
    ok: true,
    creatives: result.creatives,
    ad_account_id: result.ad_account_id,
    event_code: eventCode,
    fetched_at: new Date().toISOString(),
    meta: {
      campaigns_total: result.meta.campaigns_total,
      campaigns_failed: result.meta.campaigns_failed,
      ads_fetched: result.meta.ads_fetched,
      dropped_no_creative: result.meta.dropped_no_creative,
      truncated: result.meta.truncated,
      unattributed: result.meta.unattributed,
    },
  };
  return NextResponse.json(payload);
}
