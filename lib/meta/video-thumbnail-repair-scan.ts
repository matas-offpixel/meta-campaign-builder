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
 *   3. `resolveImageHashMetadata` — GET /{adAccountId}/adimages?hashes=["<hash>"]
 *      resolves the ad image Meta actually serves for that image_hash today
 *      (url + width/height/name — see the detection-gap fix below for why
 *      more than just `url` is needed).
 *   4. `isMetaPlaceholderThumbnailImage` (imported from video-thumbnail-poll.ts)
 *      flags that image as the spinner/placeholder → broken.
 *
 * `scanCampaignForBrokenVideoAds` wires all four together with a
 * rate-limit-friendly sleep between calls (1/sec by default, overridable —
 * pass `sleepMs: 0` in tests).
 *
 * Follow-up fix (over-scan guard): the spinner-thumbnail bug can only exist
 * on ads created on/after {@link DEFAULT_BUG_INTRODUCED_AT} (the date PR
 * #748 — the change that started uploading `picture` as `image_hash` —
 * merged). Legacy campaigns can have hundreds of pre-#748 ads using the
 * `image_url` path, which this repair does not apply to and which would
 * otherwise be scanned (and rate-limited-slept through) for nothing.
 * `fetchCampaignAds` now also requests `created_time`; `filterAdsByCreatedTime`
 * drops anything older BEFORE the expensive per-ad/per-hash resolution
 * calls. `scanCampaignForBrokenVideoAds` additionally refuses to scan a
 * campaign whose filtered ad count still exceeds
 * {@link DEFAULT_MAX_ADS_PER_CAMPAIGN} unless the caller passes
 * `bypassSizeCap: true` (the script's `--campaign-ids` explicit-opt-in mode).
 *
 * Follow-up fix (detection gap — task #128 continued): PR #764's dry run
 * against 7 explicitly-targeted, known-affected campaigns (338+ post-#748
 * ads) found ZERO broken creatives, even though "IPC Motion 1"
 * (draft `faf11b6f` / creative `6e168e8b`) demonstrably has a spinner-GIF
 * asset baked in. Root cause: once the spinner is uploaded via `/adimages`,
 * `GET /{adAccountId}/adimages?hashes=[h]&fields=url` resolves to an
 * ad-account-scoped `scontent*.fbcdn.net` URL — never the original
 * `static.xx.fbcdn.net/rsrc.php/...` URL {@link isMetaPlaceholderThumbnailUrl}
 * (a URL/host classifier) was built to catch. Detection now inspects the
 * IMAGE ITSELF instead of its URL: `resolveImageHashMetadata` requests
 * `width,height,name` alongside `url`, and — only when those don't already
 * settle it — `fetchContentLength` HEADs the resolved URL for its on-disk
 * size. {@link isMetaPlaceholderThumbnailImage} (video-thumbnail-poll.ts)
 * classifies the combined fingerprint: the spinner is a ~1 KB 16×16 GIF;
 * real thumbnails are 15–50 KB JPGs at video aspect ratios. See
 * `scripts/repair-video-thumbnails.mjs --diagnose-hash=<hash> --ad-account=<id>`
 * for the one-off operator tool that prints this resolved fingerprint for a
 * single hash (used to confirm IPC Motion 1's hash lands under the new
 * classifier before trusting a full scan).
 */

import { isMetaPlaceholderThumbnailImage, type MetaAdImageFingerprint } from "./video-thumbnail-poll.ts";
import { withActPrefix } from "./ad-account-id.ts";

export type { MetaAdImageFingerprint } from "./video-thumbnail-poll.ts";

const META_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * The date PR #748 merged (the change that started uploading Meta's
 * `picture` response straight into `video_data.image_hash`, which is what
 * let the placeholder/spinner get baked into a creative). Ads created
 * before this can't have the bug — they either predate `image_hash` upload
 * entirely or used a different thumbnail path.
 */
export const DEFAULT_BUG_INTRODUCED_AT = "2026-08-07T00:00:00+00:00";

/** Campaigns with more affected-window ads than this require an explicit `bypassSizeCap` opt-in. */
export const DEFAULT_MAX_ADS_PER_CAMPAIGN = 200;

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
  /** ISO 8601 (Meta's ad-level `created_time` format, e.g. "2026-08-10T12:34:56+0000"). */
  created_time?: string;
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
  /** The resolved image fingerprint that triggered the classification — useful for logging/diagnostics. */
  fingerprint: MetaAdImageFingerprint;
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

/** GET /{campaignId}/ads?fields=id,name,created_time,creative{id,object_story_spec} — paginated. */
export async function fetchCampaignAds(campaignId: string, token: string): Promise<MetaAdSummary[]> {
  const ads: MetaAdSummary[] = [];
  let after: string | undefined;

  for (;;) {
    const url = new URL(`${META_API_BASE}/${campaignId}/ads`);
    url.searchParams.set("fields", "id,name,created_time,creative{id,object_story_spec}");
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

export interface FilterAdsByCreatedTimeResult {
  kept: MetaAdSummary[];
  skippedCount: number;
}

/**
 * Drops ads created strictly before `bugIntroducedAt` (default
 * {@link DEFAULT_BUG_INTRODUCED_AT}) — they predate PR #748 and cannot have
 * the spinner-thumbnail bug. Ads with a missing/unparseable `created_time`
 * are conservatively KEPT (we'd rather scan an extra ad than silently miss
 * a genuinely broken one because Meta omitted a field).
 */
export function filterAdsByCreatedTime(
  ads: MetaAdSummary[],
  bugIntroducedAt: string = DEFAULT_BUG_INTRODUCED_AT,
): FilterAdsByCreatedTimeResult {
  const cutoff = new Date(bugIntroducedAt).getTime();
  const kept: MetaAdSummary[] = [];
  let skippedCount = 0;

  for (const ad of ads) {
    const createdAt = ad.created_time ? new Date(ad.created_time).getTime() : NaN;
    if (Number.isFinite(createdAt) && createdAt < cutoff) {
      skippedCount++;
      continue;
    }
    kept.push(ad);
  }

  return { kept, skippedCount };
}

interface CampaignAccountResponse {
  account_id?: string;
  name?: string;
  error?: { message?: string };
}

/** GET /{campaignId}?fields=account_id,name — used by `--campaign-ids` targeted mode, which skips draft discovery entirely. */
export async function fetchCampaignAccountId(
  campaignId: string,
  token: string,
): Promise<{ adAccountId: string; campaignName?: string }> {
  const url = `${META_API_BASE}/${campaignId}?fields=account_id,name&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = (await res.json()) as CampaignAccountResponse;
  if (!res.ok || json.error) {
    throw new Error(`GET /${campaignId}?fields=account_id,name failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  if (!json.account_id) {
    throw new Error(`/${campaignId} response had no account_id`);
  }
  return { adAccountId: json.account_id, campaignName: json.name };
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

interface AdImageRecord {
  hash?: string;
  url?: string;
  width?: number;
  height?: number;
  name?: string;
}

interface AdImagesResponse {
  data?: AdImageRecord[];
  error?: { message?: string };
}

/**
 * GET /{adAccountId}/adimages?hashes=["<hash>"]&fields=hash,url,width,height,name
 * — resolves the full image metadata Meta currently has for a single
 * image_hash (not just its URL — see the module doc comment's "detection
 * gap" fix for why width/height/name matter).
 */
export async function resolveImageHashMetadata(
  adAccountId: string,
  hash: string,
  token: string,
): Promise<MetaAdImageFingerprint | undefined> {
  const url = new URL(`${META_API_BASE}/${withActPrefix(adAccountId)}/adimages`);
  url.searchParams.set("hashes", JSON.stringify([hash]));
  url.searchParams.set("fields", "hash,url,width,height,name");
  url.searchParams.set("access_token", token);

  const res = await fetch(url.toString());
  const json = (await res.json()) as AdImagesResponse;
  if (!res.ok || json.error) {
    throw new Error(
      `GET /${withActPrefix(adAccountId)}/adimages?hashes=["${hash}"] failed: ${json.error?.message ?? `HTTP ${res.status}`}`,
    );
  }
  const record = json.data?.find((d) => d.hash === hash) ?? json.data?.[0];
  if (!record) return undefined;
  return { url: record.url, width: record.width, height: record.height, name: record.name };
}

/**
 * HEAD the resolved image URL to read its on-disk size from the
 * `content-length` response header. Used as a fallback signal when
 * width/height/name/gif-extension checks alone don't settle the
 * classification (real thumbnails always clear this; the spinner never
 * does). Returns `undefined` on any failure — callers should tolerate a
 * missing content length rather than treat it as broken OR as safe.
 */
export async function fetchContentLength(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return undefined;
    const header = res.headers?.get?.("content-length");
    if (!header) return undefined;
    const parsed = Number(header);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
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
  /** Ads created before this are dropped before any creative/hash resolution. Defaults to {@link DEFAULT_BUG_INTRODUCED_AT}. */
  bugIntroducedAt?: string;
  /** Refuse to scan (see `sizeCapExceeded`) once the post-date-filter ad count exceeds this. Defaults to {@link DEFAULT_MAX_ADS_PER_CAMPAIGN}. */
  maxAdsPerCampaign?: number;
  /** Explicit operator opt-in (the script's `--campaign-ids` mode) to scan a campaign regardless of `maxAdsPerCampaign`. */
  bypassSizeCap?: boolean;
}

export interface ScanCampaignResult {
  broken: BrokenVideoAdTarget[];
  /** Total ads returned by Meta before any filtering. */
  totalAdCount: number;
  /** Ads dropped by the created_time filter (predate the bug). */
  skippedOldAdCount: number;
  /** Ads actually eligible for creative/hash resolution (totalAdCount - skippedOldAdCount). */
  scannedAdCount: number;
  /**
   * True when `scannedAdCount > maxAdsPerCampaign` and `bypassSizeCap` was
   * not set — in this case NO creative/hash resolution calls were made
   * (`broken` is always `[]`) and the caller should surface a warning
   * asking the operator to re-run with `--campaign-ids=<id>` to opt in.
   */
  sizeCapExceeded: boolean;
}

/**
 * Scans every (bug-window-eligible) ad in one Meta campaign and returns the
 * ones whose live creative is currently serving Meta's placeholder/spinner
 * thumbnail.
 *
 * Rate-limit-friendly: sleeps `sleepMs` before each ad's creative resolution
 * and before each unique image_hash's URL resolution (hashes are deduped
 * first, so a campaign where many ads share one creative/hash only resolves
 * it once). Ads older than `bugIntroducedAt` are dropped before any of
 * those calls; campaigns whose remaining ad count exceeds
 * `maxAdsPerCampaign` are skipped entirely unless `bypassSizeCap` is set —
 * both guard against accidentally rate-limit-sleeping through hundreds of
 * legacy ads that can't be affected.
 */
export async function scanCampaignForBrokenVideoAds(
  campaignId: string,
  adAccountId: string,
  token: string,
  opts: ScanCampaignOptions = {},
): Promise<ScanCampaignResult> {
  const sleepMs = opts.sleepMs ?? 1000;
  const log = opts.onProgress ?? (() => {});
  const bugIntroducedAt = opts.bugIntroducedAt ?? DEFAULT_BUG_INTRODUCED_AT;
  const maxAdsPerCampaign = opts.maxAdsPerCampaign ?? DEFAULT_MAX_ADS_PER_CAMPAIGN;

  const allAds = await fetchCampaignAds(campaignId, token);
  const { kept: ads, skippedCount: skippedOldAdCount } = filterAdsByCreatedTime(allAds, bugIntroducedAt);
  log(
    `fetched ${allAds.length} ad(s) for campaign ${campaignId} — ` +
      `${skippedOldAdCount}/${allAds.length} too old to be affected (before ${bugIntroducedAt}) — skipping`,
  );

  if (!opts.bypassSizeCap && ads.length > maxAdsPerCampaign) {
    log(
      `campaign ${campaignId} has ${ads.length} ad(s) after the date filter (> ${maxAdsPerCampaign} cap) — ` +
        `skipping. Re-run with --campaign-ids=${campaignId} to explicitly opt in.`,
    );
    return { broken: [], totalAdCount: allAds.length, skippedOldAdCount, scannedAdCount: ads.length, sizeCapExceeded: true };
  }

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
  const hashToFingerprint = new Map<string, MetaAdImageFingerprint>();
  for (const hash of uniqueHashes) {
    if (sleepMs > 0) await sleep(sleepMs);
    try {
      const metadata = await resolveImageHashMetadata(adAccountId, hash, token);
      if (!metadata) continue;

      // Only pay for the extra CDN round-trip when width/height/name/gif
      // checks didn't already settle it — most real thumbnails land here.
      let fingerprint = metadata;
      if (!isMetaPlaceholderThumbnailImage(metadata) && metadata.url) {
        if (sleepMs > 0) await sleep(sleepMs);
        const contentLengthBytes = await fetchContentLength(metadata.url);
        fingerprint = { ...metadata, contentLengthBytes };
      }
      hashToFingerprint.set(hash, fingerprint);
    } catch (err) {
      log(`  image_hash ${hash}: failed to resolve metadata — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const broken = findBrokenVideoAds(infos, hashToFingerprint);
  return { broken, totalAdCount: allAds.length, skippedOldAdCount, scannedAdCount: ads.length, sizeCapExceeded: false };
}

/**
 * Pure variant of the broken-ad filter for callers that have already
 * resolved every ad's video info + hash→fingerprint map themselves (used
 * directly by unit tests to isolate the detection logic from the network
 * pipeline).
 */
export function findBrokenVideoAds(
  infos: VideoCreativeInfo[],
  hashToFingerprint: Map<string, MetaAdImageFingerprint>,
): BrokenVideoAdTarget[] {
  const broken: BrokenVideoAdTarget[] = [];
  for (const info of infos) {
    const fingerprint = hashToFingerprint.get(info.imageHash);
    if (fingerprint && isMetaPlaceholderThumbnailImage(fingerprint)) {
      broken.push({ ...info, placeholderUrl: fingerprint.url ?? "", fingerprint });
    }
  }
  return broken;
}
