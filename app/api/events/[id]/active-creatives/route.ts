import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { getEventByIdServer } from "@/lib/db/events-server";
import { normaliseAdAccountId } from "@/lib/reporting/event-insights";
import {
  groupAdsByCreative,
  type AdInput,
  type CreativeRow,
} from "@/lib/reporting/active-creatives-group";

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
 *   - "meta_campaigns_failed" — 502 (the campaign-list call failed
 *     before we could fan out — distinct from per-campaign ad
 *     failures, which are swallowed and counted in
 *     `meta.campaigns_failed`)
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const PER_EVENT_CAMPAIGN_CAP = 50;
const PER_EVENT_CREATIVE_CAP = 200;
const ADS_PAGE_LIMIT = 50;
const ADS_PAGE_SAFETY = 6; // 50 × 6 = 300 ads per campaign max
const CAMPAIGN_CONCURRENCY = 3;

interface RawAdRow {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  campaign?: { id?: string; name?: string };
  adset_id?: string;
  adset?: { id?: string; name?: string };
  creative?: {
    id?: string;
    name?: string;
    title?: string;
    body?: string;
    thumbnail_url?: string;
    object_story_spec?: {
      link_data?: { name?: string; message?: string; description?: string };
      video_data?: { title?: string; message?: string };
    };
  };
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      reach?: string;
      frequency?: string;
      actions?: Array<{ action_type?: string; value?: string }>;
    }>;
  };
}

interface RawCampaignRow {
  id: string;
  name?: string;
  effective_status?: string;
}

interface PagedResponse<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Pull the headline / body for an ad's creative.
 *
 * Meta surfaces them under three different keys depending on the
 * creative type:
 *   - Page post link ads → object_story_spec.link_data.name / message
 *   - Page post video ads → object_story_spec.video_data.title / message
 *   - Single-image / dynamic creatives → top-level title / body
 *
 * Probing in priority order means dynamic creative ads (which set
 * top-level title) and link ads (which set object_story_spec) both
 * render the same field on the card.
 */
function extractCopy(
  creative: RawAdRow["creative"],
): { headline: string | null; body: string | null } {
  if (!creative) return { headline: null, body: null };
  const oss = creative.object_story_spec;
  const headline =
    creative.title?.trim() ||
    oss?.link_data?.name?.trim() ||
    oss?.video_data?.title?.trim() ||
    null;
  const body =
    creative.body?.trim() ||
    oss?.link_data?.message?.trim() ||
    oss?.link_data?.description?.trim() ||
    oss?.video_data?.message?.trim() ||
    null;
  return { headline, body };
}

/**
 * List the Meta campaign IDs linked to the event via the same
 * substring-on-name convention used by the rest of the dashboard.
 *
 * We could call /insights and dedupe by campaign_id (matches
 * lib/reporting/event-insights.ts) but that costs a second
 * /insights round-trip on top of the per-campaign /ads calls.
 * `/{ad_account}/campaigns?filtering=name CONTAIN <code>` returns
 * only the IDs we actually need. Both ACTIVE and PAUSED campaigns
 * are pulled — an admin commonly leaves the campaign PAUSED at
 * the campaign level while specific ad sets / ads stay ACTIVE for
 * a short re-targeting burst.
 */
async function listLinkedCampaignIds(
  adAccountId: string,
  eventCode: string,
  token: string,
): Promise<RawCampaignRow[]> {
  const params: Record<string, string> = {
    fields: "id,name,effective_status",
    limit: String(PER_EVENT_CAMPAIGN_CAP),
    effective_status: JSON.stringify([
      "ACTIVE",
      "PAUSED",
      "CAMPAIGN_PAUSED",
    ]),
    filtering: JSON.stringify([
      { field: "name", operator: "CONTAIN", value: eventCode },
    ]),
  };
  const res = await graphGetWithToken<PagedResponse<RawCampaignRow>>(
    `/${adAccountId}/campaigns`,
    params,
    token,
  );
  return (res.data ?? []).slice(0, PER_EVENT_CAMPAIGN_CAP);
}

/**
 * Fetch ACTIVE ads for a single campaign, with their creative copy
 * and lifetime insights, and normalise into AdInput rows.
 *
 * Status filter: effective_status=["ACTIVE"] — server-side. The
 * panel exists to answer "what's spending right now"; ads in
 * PAUSED / DELETED / DISAPPROVED states would clutter the view
 * even though they may show non-zero historical spend.
 *
 * Insights window: lifetime (no date_preset / time_range param).
 * Per-ad spend is the meaningful number for "this is what your
 * creative has cost so far" — the panel is operational, not a
 * date-bound performance report.
 */
