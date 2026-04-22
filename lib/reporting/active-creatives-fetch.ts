import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { isReduceDataError } from "@/lib/meta/error-classify";
import { normaliseAdAccountId } from "@/lib/reporting/event-insights";
import {
  groupAdsByCreative,
  type AdInput,
  type CreativePreview,
  type CreativeRow,
} from "@/lib/reporting/active-creatives-group";
import { buildTimeParams } from "@/lib/insights/meta";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

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
  // PR #47: insights are no longer requested as a nested subfield
  // on /ads — Meta's compute budget for nested-insights collapses
  // on wider timeframes. Insights now come from a parallel
  // /{campaignId}/insights call (see fetchAdInsightsForCampaign).
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
  /**
   * Date window for the per-ad insights call.
   *
   *   - `undefined` → no `date_preset` / `time_range` param sent;
   *     Meta's /insights default (last_30d) applies. Matches the
   *     internal panel's pre-existing behaviour, which is why this
   *     stays optional rather than required.
   *   - `"custom"` → `customRange` MUST also be provided; we
   *     forward it as `time_range({since, until})`.
   *   - any other preset → forwarded as `date_preset=<preset>`.
   *
   * The share page is the (currently sole) caller that passes a
   * non-default value, so creative metrics honour the `?tf=`
   * selector instead of silently showing last_30d for every
   * timeframe.
   *
   * Plumbed into a dedicated /{campaignId}/insights?level=ad call
   * (PR #47) rather than the original nested `insights{...}`
   * subfield on /ads — Meta's compute budget on nested insights is
   * tighter than the dedicated endpoint's, and only the dedicated
   * endpoint has the day-chunked fallback hooked up.
   */
  datePreset?: DatePreset;
  /** Required when `datePreset === "custom"`. */
  customRange?: CustomDateRange;
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
 *   1. object_story_spec.video_data.video_id → "video:${id}"
 *   2. object_story_spec.link_data.image_hash → "image:${hash}"
 *   3. asset_feed_spec.images[].hash (sorted)  → "assetset:${hashes}"
 *   4. asset_feed_spec.videos[].video_id (sorted) → "videoset:${ids}"
 *   5. top-level creative.video_id              → "video:${id}"
 *
 * Pure / structural — exported for unit tests and re-use from any
 * fetch path that produces the same RawCreative shape (e.g. a
 * future share-side fetch that also wants the signature).
 *
 * Returns `null` when nothing usable is present (placeholder
 * creatives, mis-tagged ads, or an Advantage+ shell where the
 * asset_feed_spec is empty across both images and videos — in
 * that case the waterfall falls through to thumbnail / name).
 *
 * PR #49: tier 4 (`asset_feed_spec.videos[]`) added because
 * Advantage+ video creatives carry their video ids inside the
 * asset-feed spec rather than top-level `video_id` /
 * `object_story_spec.video_data`. Without this tier, sibling
 * Advantage+ video re-uploads fell through to the weaker
 * creative_id fallback and rendered as duplicate cards.
 */
