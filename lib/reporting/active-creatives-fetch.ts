import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import {
  pickBestVideoThumbnail,
  type VideoThumbnail,
} from "@/lib/meta/video-thumbnails";
import {
  isReduceDataError,
  isTransientRateLimit,
} from "@/lib/meta/error-classify";
import { retryOnceOnTransient } from "@/lib/meta/retry";
import { normaliseAdAccountId } from "@/lib/reporting/event-insights";
import {
  groupAdsByCreative,
  type AdInput,
  type CreativePreview,
  type CreativeRow,
} from "@/lib/reporting/active-creatives-group";
import { dedupAdsByAdId } from "@/lib/reporting/active-creatives-dedup";
import { buildTimeParams } from "@/lib/insights/meta";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import {
  extractPreview,
  type RawCreative,
} from "@/lib/reporting/creative-preview-extract";
import type { ActiveCreativeThumbnailSource } from "@/lib/reporting/active-creatives-group";

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
// Per-campaign /insights pagination guard. The /ads side now uses
// EVENT_ADS_PAGE_LIMIT / EVENT_ADS_PAGE_SAFETY against the
// account-level endpoint — see fetchActiveAdsForEventAccountOnce.
const ADS_PAGE_SAFETY = 6;
// Account-level /ads pagination. limit=500 keeps the per-page
// payload comfortably under Meta's response budget for the slim
// scalar+creative.id field set; safety=12 covers worst-case 6000
// distinct ads per event (PER_EVENT_CAMPAIGN_CAP × ~120 active
// ads/campaign), well above anything we've seen in production.
const EVENT_ADS_PAGE_LIMIT = 500;
const EVENT_ADS_PAGE_SAFETY = 12;
// Per-campaign /insights fan-out concurrency. The /ads side is now
// a single account-level call, so this only governs the insights
// step.
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
  /**
   * When true, batch-calls `/{video_id}/thumbnails` for Advantage+
   * `afs_video_thumb` low-res fallbacks and upgrades poster URLs.
   * Only for cron / internal snapshot refresh — the share RSC path
   * must leave this false (default) to avoid extra Graph round-trips.
   */
  enrichVideoThumbnails?: boolean;
}

export interface FetchActiveCreativesMeta {
  campaigns_total: number;
  campaigns_failed: number;
  ads_fetched: number;
  dropped_no_creative: number;
  truncated: boolean;
  /** Set when every campaign failed because the FB token is dead. */
  auth_expired: boolean;
  /**
   * Combined count of duplicate rows dropped during the cross-
   * campaign dedup pass. Two sources contribute (PR #50, then
   * extended after the account-level /ads switch):
   *   - /ads side: defensive belt-and-braces for paginated overlap.
   *     Expected 0 now that /ads runs as a single account-level
   *     call; was the dominant source under the old per-campaign
   *     fan-out.
   *   - /insights side: real, observed when sibling campaigns
   *     under the same `event_code` substring share an ad (Meta
   *     returns its insight row once per campaign).
   * First-seen wins per ad_id; subsequent rows are counted here
   * and discarded before stitching. Surfaced for debug/log, not
   * the UI.
   */
  cross_campaign_duplicates: number;
  /**
   * Backstop bucket for insight rows that had no matching AdInput
   * after the widen + stitch — almost always ads that were
   * ARCHIVED or DELETED inside the reporting window (Meta strips
   * them from /ads but still returns their historical spend on
   * /insights?level=ad). Sum is per-event, dedup safe (orphan rows
   * are unique by ad_id by construction). The share + internal
   * panels surface this as an "Other / unattributed" footer line
   * so total creative spend reconciles to total campaign spend
   * even when archived ads carry historical cost.
   */
  unattributed: UnattributedBucket;
}

/**
 * Spend / volume from per-ad insight rows that didn't match any
 * AdInput after the cross-campaign stitch. Always present in the
 * envelope so callers don't need a null check; `ads_count === 0`
 * means everything was attributed.
 */
export interface UnattributedBucket {
  ads_count: number;
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  landingPageViews: number;
  registrations: number;
  purchases: number;
}

export interface FetchActiveCreativesResult {
  creatives: CreativeRow[];
  ad_account_id: string;
  meta: FetchActiveCreativesMeta;
}

/**
 * All-zero `UnattributedBucket`. Returned both on the
 * "no-campaigns-matched" early bail and as the reduce-seed when
 * there are no orphan rows to roll up — keeps the envelope shape
 * uniform so consumers never have to special-case `null`.
 */
function emptyUnattributedBucket(): UnattributedBucket {
  return {
    ads_count: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    inline_link_clicks: 0,
    landingPageViews: 0,
    registrations: 0,
    purchases: 0,
  };
}

