/**
 * lib/meta/video-thumbnail-repair-scan.ts
 *
 * task #128 follow-up — canonical, unit-tested detection pipeline behind
 * `scripts/repair-video-thumbnails.mjs` (the script mirrors this logic
 * inline, same convention as `isMetaPlaceholderThumbnailUrl` in
 * `lib/meta/video-thumbnail-poll.ts`, so the plain `.mjs` script doesn't
 * need a TS loader).
 *
 * Root cause of the first repair attempt finding zero broken creatives:
 * detection scanned `campaign_drafts.draft_json` for
 * `creative.metaCreativeId` + `asset.thumbnailUrl`, but `metaCreativeId` is
 * never written back to the draft after launch (confirmed via SQL — draft
 * `faf11b6f` / creative `6e168e8b` has no `metaCreativeId` key even though
 * the ad is live on Meta with a spinner-hash creative). `draft_json` is a
 * point-in-time snapshot from the LAST autosave before/during launch; it was
 * never designed to be re-synced with what Meta actually created. See
 * `advantageAudienceObjectiveMismatchMessage`-style task tracking: task #130
 * flags writing `metaCreativeId` back in `launch-campaign/route.ts` Phase 4
 * as a follow-up so future repair scripts don't need this detour.
 *
 * Fix: query Meta directly instead of trusting the draft snapshot.
 * `campaign_drafts` is used ONLY to discover which `metaCampaignId`s exist
 * for which `adAccountId` (both of those ARE written back reliably — see
 * `publishCampaign` in `lib/db/drafts.ts` and `CampaignAttachResult` in
 * `lib/types.ts`). Everything about the actual ad/creative/thumbnail state
 * comes straight from the Graph API:
 *
 *   1. `fetchCampaignAds` — GET /{campaignId}/ads?fields=id,name,creative{id,object_story_spec}
 *      (paginated, 100/page).
 *   2. `resolveVideoCreativeInfo` — pulls video_id + image_hash out of each
 *      ad's (already-expanded) object_story_spec.video_data; falls back to
 *      `fetchCreativeObjectStorySpec` (a direct GET /{creativeId}) on the
 *      rare ad where Meta didn't expand the nested field.
 *   3. `resolveImageHashUrl` — GET /{adAccountId}/adimages?hashes=["<hash>"]
 *      resolves what CDN URL Meta actually serves for that image_hash today.
 *   4. `isMetaPlaceholderThumbnailUrl` (imported from video-thumbnail-poll.ts)
 *      flags that URL as the spinner/placeholder → broken.
 *
 * `scanCampaignForBrokenVideoAds` wires all four together with a
 * rate-limit-friendly sleep between calls (1/sec by default, overridable —
 * pass `sleepMs: 0` in tests).
 */

import { isMetaPlaceholderThumbnailUrl } from "./video-thumbnail-poll.ts";
import { withActPrefix } from "./ad-account-id.ts";

const META_API_BASE = "https://graph.facebook.com/v21.0";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Wire shapes (Meta Graph API response, snake_case as returned) ──────────

export interface MetaVideoDataSummary {
  video_id?: string;
  image_hash?: string;
  image_url?: string;
}

export interface MetaObjectStorySpecSummary {
  video_data?: MetaVideoDataSummary;
}

export interface MetaAdCreativeSummary {
  id: string;
  object_story_spec?: MetaObjectStorySpecSummary;
}

export interface MetaAdSummary {
  id: string;
  name?: string;
  creative?: MetaAdCreativeSummary;
}

export interface VideoCreativeInfo {
  adId: string;
  adName?: string;
  creativeId: string;
  videoId: string;
  imageHash: string;
}

export interface BrokenVideoAdTarget extends VideoCreativeInfo {
  placeholderUrl: string;
}

// ─── Pure extraction (no network) ────────────────────────────────────────────

/**
 * Extracts the video/creative identifiers from an ad whose `object_story_spec`
 * is already known (either expanded inline by the `/ads` call, or resolved
 * via the `fetchCreativeObjectStorySpec` fallback). Returns `null` for
 * non-video ads, or video ads missing `video_id`/`image_hash` (nothing to
 * check — e.g. a creative already using `image_url` only).
 */
export function extractVideoCreativeInfoFromSpec(
  ad: MetaAdSummary,
  spec: MetaObjectStorySpecSummary | undefined,
): VideoCreativeInfo | null {
  if (!ad.creative?.id) return null;
  const videoData = spec?.video_data;
  if (!videoData?.video_id || !videoData?.image_hash) return null;
  return {
    adId: ad.id,
    adName: ad.name,
    creativeId: ad.creative.id,
    videoId: videoData.video_id,
    imageHash: videoData.image_hash,
  };
}

// ─── Network calls (mockable via globalThis.fetch in tests) ─────────────────

interface MetaAdsPageResponse {
  data?: MetaAdSummary[];
  paging?: { cursors?: { after?: string }; next?: string };
  error?: { message?: string };
}

