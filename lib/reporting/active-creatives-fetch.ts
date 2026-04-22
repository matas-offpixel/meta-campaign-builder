import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { normaliseAdAccountId } from "@/lib/reporting/event-insights";
import {
  groupAdsByCreative,
  type AdInput,
  type CreativeRow,
} from "@/lib/reporting/active-creatives-group";

/**
 * lib/reporting/active-creatives-fetch.ts
 *
 * Server-only Meta fetcher that produces the per-event "Active
 * Creatives" payload. Extracted from the original
 * `app/api/events/[id]/active-creatives/route.ts` so the share-side
 * server component (`components/share/share-active-creatives-
 * section.tsx`) can reuse the same fetch path without duplicating
 * Meta's quirks.
 *
 * What it does:
 *   1. Lists campaigns whose name contains `eventCode` on the
 *      client's ad account (matches the convention from
 *      `lib/reporting/event-insights.ts`).
 *   2. Fans out per-campaign ad fetches with concurrency capped at
 *      3 via an in-file semaphore — Meta gets unhappy at 10+
 *      parallel /ads calls on a single account.
 *   3. Wraps each per-campaign call in `try/catch` so a single bad
 *      campaign returns zero ads for itself rather than 5xx-ing
 *      the whole event.
 *   4. Returns flat ad rows passed through `groupAdsByCreative`,
 *      defensively truncated to 200 rows with a `truncated` flag.
 *
 * What it does NOT do:
 *   - No Supabase. The caller resolves event_code + ad_account_id
 *     and provides the FB token (so this module works equally
 *     well behind the authed route or the service-role share
 *     route).
 *   - No `groupByNormalisedName`. That second-layer collapse is
 *     applied per-surface (internal toggle, share fixed).
 */

const PER_EVENT_CAMPAIGN_CAP = 50;
export const PER_EVENT_CREATIVE_CAP = 200;
const ADS_PAGE_LIMIT = 50;
const ADS_PAGE_SAFETY = 6;
const CAMPAIGN_CONCURRENCY = 3;

interface RawCampaignRow {
  id: string;
  name?: string;
  effective_status?: string;
}

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

interface PagedResponse<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export interface FetchActiveCreativesInput {
  /** Either `act_<numeric>` or bare numeric — normalised internally. */
  adAccountId: string;
  /** Case-insensitive substring match against `campaign_name`. */
  eventCode: string;
  /** OAuth token for the user / share owner. */
  token: string;
}

export interface FetchActiveCreativesMeta {
  campaigns_total: number;
  campaigns_failed: number;
  ads_fetched: number;
  dropped_no_creative: number;
  truncated: boolean;
  /** Set when every campaign failed because the FB token is dead. */
  auth_expired: boolean;
}

export interface FetchActiveCreativesResult {
  creatives: CreativeRow[];
  ad_account_id: string;
  meta: FetchActiveCreativesMeta;
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Probe the three places Meta hides creative copy depending on ad
 * type (single image / dynamic creative / page-post link / page-
 * post video). First non-empty wins so the same field on the card
 * renders consistently across types.
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
 * saw 429s sustained at 6+ in the heatmap before backing off.
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

export function isMetaAuthError(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    if (err.code === 190) return true;
    if (err.type === "OAuthException") return true;
  }
  return false;
}

/**
 * Auth-expired sentinel thrown by `fetchActiveCreativesForEvent`
 * when the upstream campaign-list call fails with OAuthException
 * / code 190. Catchable by `instanceof` upstream.
 */
export class FacebookAuthExpiredError extends Error {
  constructor(message = "Facebook session expired") {
    super(message);
    this.name = "FacebookAuthExpiredError";
  }
}

/**
 * Fetch the active-creatives payload for one event.
 *
 * Throws:
 *   - `FacebookAuthExpiredError` when the campaign-list call fails
 *     with code 190 / OAuthException, or when ALL per-campaign ad
 *     fetches fail for the same reason.
 *   - `MetaApiError` (or a generic Error) when the campaign-list
 *     call fails for any other reason — caller decides how to
 *     surface (502 from the API route, muted note in the share).
 *
 * Returns an empty `creatives` array (not a throw) when the event
 * code matches no campaigns — the caller uses `meta.campaigns_total
 * === 0` to render the right empty state.
 */
export async function fetchActiveCreativesForEvent(
  input: FetchActiveCreativesInput,
): Promise<FetchActiveCreativesResult> {
  const adAccountId = normaliseAdAccountId(input.adAccountId);
  const { eventCode, token } = input;

  let campaigns: RawCampaignRow[];
  try {
    campaigns = await listLinkedCampaignIds(adAccountId, eventCode, token);
  } catch (err) {
    if (isMetaAuthError(err)) {
      throw new FacebookAuthExpiredError();
    }
    throw err;
  }

  if (campaigns.length === 0) {
    return {
      creatives: [],
      ad_account_id: adAccountId,
      meta: {
        campaigns_total: 0,
        campaigns_failed: 0,
        ads_fetched: 0,
        dropped_no_creative: 0,
        truncated: false,
        auth_expired: false,
      },
    };
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
          if (isMetaAuthError(err)) authExpired = true;
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

  if (authExpired && failed.length === campaigns.length) {
    // Every linked campaign failed because the token is dead — surface
    // as auth-expired rather than letting the panel render an empty
    // grid that's indistinguishable from "no active ads".
    throw new FacebookAuthExpiredError();
  }

  const ads = results.flat();
  const droppedNoCreative = ads.filter((a) => !a.creative_id).length;
  let creatives = groupAdsByCreative(ads);
  let truncated = false;
  if (creatives.length > PER_EVENT_CREATIVE_CAP) {
    creatives = creatives.slice(0, PER_EVENT_CREATIVE_CAP);
    truncated = true;
  }

  return {
    creatives,
    ad_account_id: adAccountId,
    meta: {
      campaigns_total: campaigns.length,
      campaigns_failed: failed.length,
      ads_fetched: ads.length,
      dropped_no_creative: droppedNoCreative,
      truncated,
      auth_expired: authExpired,
    },
  };
}