function num(v: string | number | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Action-type priorities for the orphan rollup. Mirror the priority
// lists in active-creatives-group.ts so the unattributed totals use
// the same de-dup contract as the per-card totals — picks the first
// matching variant per insight row, never sums across overlapping
// Meta variants. Kept inline rather than imported from the grouper
// to keep this module's import surface tight (the grouper itself
// only handles AdInput rows; orphans never get that far).
const ORPHAN_LPV_PRIORITY = [
  "omni_landing_page_view",
  "offsite_conversion.fb_pixel_landing_page_view",
  "landing_page_view",
] as const;

const ORPHAN_REG_PRIORITY = [
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_lead",
  "complete_registration",
  "lead",
  "registration",
] as const;

const ORPHAN_PURCHASE_PRIORITY = [
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
] as const;

function sumPriorityAction(
  actions: Array<{ action_type?: string; value?: string }> | undefined,
  priority: readonly string[],
): number {
  if (!actions || actions.length === 0) return 0;
  for (const type of priority) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return num(hit.value);
  }
  return 0;
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

function extractThumbnailSource(
  creative: RawCreative | undefined,
): ActiveCreativeThumbnailSource {
  const oss = creative?.object_story_spec;
  return {
    video_id:
      oss?.video_data?.video_id?.trim() ||
      creative?.video_id?.trim() ||
      creative?.asset_feed_spec?.videos?.[0]?.video_id?.trim() ||
      null,
    image_hash:
      creative?.image_hash?.trim() ||
      oss?.link_data?.image_hash?.trim() ||
      creative?.asset_feed_spec?.images?.[0]?.hash?.trim() ||
      null,
  };
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
 * All-null `CreativePreview` factory. Used as the placeholder on
 * AdInput rows between phase 1 (the slim `/ads` enumerate) and
 * phase 2 (`fetchCreativeBatch` stitch). Kept as a function rather
 * than a frozen literal so the row mutator can overwrite the
 * fields in place without alias surprises across ads.
 */
function emptyPreview(): CreativePreview {
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

async function listLinkedCampaignIds(
  adAccountId: string,
  eventCode: string,
  token: string,
): Promise<RawCampaignRow[]> {
  // ARCHIVED is intentionally included alongside ACTIVE/PAUSED/CAMPAIGN_PAUSED.
  // Active-creatives reporting is retrospective — if a campaign was paused or
  // archived mid-flight (e.g. after an on-sale window closed), its ad creative
  // history is still valid and should appear in the snapshot. Excluding ARCHIVED
  // is the root cause of events like WC26-BRISTOL/EDINBURGH/LEEDS producing zero
  // snapshots when their pre-launch campaigns were archived and recreated.
  const params: Record<string, string> = {
    fields: "id,name,effective_status",
    limit: String(PER_EVENT_CAMPAIGN_CAP),
    effective_status: JSON.stringify([
      "ACTIVE",
      "PAUSED",
      "CAMPAIGN_PAUSED",
      "ARCHIVED",
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
 * Single-retry shim around `fetchActiveAdsForEventAccountOnce`.
 *
 * On a transient rate-limit / service-unavailable error (per
 * `isTransientRateLimit`), waits {@link ADS_OUTER_RETRY_DELAY_MS}
 * and tries once more. Any other error class (auth, validation,
 * `meta_code=1 reduce-data`, etc.) re-throws immediately so the
 * caller can record the failure and surface a partial render.
 *
 * Why the inner client's 5× backoff isn't enough:
 *   `graphGetWithToken` already retries the same code set with
 *   exponential backoff per call, but a saturated per-account
 *   quota can eat all 5 inner attempts on a single page. One
 *   additional attempt at the helper boundary, after a brief
 *   pause, is enough to ride out the moment.
 */
async function fetchActiveAdsForEventAccount(
  adAccountId: string,
  campaignIds: readonly string[],
  token: string,
): Promise<AdInput[]> {
  return retryOnceOnTransient(
    () => fetchActiveAdsForEventAccountOnce(adAccountId, campaignIds, token),
    isTransientRateLimit,
    ADS_OUTER_RETRY_DELAY_MS,
    (err, delay) => {
      const code = (err as { code?: number }).code;
      console.warn(
        `[active-creatives] /ads transient meta_code=${code} on event-account=${adAccountId} (${campaignIds.length} campaigns) — single outer retry in ${delay}ms`,
      );
    },
  );
}

/**
 * One account-level `/{adAccountId}/ads` call per event, replacing
 * the prior per-campaign fan-out.
 *
 * Why this shape (PR #67 follow-up):
 *   PR #67 slimmed the field list to scalars + `creative{id}` to
 *   dodge Meta's per-response size budget, but the three Junction 2
 *   campaigns still threw `meta_code=1 reduce-data` because Meta's
 *   `/{campaignId}/ads` endpoint scans EVERY ad in the campaign
 *   (including ARCHIVED) before applying our `effective_status`
 *   filter. It's the SCAN budget that overflows on those campaigns,
 *   not the response. Slimming fields was wasted budget once the
 *   scan cap engaged.
 *
 *   Switching to `/{adAccountId}/ads` with `filtering=[{campaign.id
 *   IN [...]}, {effective_status IN [...]}]` moves the scan to the
 *   account-indexed view, which Meta serves out of a different
 *   index that doesn't trip the per-campaign cap. Same response
 *   shape, same per-row mapping into AdInput. Net request count
 *   drops from N (campaigns) to 1 + pagination — usually 1-3 pages
 *   total even on wide events at limit=500.
 *
 *   Insights stay per-campaign (`fetchAdInsightsForCampaign`) —
 *   the dedicated `/insights` endpoint has its own day-chunked
 *   fallback and isn't subject to the same scan cap.
 *
 * Status filter mirrors the per-campaign helper it replaces:
 *   [ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED, WITH_ISSUES].
 *   Excludes ARCHIVED / DELETED / IN_PROCESS / PENDING_REVIEW /
 *   DISAPPROVED. The CAMPAIGN_PAUSED / ADSET_PAUSED / WITH_ISSUES
 *   inclusions are deliberate (Leeds-event spend reconciliation —
 *   long rationale on the prior version of this helper, now
 *   distilled here for the same reason).
 */
async function fetchActiveAdsForEventAccountOnce(
  adAccountId: string,
  campaignIds: readonly string[],
  token: string,
): Promise<AdInput[]> {
  if (campaignIds.length === 0) return [];
  const fields = [
    "id",
    "name",
    "status",
    "effective_status",
    "campaign{id,name}",
    "adset{id,name}",
    "creative{id}",
  ].join(",");
  const filtering = JSON.stringify([
    { field: "campaign.id", operator: "IN", value: [...campaignIds] },
    {
      field: "effective_status",
      operator: "IN",
      value: ["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "WITH_ISSUES"],
    },
  ]);
  const params: Record<string, string> = {
    fields,
    limit: String(EVENT_ADS_PAGE_LIMIT),
    filtering,
  };

  const out: AdInput[] = [];
  let after: string | undefined;
  let pages = 0;
  do {
    if (after) params.after = after;
    const res = await graphGetWithToken<PagedResponse<RawAdRow>>(
      `/${adAccountId}/ads`,
      params,
      token,
    );
    for (const ad of res.data ?? []) {
      // Two-phase fetch (PR #59): we only have the creative.id
      // pointer here. headline / body / thumbnail / preview /
      // asset signature / object_story_id are populated by the
      // post-dedup stitch loop in `fetchActiveCreativesForEvent`
      // after `fetchCreativeBatch` resolves the full payloads.
      // Empty defaults match the partial-render contract: an ad
      // whose creative batch fetch ultimately fails still appears
      // in the grouper, just keyed by `creative_id` rather than
      // its asset signature.
      out.push({
        ad_id: ad.id,
        ad_name: ad.name ?? null,
        status: ad.effective_status ?? ad.status ?? null,
        // Account-level /ads always returns the canonical
        // campaign{id,name} per ad (no per-campaign-endpoint
        // fallback needed). campaign_id/adset_id legacy non-nested
        // fields are kept as a defensive fallback in case Meta
        // reverts to the older shape for any row.
        campaign_id: ad.campaign?.id ?? ad.campaign_id ?? null,
        campaign_name: ad.campaign?.name ?? null,
        adset_id: ad.adset?.id ?? ad.adset_id ?? null,
        adset_name: ad.adset?.name ?? null,
        creative_id: ad.creative?.id ?? null,
        creative_name: null,
        headline: null,
        body: null,
        thumbnail_url: null,
        effective_object_story_id: null,
        object_story_id: null,
        primary_asset_signature: null,
        preview: emptyPreview(),
        // Filled in by the orchestrator after the per-campaign
        // insights fan-out resolves. Left null here so partial-
        // failure (insights throws while /ads succeeds) renders
        // cards with "—" metrics rather than blanking the event.
        insights: null,
      });
    }
    after = res.paging?.cursors?.after;
    pages += 1;
    if (!res.paging?.next) break;
  } while (after && pages < EVENT_ADS_PAGE_SAFETY);
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
/**
 * Concurrency for the day-chunked /insights?level=ad fallback. Stays
 * at 1 (sequential) because the chunked path only ever fires AFTER
 * Meta has already said "you're asking for too much" via
 * `isReduceDataError` — at that point fanning out per-day at 3-wide
 * deepens the rate-limit hole rather than digging out of it. The
 * cascade observed on Junction 2 (14d/30d losing ~51 ads vs 7d) was
 * caused by this fan-out throttling sibling campaigns' /ads calls
 * via the shared per-account quota; sequential keeps the total
 * request count identical but spreads it over time so neighbouring
 * fetches can land their pages.
 *
 * Cost: 14d chunked path goes from ~5s → ~14s, 30d from ~10s → ~30s.
 * Acceptable because the whole creatives section is behind the
 * Suspense skeleton — the share page paints headline numbers
 * immediately and only the creative grid waits.
 */
const AD_INSIGHT_CHUNK_CONCURRENCY = 1;
/**
 * Outer single-retry budget around `fetchActiveAdsForCampaign`. The
 * inner `graphGetWithToken` already retries 5× with exponential
 * backoff per call, but a sustained rate-limit cascade from sibling
 * campaigns' chunked /insights fan-outs can outlast that budget on
 * a single /ads page. One additional attempt at the campaign-fetch
 * boundary, after a brief pause, is enough to ride out the moment.
 */
const ADS_OUTER_RETRY_DELAY_MS = 500;

/**
 * Max creative IDs per batched-read request to Meta's
 * `GET /?ids=…&fields=…` endpoint. 50 is the documented per-call
 * cap; production response time at 50 sits around ~500ms which
 * keeps the parallel fan-out below comfortably below the per-account
 * rate ceiling for typical events (≤500 creatives = 10 calls).
 */
// Meta's documented cap is 50, but on heavy events (e.g. 372 distinct
// creatives with Advantage+ asset_feed_spec trees) the 50-id payload
// trips Meta's "reduce the amount of data you're asking for"
// (meta_code=1) cap on ~60% of batches, silently dropping those
// creatives from hydration. Halving to 25 keeps each batch under the
// cap on observed worst-case events. Concurrency is still gated by
// AD_INSIGHT_CHUNK_CONCURRENCY=1 so the extra request count doesn't
// risk rate-limit 429s.
const CREATIVE_BATCH_SIZE = 25;

/**
 * Field list pulled per creative in phase 2. Mirrors the bulky
 * subtree the old single-phase /ads call requested inline — same
 * fields, just reachable through the batched endpoint, which
 * Meta does NOT subject to the same per-page expansion budget
 * that triggers `meta_code=1 reduce the amount of data` on /ads.
 *
 * `object_story_spec` and `asset_feed_spec` are requested as flat
 * field names; Meta returns the full sub-tree for each (this is
 * the same shape the old nested-field syntax produced, so
 * `extractCopy` / `extractPreview` / `deriveAssetSignature` keep
 * working without per-shape branching).
 */
const CREATIVE_BATCH_FIELDS = [
  "id",
  "name",
  "title",
  "body",
  "thumbnail_url",
  "image_url",
  "video_id",
  "object_story_id",
  "effective_object_story_id",
  "instagram_permalink_url",
  "call_to_action_type",
  "link_url",
  "object_story_spec",
  "asset_feed_spec",
  // PR #74 — earlier PR #71 also requested nested-expansion
  // forms for the two parents above (asset_feed_spec.videos /
  // .images and object_story_spec.link_data.child_attachments)
  // on the assumption Meta would union them with the flat
  // parent. It does not: Meta's field parser rejects duplicate
  // top-level field names with "Syntax error" and fails the
  // whole batch, so PR #73's diagnostic logs caught
  // creative_batch_done hydrated=0 on every share render. The
  // flat form already returns the full sub-tree (see comment
  // block above), which is what extractPreview's waterfall
  // reads, so the nested forms were redundant from the start.
].join(",");

/**
 * Phase-2 creative payload fetcher (PR #59 — fix/ads-payload-split).
 *
 * Takes the distinct creative IDs gathered across every campaign
 * after the cross-campaign dedup, chunks into batches of
 * {@link CREATIVE_BATCH_SIZE} (Meta's documented cap), fans them
 * out in parallel against the batched-IDs read endpoint, and
 * returns a `Map<creative_id, RawCreative>` for the caller to
 * stitch onto the AdInput rows.
 *
 * Failure posture: per-batch failures are swallowed and logged.
 * The caller's stitch loop already tolerates a missing creative
 * (the AdInput row keeps its phase-1 nulls and the grouper falls
 * back to the `creative_id` tier of the waterfall), so degrading
 * one batch is preferable to dropping the whole event. A bulk auth
 * failure still surfaces because the very first batch throws and
 * the calling site's outer try/catch records it.
 *
 * Why a fresh helper rather than wrapping `graphGetWithToken`
 * directly: the batched endpoint returns an OBJECT keyed by ID
 * (not a paged array), so the existing `PagedResponse<T>` shape
 * doesn't fit. Keeping the deserialisation local makes the type
 * explicit and avoids leaking `Record<string, RawCreative>` into
 * the rest of the module.
 */
async function fetchCreativeBatch(
  creativeIds: readonly string[],
  token: string,
): Promise<Map<string, RawCreative>> {
  const out = new Map<string, RawCreative>();
  if (creativeIds.length === 0) return out;
  // Defensive de-dup at the helper boundary so callers don't have
  // to (and so a downstream test harness can pass the raw list
  // straight in).
  const unique = [...new Set(creativeIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CREATIVE_BATCH_SIZE) {
    chunks.push(unique.slice(i, i + CREATIVE_BATCH_SIZE));
  }
  type BatchResponse = Record<string, RawCreative>;
  const results = await Promise.all(
    chunks.map((batch, idx) =>
      graphGetWithToken<BatchResponse>(
        "",
        { ids: batch.join(","), fields: CREATIVE_BATCH_FIELDS },
        token,
      ).catch((err) => {
        const e = err as { code?: number; message?: string };
        console.warn(
          `[active-creatives] creative_batch_failed batch=${idx + 1}/${chunks.length} ids=${batch.length} meta_code=${e.code ?? "n/a"} message=${JSON.stringify(e.message ?? String(err))}`,
        );
        return {} as BatchResponse;
      }),
    ),
  );
  for (const batchResult of results) {
    for (const [id, creative] of Object.entries(batchResult)) {
      if (id && creative) out.set(id, creative);
    }
  }
  return out;
}

const VIDEO_THUMBNAIL_BATCH_FIELDS = [
  "thumbnails{uri,height,width,scale,is_preferred}",
].join(",");

type GraphVideoThumbnailsNode = {
  thumbnails?: { data?: ReadonlyArray<Record<string, unknown>> };
  error?: { message?: string };
};

/**
 * Given a list of `video_id`s, fetch their native-resolution thumbnails
 * via Meta's Graph API batched endpoint (`GET /?ids=…&fields=thumbnails`).
 * Returns a Map keyed by `video_id` with the best-quality
 * {@link VideoThumbnail} for each. Missing / errored `video_id`s are
 * omitted (caller falls back to the `extractPreview` waterfall).
 *
 * Respects {@link CREATIVE_BATCH_SIZE} (25) to stay under Meta's
 * data-budget cap. Swallows per-batch errors — a failed batch does not
 * poison the whole enrichment pass.
 */
async function fetchVideoThumbnailsBatch(
  videoIds: string[],
  token: string,
): Promise<Map<string, VideoThumbnail>> {
  const out = new Map<string, VideoThumbnail>();
  if (videoIds.length === 0) return out;
  const unique = [...new Set(videoIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += CREATIVE_BATCH_SIZE) {
    chunks.push(unique.slice(i, i + CREATIVE_BATCH_SIZE));
  }
  const results = await Promise.all(
    chunks.map((batch, idx) =>
      graphGetWithToken<Record<string, GraphVideoThumbnailsNode | undefined>>(
        "",
        { ids: batch.join(","), fields: VIDEO_THUMBNAIL_BATCH_FIELDS },
        token,
      ).catch((err) => {
        const e = err as { code?: number; message?: string };
        console.warn(
          `[active-creatives] video_thumbnails_batch_failed batch=${idx + 1}/${chunks.length} ids=${batch.length} meta_code=${e.code ?? "n/a"} message=${JSON.stringify(e.message ?? String(err))}`,
        );
        return {} as Record<string, GraphVideoThumbnailsNode>;
      }),
    ),
  );
  for (const batchResult of results) {
    for (const [id, node] of Object.entries(batchResult)) {
      if (!id || !node || (node as GraphVideoThumbnailsNode).error) {
        continue;
      }
      const n = (node as GraphVideoThumbnailsNode).thumbnails;
      const data = n?.data;
      if (!data?.length) continue;
      const best = pickBestVideoThumbnail(data);
      if (best) {
        out.set(id, best);
      }
    }
  }
  return out;
}

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
  const enrichVideoThumbnails = input.enrichVideoThumbnails === true;
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
        cross_campaign_duplicates: 0,
        unattributed: emptyUnattributedBucket(),
      },
    };
  }

  const semaphore = createSemaphore(concurrency);
  let authExpired = false;
  const failed: Array<{ campaign_id: string; error: string }> = [];
  const customRangeStr = input.customRange
    ? `${input.customRange.since}..${input.customRange.until}`
    : null;

  // PHASE A — one account-level /ads call for the whole event.
  // Replaces the prior per-campaign fan-out that tripped Meta's
  // per-campaign scan-budget cap on Junction 2 (PR #67 follow-up).
  // Auth failure here is fatal: we have no ads to render against.
  // Any other Meta error (`reduce-data`, validation, transient that
  // outlasted the retry) is logged + treated as "no ads this event"
  // so the rest of the report (headline stats, campaign breakdown)
  // still paints.
  let rawAds: AdInput[] = [];
  try {
    rawAds = await fetchActiveAdsForEventAccount(
      adAccountId,
      campaigns.map((c) => c.id),
      token,
    );
    console.info(
      `[active-creatives] event_ads_fetch_ok event=${eventCode} ad_account=${adAccountId} campaigns=${campaigns.length} ads=${rawAds.length}`,
    );
  } catch (err) {
    if (isMetaAuthError(err)) {
      throw new FacebookAuthExpiredError();
    }
    const msg =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    const e = err as {
      code?: number;
      error_subcode?: number;
      type?: string;
    };
    console.error(
      `[active-creatives] event_ads_fetch_failed event=${eventCode} ad_account=${adAccountId} campaigns=${campaigns.length} date_preset=${input.datePreset ?? "default"} custom_range=${customRangeStr} meta_code=${e.code ?? "n/a"} meta_subcode=${e.error_subcode ?? "n/a"} meta_type=${e.type ?? "n/a"} message=${JSON.stringify(msg)}`,
    );
    // Record one synthetic failure-per-campaign so the meta surface
    // continues to expose the same `campaigns_failed` shape callers
    // already key off (notably `cacheable` in the share route — a
    // total /ads outage shouldn't poison the snapshot cache).
    for (const c of campaigns) {
      failed.push({ campaign_id: c.id, error: msg });
    }
  }

  // PHASE B — per-campaign /insights fan-out. Stays per-campaign
  // because the /insights endpoint isn't subject to the same scan
  // cap and already has a day-chunked fallback for the
  // `reduce-data` case (see fetchAdInsightsChunked). Insights
  // failures are swallowed (logged + empty map) per the partial-
  // render contract: cards still appear with "—" metrics rather
  // than dropping the whole campaign.
  type OrphanBucket = {
    ads_count: number;
    spend: number;
    impressions: number;
    clicks: number;
    inline_link_clicks: number;
    landingPageViews: number;
    registrations: number;
    purchases: number;
  };
  const insightsResults = await Promise.all(
    campaigns.map((c) =>
      semaphore(async () => {
        try {
          const map = await fetchAdInsightsForCampaign(
            c.id,
            token,
            input.datePreset,
            input.customRange,
          );
          console.info(
            `[active-creatives] insights_fetch_ok campaign_id=${c.id} campaign_name=${JSON.stringify(c.name ?? null)} date_preset=${input.datePreset ?? "default"} insights_rows=${map.size}`,
          );
          return { campaign: c, map };
        } catch (err) {
          if (isMetaAuthError(err)) authExpired = true;
          const msg =
            err instanceof MetaApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          const e = err as {
            code?: number;
            error_subcode?: number;
            type?: string;
          };
          console.warn(
            `[active-creatives] insights_fetch_failed campaign_id=${c.id} campaign_name=${JSON.stringify(c.name ?? null)} date_preset=${input.datePreset ?? "default"} custom_range=${customRangeStr} meta_code=${e.code ?? "n/a"} meta_subcode=${e.error_subcode ?? "n/a"} meta_type=${e.type ?? "n/a"} message=${JSON.stringify(msg)}`,
          );
          return {
            campaign: c,
            map: new Map<string, RawAdInsightRow>(),
          };
        }
      }),
    ),
  );

  // Merge per-campaign insights into one event-wide map keyed by
  // ad_id. First-seen wins on duplicate ad_ids — matches the
  // dedupAdsByAdId posture: Meta's per-campaign /insights can
  // surface the same ad under sibling campaigns when the event
  // code substring-matches multiple campaigns the ad is reachable
  // from. Counted as cross-campaign duplicates for the meta
  // surface.
  const insightsByAdId = new Map<string, RawAdInsightRow>();
  let insightsDuplicates = 0;
  for (const { map } of insightsResults) {
    for (const [adId, row] of map) {
      if (insightsByAdId.has(adId)) {
        insightsDuplicates += 1;
        continue;
      }
      insightsByAdId.set(adId, row);
    }
  }
  if (insightsDuplicates > 0) {
    console.log(
      `[active-creatives] cross-campaign insights dedup: dropped ${insightsDuplicates} duplicate insight rows across sibling campaigns (event=${eventCode})`,
    );
  }

  // Account-level /ads inherently returns each ad once per its own
  // campaign_id — no /ads-side dedup needed. The dedupAdsByAdId
  // pass is preserved as a defensive belt-and-braces in case Meta
  // ever returns an ad twice (e.g. paginated overlap), and so the
  // meta surface keeps reporting `cross_campaign_duplicates` with
  // the same shape downstream consumers expect.
  const { kept: dedupedAds, dropped: duplicatesDropped } =
    dedupAdsByAdId(rawAds);
  if (duplicatesDropped > 0) {
    console.log(
      `[active-creatives] /ads dedup: dropped ${duplicatesDropped}/${rawAds.length} duplicate ad rows (event=${eventCode})`,
    );
  }
  // Combined duplicate count for the meta surface — sums /ads-side
  // dups (defensive, expected 0 with account-level fetch) and
  // insights-side dups (real, observed when sibling campaigns
  // share ads).
  const crossCampaignDuplicates = duplicatesDropped + insightsDuplicates;

  // Stitch the merged insights map onto the deduped ad list and
  // accumulate orphans (insight rows whose ad_id never surfaced in
  // /ads — typically ARCHIVED / DELETED ads whose status filter
  // bites at the /ads side but whose spend still appears in the
  // window).
  const stitchedAdIds = new Set<string>();
  for (const ad of dedupedAds) {
    const row = insightsByAdId.get(ad.ad_id);
    if (!row) continue;
    stitchedAdIds.add(ad.ad_id);
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

  const eventOrphan: OrphanBucket = {
    ads_count: 0,
    spend: 0,
    impressions: 0,
    clicks: 0,
    inline_link_clicks: 0,
    landingPageViews: 0,
    registrations: 0,
    purchases: 0,
  };
  for (const [adId, row] of insightsByAdId) {
    if (stitchedAdIds.has(adId)) continue;
    eventOrphan.ads_count += 1;
    eventOrphan.spend += num(row.spend);
    eventOrphan.impressions += num(row.impressions);
    eventOrphan.clicks += num(row.clicks);
    eventOrphan.inline_link_clicks += num(row.inline_link_clicks);
    eventOrphan.landingPageViews += sumPriorityAction(
      row.actions,
      ORPHAN_LPV_PRIORITY,
    );
    eventOrphan.registrations += sumPriorityAction(
      row.actions,
      ORPHAN_REG_PRIORITY,
    );
    eventOrphan.purchases += sumPriorityAction(
      row.actions,
      ORPHAN_PURCHASE_PRIORITY,
    );
  }
  const orphanBuckets: OrphanBucket[] =
    eventOrphan.ads_count > 0 ? [eventOrphan] : [];

  if (authExpired && failed.length === campaigns.length) {
    // Every code path failed because the token is dead — surface
    // as auth-expired rather than letting the panel render an
    // empty grid that's indistinguishable from "no active ads".
    throw new FacebookAuthExpiredError();
  }

  // PR #59 — phase 2 of the two-phase fetch. Walk the deduped ad
  // rows, collect their distinct creative_ids, and resolve the
  // bulky payload (object_story_spec, asset_feed_spec, thumbnail,
  // etc.) in batches of 50 against the /?ids=…&fields=… endpoint.
  // Mutates each AdInput row in place to populate creative_name,
  // headline, body, thumbnail_url, the two object_story_id
  // variants, the asset signature, and the modal preview — same
  // fields that used to be filled inline from the /ads response
  // before the size-budget cap forced the split.
  //
  // Cross-campaign dedup runs FIRST so we never request the same
  // creative twice when an ad is reachable from multiple sibling
  // campaigns (the /ads side would have returned the row N times,
  // dedupAdsByAdId collapses it). Net request count is one batched
  // call per ≤50 distinct creatives across the whole event.
  const distinctCreativeIds = [
    ...new Set(
      dedupedAds
        .map((a) => a.creative_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const creativeMap =
    distinctCreativeIds.length > 0
      ? await fetchCreativeBatch(distinctCreativeIds, token)
      : new Map<string, RawCreative>();
  let creativesHydrated = 0;
  let creativesMissing = 0;
  let creativesNoThumbnail = 0;
  // Warn-once-per-creative-id so a single broken creative shape
  // doesn't spam Vercel logs across thousands of dup ad rows; cap
  // the warn lines to keep the diagnostic readable.
  const noThumbnailWarned = new Set<string>();
  const NO_THUMB_WARN_CAP = 5;
  // PR #73 — companion success-side log. Records which
  // extractPreview tier resolved each ad's thumbnail URL so the
  // "100% no_thumbnail=0 but UI shows ImageOff" pathology can
  // identify the unrenderable tier (likely
  // `video_id_graph_fallback` — the Graph endpoint requires an
  // access_token for public clients). Capped per Lambda
  // invocation; one log line per distinct creative_id.
  const previewTierLogged = new Set<string>();
  const PREVIEW_TIER_LOG_CAP = 50;
  // Diagnostic: ~40% of Innervisions cards render ImageOff because
  // Meta's /?ids= batched creative read silently drops some IDs
  // that phase-1 /ads successfully returned. Log the missing IDs
  // once each so we can identify whether the dropped set is
  // consistent (deleted creatives) or inconsistent (Meta shape /
  // permissions issue). Cap to avoid Lambda log flood.
  const missingCreativeLogged = new Set<string>();
  const MISSING_CREATIVE_LOG_CAP = 20;
  for (const ad of dedupedAds) {
    if (!ad.creative_id) continue;
    const creative = creativeMap.get(ad.creative_id);
    if (!creative) {
      creativesMissing += 1;
      if (
        !missingCreativeLogged.has(ad.creative_id) &&
        missingCreativeLogged.size < MISSING_CREATIVE_LOG_CAP
      ) {
        missingCreativeLogged.add(ad.creative_id);
        console.warn(
          `[active-creatives] creative_missing_in_batch creative_id=${ad.creative_id} ad_id=${ad.ad_id} ad_name=${JSON.stringify(ad.ad_name ?? null)} event=${eventCode}`,
        );
      }
      continue;
    }
    const { headline, body } = extractCopy(creative);
    const preview = extractPreview(creative);
    ad.creative_name = creative.name ?? null;
    ad.headline = headline;
    ad.body = body;
    // PR #72 — fall back through the extractPreview waterfall when
    // Meta's top-level thumbnail_url is null. Without this, the
    // hydrated URL stops at preview.image_url and never reaches
    // group-creatives's `representative_thumbnail` (which reads
    // ad.thumbnail_url directly), so Advantage+ Asset Feed and
    // carousel creatives keep rendering ImageOff in the share
    // report despite PR #71 successfully resolving a usable URL.
    // Top-level wins when present (cheapest path); preview is
    // already computed two lines above so this is zero extra cost.
    ad.thumbnail_url =
      creative.thumbnail_url?.trim() || preview.image_url || null;
    ad.thumbnail_source = extractThumbnailSource(creative);
    ad.effective_object_story_id =
      creative.effective_object_story_id?.trim() || null;
    ad.object_story_id = creative.object_story_id?.trim() || null;
    ad.primary_asset_signature = deriveAssetSignature(creative);
    ad.preview = preview;
    creativesHydrated += 1;
    // PR #73 — success-side diagnostic. Logged BEFORE the
    // hydration_no_thumbnail guard so it captures the rendered-
    // but-broken cards (the case PR #72 left behind).
    if (
      !previewTierLogged.has(ad.creative_id) &&
      previewTierLogged.size < PREVIEW_TIER_LOG_CAP
    ) {
      previewTierLogged.add(ad.creative_id);
      console.info(
        `[active-creatives] preview_resolved creative_id=${ad.creative_id} tier=${preview.tier} url_prefix=${JSON.stringify(
          (ad.thumbnail_url ?? "").slice(0, 80),
        )} has_video_id=${!!preview.video_id}`,
      );
    }
    // Hydration succeeded but neither the top-level thumbnail nor
    // the preview yielded a renderable image / video. Almost
    // always means the creative shape isn't probed by
    // extractPreview yet — log enough surface area to identify
    // which sub-shape we're failing to read. Counted into
    // `creative_batch_done` so cache-write reconciliation can spot
    // a regression even if logs are filtered.
    // ad.thumbnail_url and preview.image_url move in lockstep
    // after the PR #72 plumbing above (top-level || preview), so
    // checking both is redundant. We still gate on
    // `!preview.video_id` because extractPreview's video_id
    // fallback resolves a Graph CDN URL that sometimes 302s to a
    // generic placeholder — a creative shape that has ONLY
    // video_id and nothing else is still worth warning on.
    if (!ad.thumbnail_url && !preview.video_id) {
      creativesNoThumbnail += 1;
      if (
        !noThumbnailWarned.has(ad.creative_id) &&
        noThumbnailWarned.size < NO_THUMB_WARN_CAP
      ) {
        noThumbnailWarned.add(ad.creative_id);
        const childAttachments =
          creative.object_story_spec?.link_data?.child_attachments;
        const has_child_attachments =
          Array.isArray(childAttachments) && childAttachments.length > 0;
        const afs_images_len =
          creative.asset_feed_spec?.images?.length ?? 0;
        const afs_videos_len =
          creative.asset_feed_spec?.videos?.length ?? 0;
        console.warn(
          `[active-creatives] hydration_no_thumbnail creative_id=${ad.creative_id} creative_name=${JSON.stringify(creative.name ?? null)} has_oss=${!!creative.object_story_spec} has_afs=${!!creative.asset_feed_spec} has_child_attachments=${has_child_attachments} afs_images_len=${afs_images_len} afs_videos_len=${afs_videos_len} top_video_id=${creative.video_id ?? null} top_image_url=${creative.image_url ?? null}`,
        );
      }
    }
  }

  console.info(
    `[active-creatives] enrichment_gate event=${eventCode} flag=${enrichVideoThumbnails} deduped_ads=${dedupedAds.length}`,
  );
  if (enrichVideoThumbnails) {
    const videoIdsToUpgrade = new Set<string>();
    for (const ad of dedupedAds) {
      if (
        ad.preview?.is_low_res_fallback === true &&
        ad.preview.tier === "afs_video_thumb" &&
        ad.preview.video_id
      ) {
        videoIdsToUpgrade.add(ad.preview.video_id);
      }
    }
    // Per-gate breakdown: how many ads match each condition independently, plus the intersection
    const gateStats = {
      with_preview: 0,
      is_low_res: 0,
      tier_afs_video: 0,
      has_video_id: 0,
      all_conditions: videoIdsToUpgrade.size,
    };
    for (const ad of dedupedAds) {
      if (ad.preview) gateStats.with_preview += 1;
      if (ad.preview?.is_low_res_fallback === true) gateStats.is_low_res += 1;
      if (ad.preview?.tier === "afs_video_thumb") gateStats.tier_afs_video += 1;
      if (ad.preview?.video_id) gateStats.has_video_id += 1;
    }
    console.info(
      `[active-creatives] enrichment_gate_stats event=${eventCode} ${JSON.stringify(gateStats)}`,
    );
    if (videoIdsToUpgrade.size === 0) {
      console.info(
        `[active-creatives] enrichment_skip_empty event=${eventCode}`,
      );
    } else {
      console.log(
        `[active-creatives] video_thumbnail_enrichment start video_ids=${videoIdsToUpgrade.size} event=${eventCode}`,
      );
      try {
        const thumbnailsMap = await fetchVideoThumbnailsBatch(
          Array.from(videoIdsToUpgrade),
          token,
        );
        const sampleUpgrade = Array.from(thumbnailsMap.entries())[0];
        if (sampleUpgrade) {
          console.info(
            `[active-creatives] enrichment_sample event=${eventCode} video_id=${sampleUpgrade[0]} uri_prefix=${JSON.stringify(sampleUpgrade[1].uri.slice(0, 100))} dims=${sampleUpgrade[1].width}x${sampleUpgrade[1].height}`,
          );
        }
        console.log(
          `[active-creatives] video_thumbnail_enrichment done upgraded=${thumbnailsMap.size}/${videoIdsToUpgrade.size} event=${eventCode}`,
        );
        for (const ad of dedupedAds) {
          if (ad.preview.tier !== "afs_video_thumb") continue;
          if (!ad.preview.video_id) continue;
          const thumb = thumbnailsMap.get(ad.preview.video_id);
          if (!thumb) continue;
          ad.preview.image_url = thumb.uri;
          ad.preview.is_low_res_fallback = false;
          ad.thumbnail_url = thumb.uri;
        }
      } catch (err) {
        console.warn(
          `[active-creatives] video_thumbnail_enrichment failed event=${eventCode}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  console.info(
    `[active-creatives] creative_batch_done event=${eventCode} distinct_creatives=${distinctCreativeIds.length} hydrated=${creativesHydrated} missing=${creativesMissing} no_thumbnail=${creativesNoThumbnail}`,
  );

  const droppedNoCreative = dedupedAds.filter((a) => !a.creative_id).length;
  let creatives = groupAdsByCreative(dedupedAds);
  let truncated = false;
  if (creatives.length > PER_EVENT_CREATIVE_CAP) {
    creatives = creatives.slice(0, PER_EVENT_CREATIVE_CAP);
    truncated = true;
  }

  // Roll up per-campaign orphans (insight rows with no AdInput to
  // stitch onto — typically ARCHIVED / DELETED ads with historical
  // spend in the window) into a single bucket. The grouper only
  // sees ads with full creative payloads; orphans bypass it on
  // purpose because we have no way to render a card for them.
  const unattributed: UnattributedBucket = orphanBuckets.reduce(
    (acc, b) => ({
      ads_count: acc.ads_count + b.ads_count,
      spend: acc.spend + b.spend,
      impressions: acc.impressions + b.impressions,
      clicks: acc.clicks + b.clicks,
      inline_link_clicks: acc.inline_link_clicks + b.inline_link_clicks,
      landingPageViews: acc.landingPageViews + b.landingPageViews,
      registrations: acc.registrations + b.registrations,
      purchases: acc.purchases + b.purchases,
    }),
    {
      ads_count: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      inline_link_clicks: 0,
      landingPageViews: 0,
      registrations: 0,
      purchases: 0,
    } as UnattributedBucket,
  );

  // Reconciliation: warn when the unattributed bucket is more than a
  // rounding error so a regression in the widen / stitch path shows
  // up immediately. Originally dev-only (PR #58) but PR 4/4 of the
  // Apr 2026 bundle flipped it to server-log everywhere — the warn
  // line is the canary for stitch-path regressions that otherwise go
  // unnoticed once they hit production. `console.warn` keeps it as
  // non-PagerDuty noise in Vercel logs. Still requires a meaningful
  // orphan share (> 5%) so the baseline noise from genuinely deleted
  // ads doesn't spam the logs.
  if (unattributed.ads_count > 0) {
    const stitchedSpend = creatives.reduce(
      (acc, c) => acc + (c.spend ?? 0),
      0,
    );
    const totalSpend = stitchedSpend + unattributed.spend;
    const orphanShare = totalSpend > 0 ? unattributed.spend / totalSpend : 0;
    if (orphanShare > 0.05) {
      console.warn(
        `[active-creatives] ${(orphanShare * 100).toFixed(1)}% of total ` +
          `creative spend is unattributed (${unattributed.ads_count} ads, ` +
          `£${unattributed.spend.toFixed(2)} of £${totalSpend.toFixed(2)}) ` +
          `— widen the /ads effective_status filter or audit the stitch path.`,
      );
    }
  }

  return {
    creatives,
    ad_account_id: adAccountId,
    meta: {
      campaigns_total: campaigns.length,
      campaigns_failed: failed.length,
      // `ads_fetched` reflects the distinct-ad count after dedup —
      // semantically "how many distinct creatives are running",
      // not "how many duplicate rows the upstream fan-out
      // produced". The duplicate count is broken out separately in
      // `cross_campaign_duplicates` for debugging.
      ads_fetched: dedupedAds.length,
      dropped_no_creative: droppedNoCreative,
      truncated,
      auth_expired: authExpired,
      cross_campaign_duplicates: crossCampaignDuplicates,
      unattributed,
    },
  };
}
