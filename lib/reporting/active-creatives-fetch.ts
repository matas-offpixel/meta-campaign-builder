import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { normaliseAdAccountId } from "@/lib/reporting/event-insights";
import {
  groupAdsByCreative,
  type AdInput,
  type CreativePreview,
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
 *   - No `groupByAssetSignature`. That second-layer collapse is
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

interface RawCreative {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  video_id?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  call_to_action_type?: string;
  link_url?: string;
  object_story_spec?: {
    link_data?: {
      name?: string;
      message?: string;
      description?: string;
      image_hash?: string;
      picture?: string;
      link?: string;
      call_to_action?: { type?: string };
    };
    video_data?: {
      title?: string;
      message?: string;
      video_id?: string;
      image_url?: string;
    };
  };
  asset_feed_spec?: {
    images?: Array<{ hash?: string; url?: string }>;
    videos?: Array<{ video_id?: string }>;
    titles?: Array<{ text?: string }>;
    bodies?: Array<{ text?: string }>;
    call_to_action_types?: string[];
    link_urls?: Array<{ website_url?: string }>;
  };
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
  creative?: RawCreative;
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
  /**
   * Max parallel per-campaign /ads fetches. Defaults to
   * {@link CAMPAIGN_CONCURRENCY} (3) — the comfortable ceiling for the
   * authed internal panel where one user is loading at a time.
   *
   * The public share path passes `1` so the share RSC leaves headroom
   * for the headline insights call running in parallel: when both
   * paths fire at concurrency 3 against a wide event on a 7-day
   * window, Meta's per-account rate budget tips into 5xx + network-
   * error retries and the whole report errors out.
   */
  concurrency?: number;
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
  creative: RawCreative | undefined,
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
 * Derive a stable asset signature for the second-layer grouper.
 * First non-null in the priority order wins:
 *   1. Video id  → "video:${id}"
 *   2. Single-image hash → "image:${hash}"
 *   3. Advantage+ asset-set hashes → "assetset:${sortedHashes}"
 *
 * Pure / structural — exported for unit tests and re-use from any
 * fetch path that produces the same RawCreative shape (e.g. a
 * future share-side fetch that also wants the signature).
 *
 * Returns `null` when nothing usable is present (placeholder
 * creatives, mis-tagged ads, or an Advantage+ shell where the
 * asset_feed_spec lists videos / titles but no image hashes — in
 * that case the waterfall falls through to thumbnail / name).
 */
export function deriveAssetSignature(
  creative: RawCreative | undefined,
): string | null {
  if (!creative) return null;
  const oss = creative.object_story_spec;
  // Video first — a video-data spec has a video_id even when the
  // creative also carries a thumbnail image_url, so we want it
  // higher priority than any image-based signal.
  const videoId =
    oss?.video_data?.video_id?.trim() || creative.video_id?.trim() || null;
  if (videoId) return `video:${videoId}`;

  const imageHash = oss?.link_data?.image_hash?.trim();
  if (imageHash) return `image:${imageHash}`;

  // Advantage+ creatives bundle multiple image variants. We sort
  // the hashes so two Meta payloads listing the same set in
  // different orders still collapse to one signature. Drop empties
  // defensively — Meta sometimes returns objects with the wrong
  // sub-fields populated.
  const afsHashes = creative.asset_feed_spec?.images
    ?.map((i) => i.hash?.trim())
    .filter((h): h is string => !!h && h.length > 0)
    .sort();
  if (afsHashes && afsHashes.length > 0) {
    return `assetset:${afsHashes.join("|")}`;
  }

  return null;
}

/**
 * Build the modal preview payload from a raw Meta creative. Each
 * field falls through the same probe order as the existing
 * `extractCopy` (object_story_spec → top-level), so the modal can
 * render across single-image, video, link, and Advantage+ creatives
 * without per-type branching.
 *
 * `image_url` priority: link_data.picture > top-level image_url >
 * thumbnail_url. The first two are the marketer-supplied source;
 * thumbnail_url is Meta's auto-generated 64×64 cropped version,
 * fine for the card but ugly when blown up in the modal — only used
 * as a final fallback.
 */
function extractPreview(creative: RawCreative | undefined): CreativePreview {
  if (!creative) {
    return {
      image_url: null,
      video_id: null,
      instagram_permalink_url: null,
      headline: null,
      body: null,
      call_to_action_type: null,
      link_url: null,
    };
  }
  const oss = creative.object_story_spec;
  const ld = oss?.link_data;
  const vd = oss?.video_data;
  const image_url =
    ld?.picture?.trim() ||
    vd?.image_url?.trim() ||
    creative.image_url?.trim() ||
    creative.thumbnail_url?.trim() ||
    null;
  const video_id =
    vd?.video_id?.trim() || creative.video_id?.trim() || null;
  const instagram_permalink_url =
    creative.instagram_permalink_url?.trim() || null;
  const headline =
    ld?.name?.trim() ||
    creative.title?.trim() ||
    creative.name?.trim() ||
    null;
  const body =
    ld?.message?.trim() ||
    creative.body?.trim() ||
    null;
  const call_to_action_type =
    ld?.call_to_action?.type?.trim() ||
    creative.call_to_action_type?.trim() ||
    null;
  const link_url = ld?.link?.trim() || creative.link_url?.trim() || null;
  return {
    image_url,
    video_id,
    instagram_permalink_url,
    headline,
    body,
    call_to_action_type,
    link_url,
  };
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
  // Meta's nested-field syntax: braces expand related objects.
  // Asset-grouping needs object_story_spec + asset_feed_spec sub-
  // fields (image_hash, video_id, picture, link, call_to_action),
  // and the modal preview pulls from the same payload so we don't
  // round-trip again. asset_feed_spec is requested as a flat field
  // because Meta returns the whole sub-tree when asked by name.
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign_id",
    "campaign{id,name}",
    "adset_id",
    "adset{id,name}",
    "creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_id,effective_object_story_id,instagram_permalink_url,call_to_action_type,link_url,object_story_spec{link_data{name,message,description,image_hash,picture,link,call_to_action{type}},video_data{title,message,video_id,image_url}},asset_feed_spec}",
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
      const preview = extractPreview(ad.creative);
      const primary_asset_signature = deriveAssetSignature(ad.creative);
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
        effective_object_story_id:
          ad.creative?.effective_object_story_id?.trim() || null,
        object_story_id: ad.creative?.object_story_id?.trim() || null,
        primary_asset_signature,
        preview,
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
  const concurrency = Math.max(1, input.concurrency ?? CAMPAIGN_CONCURRENCY);

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

  const semaphore = createSemaphore(concurrency);
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