async function fetchActiveAdsForCampaign(
  campaignId: string,
  campaignName: string | null,
  token: string,
): Promise<AdInput[]> {
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "campaign{id,name}",
    "adset_id",
    "adset{id,name}",
    "creative{id,name,title,body,thumbnail_url,object_story_spec{link_data{name,message,description},video_data{title,message}}}",
    "insights{spend,impressions,clicks,reach,frequency,actions}",
  ].join(",");

  const params: Record<string, string> = {
    fields,
    limit: String(ADS_PAGE_LIMIT),
    effective_status: JSON.stringify(["ACTIVE"]),
  };

  const out: AdInput[] = [];
  let after: string | undefined;
  let pages = 0;
  do {
    if (after) params.after = after;
    const res = await graphGetWithToken<PagedResponse<RawAdRow>>(
      `/${campaignId}/ads`,
      params,
      token,
    );
    for (const ad of res.data ?? []) {
      const insight = ad.insights?.data?.[0];
      const { headline, body } = extractCopy(ad.creative);
      out.push({
        ad_id: ad.id,
        ad_name: ad.name ?? null,
        status: ad.effective_status ?? ad.status ?? null,
        campaign_id: ad.campaign?.id ?? ad.campaign_id ?? campaignId,
        campaign_name: ad.campaign?.name ?? campaignName,
        adset_id: ad.adset?.id ?? ad.adset_id ?? null,
        adset_name: ad.adset?.name ?? null,
        creative_id: ad.creative?.id ?? null,
        creative_name: ad.creative?.name ?? null,
        headline,
        body,
        thumbnail_url: ad.creative?.thumbnail_url ?? null,
        insights: insight
          ? {
              spend: num(insight.spend),
              impressions: num(insight.impressions),
              clicks: num(insight.clicks),
              reach: num(insight.reach),
              frequency: num(insight.frequency),
              actions: (insight.actions ?? []).map((a) => ({
                action_type: a.action_type ?? "",
                value: num(a.value),
              })),
            }
          : null,
      });
    }
    after = res.paging?.cursors?.after;
    pages += 1;
    if (!res.paging?.next) break;
  } while (after && pages < ADS_PAGE_SAFETY);
  return out;
}

/**
 * Tiny in-file semaphore. No external dep — Meta's per-account
 * rate limiting tolerates 3 parallel /ads calls comfortably; we
 * saw 429s sustained at 6+ in the heatmap before we backed off.
 *
 * Usage:
 *   const sem = createSemaphore(3);
 *   await Promise.all(items.map((it) => sem(() => doWork(it))));
 */
function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const run = queue.shift()!;
    run();
  };
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active -= 1;
          next();
        }
      };
      queue.push(run);
      next();
    });
  };
}

function isAuthError(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    if (err.code === 190) return true;
    if (err.type === "OAuthException") return true;
  }
  return false;
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

  const adAccountId = normaliseAdAccountId(adAccountIdRaw);

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

  let campaigns: RawCampaignRow[];
  try {
    campaigns = await listLinkedCampaignIds(adAccountId, eventCode, token);
  } catch (err) {
    if (isAuthError(err)) {
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

  if (campaigns.length === 0) {
    return NextResponse.json({
      ok: true,
      reason: "no_linked_campaigns",
      creatives: [],
      ad_account_id: adAccountId,
      event_code: eventCode,
      fetched_at: new Date().toISOString(),
      meta: emptyMeta(),
    });
  }

  const semaphore = createSemaphore(CAMPAIGN_CONCURRENCY);
  let authExpired = false;
  const failed: Array<{ campaign_id: string; error: string }> = [];

  const results = await Promise.all(
    campaigns.map((c) =>
      semaphore(async () => {
        try {
          return await fetchActiveAdsForCampaign(
            c.id,
            c.name ?? null,
            token,
          );
        } catch (err) {
          if (isAuthError(err)) {
            authExpired = true;
          }
          const msg =
            err instanceof MetaApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          console.warn(
            `[active-creatives] campaign ${c.id} (${c.name ?? "?"}) failed:`,
            msg,
          );
          failed.push({ campaign_id: c.id, error: msg });
          return [] as AdInput[];
        }
      }),
    ),
  );

  // If every linked campaign failed because the token's dead, the
  // panel would render an empty grid which looks indistinguishable
  // from "no active ads". Surface auth-expired explicitly so the UI
  // can prompt for a reconnect instead.
  if (authExpired && failed.length === campaigns.length) {
    return NextResponse.json(
      {
        ok: false,
        reason: "auth_expired",
        error: "Facebook session expired — reconnect to refresh.",
      },
      { status: 401 },
    );
  }

  const ads = results.flat();
  const droppedNoCreative = ads.filter((a) => !a.creative_id).length;
  let creatives = groupAdsByCreative(ads);
  let truncated = false;
  if (creatives.length > PER_EVENT_CREATIVE_CAP) {
    creatives = creatives.slice(0, PER_EVENT_CREATIVE_CAP);
    truncated = true;
  }

  const payload: {
    ok: true;
    creatives: CreativeRow[];
    ad_account_id: string;
    event_code: string;
    fetched_at: string;
    meta: ReturnType<typeof emptyMeta>;
  } = {
    ok: true,
    creatives,
    ad_account_id: adAccountId,
    event_code: eventCode,
    fetched_at: new Date().toISOString(),
    meta: {
      campaigns_total: campaigns.length,
      campaigns_failed: failed.length,
      ads_fetched: ads.length,
      dropped_no_creative: droppedNoCreative,
      truncated,
    },
  };
  return NextResponse.json(payload);
}

function emptyMeta() {
  return {
    campaigns_total: 0,
    campaigns_failed: 0,
    ads_fetched: 0,
    dropped_no_creative: 0,
    truncated: false,
  };
}