export function deriveAssetSignature(
  creative: RawCreative | undefined,
): string | null {
  if (!creative) return null;
  const oss = creative.object_story_spec;
  // 1. object_story_spec.video_data — single-asset video creatives.
  const ossVideoId = oss?.video_data?.video_id?.trim();
  if (ossVideoId) return `video:${ossVideoId}`;

  // 2. object_story_spec.link_data.image_hash — single-image link ads.
  const imageHash = oss?.link_data?.image_hash?.trim();
  if (imageHash) return `image:${imageHash}`;

  // 3. Advantage+ image asset-set. Sort so two Meta payloads listing
  // the same set in different orders collapse to one signature.
  const afsImageHashes = creative.asset_feed_spec?.images
    ?.map((i) => i.hash?.trim())
    .filter((h): h is string => !!h && h.length > 0)
    .sort();
  if (afsImageHashes && afsImageHashes.length > 0) {
    return `assetset:${afsImageHashes.join("|")}`;
  }

  // 4. Advantage+ video asset-set (PR #49). Same shape as the image
  // tier — sorted ids so order-independent. Distinct prefix so the
  // grouper can tell videosets apart from imagesets.
  const afsVideoIds = creative.asset_feed_spec?.videos
    ?.map((v) => v.video_id?.trim())
    .filter((id): id is string => !!id && id.length > 0)
    .sort();
  if (afsVideoIds && afsVideoIds.length > 0) {
    return `videoset:${afsVideoIds.join("|")}`;
  }

  // 5. Top-level creative.video_id — last-resort for video creatives
  // that didn't surface a video_data block. Kept lower than
  // asset_feed_spec.videos so an Advantage+ shell with both
  // populated picks the deduplicated set rather than a single
  // representative id.
  const topVideoId = creative.video_id?.trim();
  if (topVideoId) return `video:${topVideoId}`;

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
  //
  // PR #47: insights are no longer nested here — they're fetched
  // in parallel by `fetchAdInsightsForCampaign` against the
  // dedicated /insights endpoint and stitched in by the caller.
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
        // Filled in by the caller after fetchAdInsightsForCampaign
        // returns. Left null here so partial-failure (insights
        // lookup throws while /ads succeeds) renders cards with "—"
        // metrics rather than blanking the campaign.
        insights: null,
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

// ─── Per-ad insights fetch (PR #47) ─────────────────────────────────────────
//
// Why this lives here rather than in lib/insights/meta.ts:
//   meta.ts's fetchInsightsChunked aggregates per-day rows into ONE
//   summed row — that shape is wrong for per-ad grain where we need
//   N rows back, not one sum. Rather than contort that helper, we
//   reimplement the cap detection locally: on isReduceDataError, fan
//   out per-day and merge per-(ad_id × day) into per-ad sums.
//
// Why a separate /insights call instead of nesting on /ads:
//   Meta's compute budget for the nested `insights{...}` subfield on
//   /{campaignId}/ads is much tighter than for the dedicated
//   /{campaignId}/insights endpoint. On wider timeframes (last_7d+)
//   for heavy events the nested path returns "Please reduce the
//   amount of data" and the chunked fallback in meta.ts never sees
//   it (it only wraps fetchCampaignInsights + fetchAdInsights). The
//   share page rendered upstream-error and the snapshot cache had
//   zero successful writes. PR #47 splits the calls so the cap
//   detection + day-chunked fallback works for the per-ad path too.

interface RawAdInsightRow {
  ad_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  frequency?: string;
  inline_link_clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
  action_values?: Array<{ action_type?: string; value?: string }>;
}

const AD_INSIGHT_FIELDS = [
  "ad_id",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "frequency",
  "inline_link_clicks",
  "actions",
  "action_values",
].join(",");

const AD_INSIGHT_DAY_CHUNK_LIMIT = 31;
const AD_INSIGHT_CHUNK_CONCURRENCY = 3;

/**
 * Fetch per-ad insights for one campaign from the dedicated
 * /{campaignId}/insights?level=ad endpoint. Returns a Map keyed by
 * ad_id so the caller can stitch values back onto the AdInput rows
 * produced by `fetchActiveAdsForCampaign`.
 *
 * On `isReduceDataError` (Meta's compute-budget cap), falls back to
 * a per-day fan-out merged per ad_id. On any other error, throws —
 * caller catches at the campaign boundary so one bad campaign
 * doesn't blank the whole event.
 */
async function fetchAdInsightsForCampaign(
  campaignId: string,
  token: string,
  datePreset: DatePreset | undefined,
  customRange: CustomDateRange | undefined,
): Promise<Map<string, RawAdInsightRow>> {
  // buildTimeParams requires a concrete DatePreset; when the caller
  // (the internal panel route, which doesn't pipe a tf selector)
  // passes nothing, omit the time params and let Meta fall back to
  // its /insights default of last_30d. Same behaviour as the old
  // nested-insights path so this path is a strict improvement, not
  // a behavioural change.
  const timeParams = datePreset
    ? buildTimeParams(datePreset, customRange)
    : {};
  const params: Record<string, string> = {
    fields: AD_INSIGHT_FIELDS,
    level: "ad",
    limit: "200",
    ...timeParams,
  };
  try {
    return await pageAdInsights(`/${campaignId}/insights`, params, token);
  } catch (err) {
    if (isReduceDataError(err)) {
      console.warn(
        `[active-creatives] reduce-data fallback firing for campaign=${campaignId} preset=${datePreset ?? "default"}`,
      );
      return fetchAdInsightsChunked(
        campaignId,
        token,
        datePreset,
        customRange,
      );
    }
    throw err;
  }
}

/**
 * Page through /{campaignId}/insights?level=ad and collect into a
 * Map<ad_id, RawAdInsightRow>. Capped at ADS_PAGE_SAFETY pages —
 * the same safety belt used on /ads pagination — so a runaway
 * `paging.next` from Meta can't keep us iterating forever.
 */
async function pageAdInsights(
  path: string,
  baseParams: Record<string, string>,
  token: string,
): Promise<Map<string, RawAdInsightRow>> {
  const out = new Map<string, RawAdInsightRow>();
  const params = { ...baseParams };
  let after: string | undefined;
  let pages = 0;
  do {
    if (after) params.after = after;
    const res = await graphGetWithToken<PagedResponse<RawAdInsightRow>>(
      path,
      params,
      token,
    );
    for (const row of res.data ?? []) {
      if (row.ad_id) out.set(row.ad_id, row);
    }
    after = res.paging?.cursors?.after;
    pages += 1;
    if (!res.paging?.next) break;
  } while (after && pages < ADS_PAGE_SAFETY);
  return out;
}

/**
 * Day-chunked fallback for the per-ad insights path. Issues
 * one /insights?level=ad call per day in the resolved window,
 * then merges per-(ad_id × day) rows into per-ad sums.
 *
 * Bounded to AD_INSIGHT_DAY_CHUNK_LIMIT (31) by the preset
 * resolver — a future preset that blows past would throw rather
 * than open a 90-call storm. `maximum` resolves to null (can't
 * chunk lifetime) → empty map → cards render "—" rather than
 * blanking the campaign.
 */
async function fetchAdInsightsChunked(
  campaignId: string,
  token: string,
  datePreset: DatePreset | undefined,
  customRange: CustomDateRange | undefined,
): Promise<Map<string, RawAdInsightRow>> {
  // Without a concrete preset there's nothing to chunk — Meta's
  // own default window is what triggered the cap. Degrade
  // gracefully (empty map → "—" cards) rather than guessing a
  // window for the user.
  if (!datePreset) return new Map();
  const days = resolvePresetToDays(datePreset, customRange);
  if (!days || days.length === 0) return new Map();
  if (days.length > AD_INSIGHT_DAY_CHUNK_LIMIT) {
    throw new MetaApiError(
      `Ad-insights day-chunked fallback exceeded ${AD_INSIGHT_DAY_CHUNK_LIMIT} days (got ${days.length}); narrow the timeframe.`,
    );
  }
  const semaphore = createSemaphore(AD_INSIGHT_CHUNK_CONCURRENCY);
  const perDay = await Promise.all(
    days.map((day) =>
      semaphore(async () => {
        const params: Record<string, string> = {
          fields: AD_INSIGHT_FIELDS,
          level: "ad",
          limit: "200",
          time_range: JSON.stringify({ since: day, until: day }),
        };
        return pageAdInsights(`/${campaignId}/insights`, params, token);
      }),
    ),
  );
  return mergeAdInsightMaps(perDay);
}

/** Sum per-(ad_id × day) rows into a single per-ad map. */
function mergeAdInsightMaps(
  maps: ReadonlyArray<Map<string, RawAdInsightRow>>,
): Map<string, RawAdInsightRow> {
  const merged = new Map<string, RawAdInsightRow>();
  for (const m of maps) {
    for (const [adId, row] of m) {
      const acc = merged.get(adId);
      if (!acc) {
        merged.set(adId, { ...row });
        continue;
      }
      acc.spend = String(num(acc.spend) + num(row.spend));
      acc.impressions = String(num(acc.impressions) + num(row.impressions));
      acc.reach = String(num(acc.reach) + num(row.reach));
      acc.clicks = String(num(acc.clicks) + num(row.clicks));
      acc.inline_link_clicks = String(
        num(acc.inline_link_clicks) + num(row.inline_link_clicks),
      );
      acc.actions = mergeActionRows(acc.actions, row.actions);
      acc.action_values = mergeActionRows(acc.action_values, row.action_values);
      // frequency is recomputed at read-time from impressions /
      // reach by the card renderer; don't bother summing the
      // per-day values — sum-of-frequencies isn't meaningful.
    }
  }
  return merged;
}

function mergeActionRows(
  a: Array<{ action_type?: string; value?: string }> | undefined,
  b: Array<{ action_type?: string; value?: string }> | undefined,
): Array<{ action_type?: string; value?: string }> {
  const out = new Map<string, number>();
  for (const row of [...(a ?? []), ...(b ?? [])]) {
    const k = row.action_type ?? "";
    out.set(k, (out.get(k) ?? 0) + num(row.value));
  }
  return Array.from(out, ([action_type, v]) => ({
    action_type,
    value: String(v),
  }));
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
          // Fan out /ads + /insights in parallel for the same
          // campaign. Insights failures are swallowed (logged + empty
          // map) so the cards still render with "—" metrics rather
          // than dropping the whole campaign — matches the partial-
          // render contract added in PR #42. Only the /ads call is
          // load-bearing for the auth-expired sentinel.
          const [ads, insightsMap] = await Promise.all([
            fetchActiveAdsForCampaign(c.id, c.name ?? null, token),
            fetchAdInsightsForCampaign(
              c.id,
              token,
              input.datePreset,
              input.customRange,
            ).catch((err) => {
              if (isMetaAuthError(err)) authExpired = true;
              console.warn(
                `[active-creatives] insights for campaign ${c.id} (${c.name ?? "?"}) failed:`,
                err instanceof Error ? err.message : String(err),
              );
              return new Map<string, RawAdInsightRow>();
            }),
          ]);

          // Stitch insights onto the ad rows. Ads with no matching
          // insight row keep `insights: null` (set by
          // fetchActiveAdsForCampaign) and the grouper treats them
          // as zero-contribution.
          for (const ad of ads) {
            const row = insightsMap.get(ad.ad_id);
            if (!row) continue;
            ad.insights = {
              spend: num(row.spend),
              impressions: num(row.impressions),
              clicks: num(row.clicks),
              reach: num(row.reach),
              frequency: num(row.frequency),
              actions: (row.actions ?? []).map((a) => ({
                action_type: a.action_type ?? "",
                value: num(a.value),
              })),
              inline_link_clicks: num(row.inline_link_clicks),
              action_values: (row.action_values ?? []).map((a) => ({
                action_type: a.action_type ?? "",
                value: num(a.value),
              })),
            };
          }
          return ads;
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