/** GET /{campaignId}/ads?fields=id,name,creative{id,object_story_spec} — paginated. */
export async function fetchCampaignAds(campaignId: string, token: string): Promise<MetaAdSummary[]> {
  const ads: MetaAdSummary[] = [];
  let after: string | undefined;

  for (;;) {
    const url = new URL(`${META_API_BASE}/${campaignId}/ads`);
    url.searchParams.set("fields", "id,name,creative{id,object_story_spec}");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", token);
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString());
    const json = (await res.json()) as MetaAdsPageResponse;
    if (!res.ok || json.error) {
      throw new Error(`GET /${campaignId}/ads failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
    }

    ads.push(...(json.data ?? []));

    const nextAfter = json.paging?.cursors?.after;
    if (!json.paging?.next || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return ads;
}

interface CreativeResponse {
  object_story_spec?: MetaObjectStorySpecSummary;
  error?: { message?: string };
}

/** GET /{creativeId}?fields=object_story_spec — fallback when /ads didn't expand it. */
export async function fetchCreativeObjectStorySpec(
  creativeId: string,
  token: string,
): Promise<MetaObjectStorySpecSummary | undefined> {
  const url = `${META_API_BASE}/${creativeId}?fields=object_story_spec&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as CreativeResponse;
  if (!res.ok || json.error) {
    throw new Error(`GET /${creativeId}?fields=object_story_spec failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json.object_story_spec;
}

interface AdImagesResponse {
  data?: { hash?: string; url?: string }[];
  error?: { message?: string };
}

/** GET /{adAccountId}/adimages?hashes=["<hash>"] — resolves the CDN URL Meta currently serves for a single image_hash. */
export async function resolveImageHashUrl(
  adAccountId: string,
  hash: string,
  token: string,
): Promise<string | undefined> {
  const url = new URL(`${META_API_BASE}/${withActPrefix(adAccountId)}/adimages`);
  url.searchParams.set("hashes", JSON.stringify([hash]));
  url.searchParams.set("fields", "hash,url");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString());
  const json = (await res.json()) as AdImagesResponse;
  if (!res.ok || json.error) {
    throw new Error(
      `GET /${withActPrefix(adAccountId)}/adimages?hashes=["${hash}"] failed: ${json.error?.message ?? `HTTP ${res.status}`}`,
    );
  }
  return json.data?.find((d) => d.hash === hash)?.url ?? json.data?.[0]?.url;
}

/**
 * Resolves an ad's video creative info, falling back to a direct creative
 * fetch when `/ads`'s nested `creative{object_story_spec}` expansion came
 * back empty (observed occasionally on Meta's side — depth-expansion is not
 * 100% guaranteed).
 */
export async function resolveVideoCreativeInfo(
  ad: MetaAdSummary,
  token: string,
): Promise<VideoCreativeInfo | null> {
  if (!ad.creative?.id) return null;

  let spec = ad.creative.object_story_spec;
  if (!spec?.video_data) {
    spec = await fetchCreativeObjectStorySpec(ad.creative.id, token);
  }
  return extractVideoCreativeInfoFromSpec(ad, spec);
}

// ─── Full per-campaign scan ───────────────────────────────────────────────────

export interface ScanCampaignOptions {
  /** Delay between Meta calls in ms. Defaults to 1000 (1/sec). Pass 0 in tests. */
  sleepMs?: number;
  /** Injected so tests/scripts can observe progress without real network latency. */
  onProgress?: (message: string) => void;
}

/**
 * Scans every ad in one Meta campaign and returns the ones whose live
 * creative is currently serving Meta's placeholder/spinner thumbnail.
 *
 * Rate-limit-friendly: sleeps `sleepMs` before each ad's creative resolution
 * and before each unique image_hash's URL resolution (hashes are deduped
 * first, so a campaign where many ads share one creative/hash only resolves
 * it once).
 */
export async function scanCampaignForBrokenVideoAds(
  campaignId: string,
  adAccountId: string,
  token: string,
  opts: ScanCampaignOptions = {},
): Promise<BrokenVideoAdTarget[]> {
  const sleepMs = opts.sleepMs ?? 1000;
  const log = opts.onProgress ?? (() => {});

  const ads = await fetchCampaignAds(campaignId, token);
  log(`fetched ${ads.length} ad(s) for campaign ${campaignId}`);

  const infos: VideoCreativeInfo[] = [];
  for (const ad of ads) {
    if (sleepMs > 0) await sleep(sleepMs);
    try {
      const info = await resolveVideoCreativeInfo(ad, token);
      if (info) infos.push(info);
    } catch (err) {
      log(`  ad ${ad.id}: failed to resolve creative — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(`${infos.length} video ad(s) with an image_hash to check`);

  const uniqueHashes = [...new Set(infos.map((i) => i.imageHash))];
  const hashToUrl = new Map<string, string>();
  for (const hash of uniqueHashes) {
    if (sleepMs > 0) await sleep(sleepMs);
    try {
      const url = await resolveImageHashUrl(adAccountId, hash, token);
      if (url) hashToUrl.set(hash, url);
    } catch (err) {
      log(`  image_hash ${hash}: failed to resolve URL — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const broken: BrokenVideoAdTarget[] = [];
  for (const info of infos) {
    const url = hashToUrl.get(info.imageHash);
    if (url && isMetaPlaceholderThumbnailUrl(url)) {
      broken.push({ ...info, placeholderUrl: url });
    }
  }
  return broken;
}

/**
 * Pure variant of the broken-ad filter for callers that have already
 * resolved every ad's video info + hash→URL map themselves (used directly
 * by unit tests to isolate the detection logic from the network pipeline).
 */
export function findBrokenVideoAds(
  infos: VideoCreativeInfo[],
  hashToUrl: Map<string, string>,
): BrokenVideoAdTarget[] {
  const broken: BrokenVideoAdTarget[] = [];
  for (const info of infos) {
    const url = hashToUrl.get(info.imageHash);
    if (url && isMetaPlaceholderThumbnailUrl(url)) {
      broken.push({ ...info, placeholderUrl: url });
    }
  }
  return broken;
}
