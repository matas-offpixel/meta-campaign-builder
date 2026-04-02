/**
 * lib/meta/creative.ts
 *
 * Pure-logic helpers for ad creative and ad creation:
 *   - CTA mapping     (internal → Meta API enum)
 *   - Creative payload building (link/image, existing post; video skipped in Phase 5)
 *   - Ad payload building
 *   - Validation
 *
 * No API calls here — import createMetaCreative / createMetaAd from lib/meta/client.ts.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-creative/
 */

import type { AdCreativeDraft, CTAType, AdSetSuggestion } from "@/lib/types";

/**
 * Whether to include instagram_actor_id in creative payloads.
 *
 * Set to `false` to force page-identity-only mode. Meta rejects IG actor IDs
 * that are not explicitly verified as valid actors for the selected page + ad
 * account combination (error #100). Until we add a verification step that
 * calls GET /{page_id}?fields=instagram_business_account and confirms the
 * returned ID matches, it's safest to omit the field entirely.
 *
 * When set to `true`, falls back to numeric format validation.
 */
const ALLOW_IG_ACTOR = false;

function isValidIgActorId(id: string | undefined | null): id is string {
  if (!ALLOW_IG_ACTOR) return false;
  return !!id && /^\d{10,}$/.test(id);
}

// ─── CTA mapping ──────────────────────────────────────────────────────────────

export const CTA_MAP: Record<CTAType, string> = {
  sign_up: "SIGN_UP",
  learn_more: "LEARN_MORE",
  book_now: "BOOK_NOW",
} as const;

export function mapCTAToMeta(cta: CTAType): string {
  return CTA_MAP[cta] ?? "LEARN_MORE";
}

// ─── Meta payload types ───────────────────────────────────────────────────────

interface MetaCallToAction {
  type: string;
  value?: { link: string };
}

interface MetaLinkData {
  message: string;
  link: string;
  name?: string;        // headline
  description?: string;
  image_url?: string;   // URL-based image (fallback when no hash available)
  image_hash?: string;  // Meta image hash — preferred over image_url
  call_to_action: MetaCallToAction;
}

interface MetaVideoData {
  video_id: string;
  message: string;
  title?: string;
  // description is NOT a valid field inside video_data — Meta rejects it
  call_to_action: MetaCallToAction;
}

interface MetaObjectStorySpec {
  page_id: string;
  /** Instagram account ID for placements. Maps to creative.identity.instagramAccountId. */
  instagram_actor_id?: string;
  link_data?: MetaLinkData;
  video_data?: MetaVideoData;
}

export interface MetaCreativePayload {
  name: string;
  /** Used for new ads (link / image) */
  object_story_spec?: MetaObjectStorySpec;
  /** Used for existing page/IG post boosts: "{pageId}_{postId}" */
  object_story_id?: string;
}

export interface MetaAdPayload {
  name: string;
  /** Real Meta ad set ID */
  adset_id: string;
  creative: { creative_id: string };
  status: "PAUSED" | "ACTIVE";
}

// ─── Route request / response types ──────────────────────────────────────────

export interface CreateCreativesAndAdsRequest {
  metaAdAccountId: string;
  /** AdCreativeDraft objects to create */
  creatives: AdCreativeDraft[];
  /**
   * Assignment matrix: Record<internalAdSetId, internalCreativeId[]>
   * Keys are AdSetSuggestion.id, values are AdCreativeDraft.id[].
   */
  assignments: Record<string, string[]>;
  /** Ad set suggestions with metaAdSetId populated (from Phase 4) */
  adSetSuggestions: AdSetSuggestion[];
}

export interface CreativeCreationResult {
  name: string;
  internalId: string;
  metaCreativeId: string;
  ads: { adSetName: string; metaAdId: string }[];
  adsFailed: { adSetName: string; error: string }[];
}

export interface CreativeFailureResult {
  name: string;
  internalId: string;
  error: string;
}

export interface CreateCreativesAndAdsResult {
  created: CreativeCreationResult[];
  failed: CreativeFailureResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Priority order for picking the "primary" asset when multiple ratios exist
const HASH_PRIORITY = ["4:5", "9:16", "1:1"] as const;
const VIDEO_PRIORITY = ["9:16", "4:5", "1:1"] as const;

/**
 * Pick the best image hash from the first AssetVariation.
 * Meta prefers hash over image_url for ad creative API calls.
 */
function pickPrimaryImageHash(creative: AdCreativeDraft): string | undefined {
  const assets = creative.assetVariations?.[0]?.assets ?? [];
  for (const ratio of HASH_PRIORITY) {
    const a = assets.find((x) => x.aspectRatio === ratio && x.assetHash);
    if (a?.assetHash) return a.assetHash;
  }
  return undefined;
}

/**
 * Pick the best Meta video ID from the first AssetVariation.
 */
function pickPrimaryVideoId(creative: AdCreativeDraft): string | undefined {
  const assets = creative.assetVariations?.[0]?.assets ?? [];
  for (const ratio of VIDEO_PRIORITY) {
    const a = assets.find((x) => x.aspectRatio === ratio && x.videoId);
    if (a?.videoId) return a.videoId;
  }
  return undefined;
}

/**
 * Pick the best uploaded URL from the first AssetVariation (fallback when no hash).
 * Priority: 4:5 → 9:16 → 1:1.
 */
function pickPrimaryAssetUrl(creative: AdCreativeDraft): string | undefined {
  const assets = creative.assetVariations?.[0]?.assets ?? [];
  for (const ratio of HASH_PRIORITY) {
    const a = assets.find(
      (x) => x.aspectRatio === ratio && x.uploadedUrl?.startsWith("http"),
    );
    if (a?.uploadedUrl) return a.uploadedUrl;
  }
  return undefined;
}

/**
 * Pick the primary caption text (first non-empty caption).
 */
function pickPrimaryCaption(creative: AdCreativeDraft): string {
  return creative.captions?.find((c) => c.text?.trim())?.text?.trim() ?? "";
}

// ─── Creative payload builders ────────────────────────────────────────────────

function buildLinkCreative(creative: AdCreativeDraft): MetaCreativePayload {
  const caption = pickPrimaryCaption(creative);
  const cta = mapCTAToMeta(creative.cta);

  const linkData: MetaLinkData = {
    message: caption,
    link: creative.destinationUrl,
    name: creative.headline || undefined,
    description: creative.description || undefined,
    call_to_action: {
      type: cta,
      value: { link: creative.destinationUrl },
    },
  };

  // Prefer image_hash (from real Meta upload) over image_url (CDN URL fallback)
  const imageHash = pickPrimaryImageHash(creative);
  if (imageHash) {
    linkData.image_hash = imageHash;
  } else {
    const imageUrl = pickPrimaryAssetUrl(creative);
    if (imageUrl) linkData.image_url = imageUrl;
  }

  const spec: MetaObjectStorySpec = {
    page_id: creative.identity.pageId,
    link_data: linkData,
  };
  const igId = creative.identity.instagramAccountId;
  if (isValidIgActorId(igId)) {
    spec.instagram_actor_id = igId;
    console.log(`[buildLinkCreative] "${creative.name}": using IG actor ${igId}`);
  } else if (igId) {
    console.warn(`[buildLinkCreative] "${creative.name}": dropping invalid instagram_actor_id "${igId}"`);
  }

  return {
    name: creative.name || "Ad Creative",
    object_story_spec: spec,
  };
}

function buildVideoCreative(creative: AdCreativeDraft): MetaCreativePayload {
  const videoId = pickPrimaryVideoId(creative);
  if (!videoId) {
    throw new Error(
      "Video creative requires an uploaded Meta video ID. " +
        "Upload the video asset first via the Creatives step.",
    );
  }

  const caption = pickPrimaryCaption(creative);
  const cta = mapCTAToMeta(creative.cta);

  const videoData: MetaVideoData = {
    video_id: videoId,
    message: caption,
    call_to_action: {
      type: cta,
      value: { link: creative.destinationUrl },
    },
  };
  // title is valid in video_data; description is NOT — omit it
  if (creative.headline) {
    videoData.title = creative.headline;
  }

  const spec: MetaObjectStorySpec = {
    page_id: creative.identity.pageId,
    video_data: videoData,
  };
  const igId = creative.identity.instagramAccountId;
  if (isValidIgActorId(igId)) {
    spec.instagram_actor_id = igId;
    console.log(`[buildVideoCreative] "${creative.name}": using IG actor ${igId}`);
  } else if (igId) {
    console.warn(`[buildVideoCreative] "${creative.name}": dropping invalid instagram_actor_id "${igId}"`);
  }

  return {
    name: creative.name || "Ad Creative",
    object_story_spec: spec,
  };
}

function buildExistingPostCreative(creative: AdCreativeDraft): MetaCreativePayload {
  const pageId = creative.identity.pageId;
  const postId = creative.existingPost?.postId ?? "";
  // Meta's object_story_id format: "{page_id}_{post_id}"
  // If postId already contains the page prefix, use as-is
  const storyId = postId.includes("_") ? postId : `${pageId}_${postId}`;

  return {
    name: creative.name || "Existing Post Creative",
    object_story_id: storyId,
  };
}

/**
 * Build the Meta ad creative payload for a given AdCreativeDraft.
 *
 * Per-type behaviour:
 *   "existing_post"         → object_story_id boost
 *   "new" + video assets    → object_story_spec with video_data
 *   "new" + image assets    → object_story_spec with link_data + image_hash
 *
 * IMPORTANT: we branch on the *actual uploaded asset IDs*, not on
 * creative.mediaType.  That field reflects the UI selection at creation time
 * but can become stale (e.g. a creative created as "video" whose slot was
 * later filled with an image file, or vice-versa).  Trusting mediaType alone
 * caused the "Unsupported video type 'image/jpeg'" error: buildVideoCreative
 * was called for a creative whose only uploaded asset is an image (assetHash
 * present, videoId absent), and the image hash was used where a video ID was
 * expected.
 *
 * Resolution order:
 *   1. Any asset in any variation has a videoId  → video creative path
 *   2. Otherwise                                 → image/link creative path
 */
export function buildCreativePayload(creative: AdCreativeDraft): MetaCreativePayload {
  if (creative.sourceType === "existing_post") {
    return buildExistingPostCreative(creative);
  }

  // Determine effective type from what was actually uploaded, not the draft flag.
  const hasVideoId = (creative.assetVariations ?? []).some((v) =>
    (v.assets ?? []).some((a) => !!a.videoId),
  );
  const hasImageHash = (creative.assetVariations ?? []).some((v) =>
    (v.assets ?? []).some((a) => !!a.assetHash),
  );

  // If the draft says "video" but only image hashes are present, warn and fall
  // through to the image path to prevent the "image/jpeg is not a valid video"
  // error from Meta.
  if (creative.mediaType === "video" && !hasVideoId && hasImageHash) {
    console.warn(
      `[buildCreativePayload] "${creative.name}": mediaType is "video" but no videoId ` +
        "found — falling back to image creative path (assetHash present).",
    );
  }

  // If the draft says "image" but a videoId was found, use the video path.
  if (creative.mediaType === "image" && hasVideoId) {
    console.warn(
      `[buildCreativePayload] "${creative.name}": mediaType is "image" but videoId ` +
        "found — using video creative path.",
    );
  }

  if (hasVideoId) {
    return buildVideoCreative(creative);
  }

  return buildLinkCreative(creative);
}

// ─── Ad payload builder ───────────────────────────────────────────────────────

export function buildAdPayload(
  name: string,
  metaCreativeId: string,
  metaAdSetId: string,
): MetaAdPayload {
  return {
    name,
    adset_id: metaAdSetId,
    creative: { creative_id: metaCreativeId },
    status: "PAUSED",
  };
}

// ─── Assignment helper ────────────────────────────────────────────────────────

/**
 * Invert the assignment matrix from { adSetId: creativeId[] }
 * to { creativeId: adSetId[] } so we can process by creative.
 */
export function invertAssignments(
  assignments: Record<string, string[]>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [adSetId, creativeIds] of Object.entries(assignments)) {
    for (const creativeId of creativeIds) {
      if (!result[creativeId]) result[creativeId] = [];
      result[creativeId].push(adSetId);
    }
  }
  return result;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateCreativePayload(creative: AdCreativeDraft): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const label = creative.name || creative.id;

  if (!creative.identity?.pageId) {
    errors.push(`${label}: Facebook page ID is required`);
  }

  if (creative.sourceType === "new") {
    const hasCaption = creative.captions?.some((c) => c.text?.trim());
    if (!hasCaption) errors.push(`${label}: at least one caption is required`);
    if (!creative.destinationUrl?.startsWith("http")) {
      errors.push(`${label}: a valid destination URL is required`);
    }
    const hasUploadedAsset = creative.assetVariations?.some((v) =>
      v.assets?.some((a) => a.uploadStatus === "uploaded"),
    );
    if (!hasUploadedAsset) {
      errors.push(`${label}: at least one asset must be uploaded`);
    }
  }

  if (creative.sourceType === "existing_post" && !creative.existingPost?.postId) {
    errors.push(`${label}: existing post ID is required`);
  }

  return { isValid: errors.length === 0, errors };
}
