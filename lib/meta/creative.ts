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

/**
 * Per-feature opt-out shape Meta uses inside `degrees_of_freedom_spec`.
 *
 * Each Advantage+ creative enhancement (image brightness/contrast, music,
 * text variations, "standard enhancements", etc.) is its own switch. Setting
 * `enroll_status: "OPT_OUT"` tells Meta we never want that feature applied
 * to the creative — it's the Marketing-API equivalent of unticking the
 * matching toggle in Ads Manager's Advantage+ creative panel.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/advantage-plus-creative
 */
export type CreativeFeatureOptOut = { enroll_status: "OPT_OUT" };

export interface DegreesOfFreedomSpec {
  creative_features_spec?: Record<string, CreativeFeatureOptOut>;
}

export interface MetaCreativePayload {
  name: string;
  /** Used for new ads (link / image) */
  object_story_spec?: MetaObjectStorySpec;
  /** Used for existing FB Page post boosts: "{pageId}_{postId}" */
  object_story_id?: string;
  /**
   * Used for existing **Instagram** post boosts. Pass the IG media id and
   * pair with {@link instagram_actor_id} so Meta knows which IG account is
   * publishing the ad.
   */
  source_instagram_media_id?: string;
  /** Required when `source_instagram_media_id` is set. */
  instagram_actor_id?: string;
  /**
   * Strict-mode opt-outs for Advantage+ creative enhancements. Populated by
   * {@link sanitizeCreativeForStrictMode}; never set directly by the
   * per-source builders. See its docstring for the full feature list.
   */
  degrees_of_freedom_spec?: DegreesOfFreedomSpec;
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
  /**
   * Creative Integrity Mode — strips Advantage+ enhancements + auto-added
   * assets before each `/adcreatives` POST. Defaults to `true` server-side
   * if omitted, matching the wizard's default behaviour.
   */
  creativeIntegrityMode?: boolean;
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
  const source = creative.existingPost?.source ?? "facebook";
  const postId = creative.existingPost?.postId ?? "";

  // ── Instagram existing post ─────────────────────────────────────────────
  // Boosting an IG-only media item uses `source_instagram_media_id` together
  // with `instagram_actor_id`. Falls back to `creative.identity.instagramAccountId`
  // when the existing-post selection didn't capture one (older drafts).
  if (source === "instagram") {
    const igActor =
      creative.existingPost?.instagramAccountId ||
      creative.identity.instagramAccountId ||
      "";
    if (!igActor) {
      console.warn(
        `[buildExistingPostCreative] "${creative.name}": IG existing post selected ` +
          `but no instagramAccountId is available — Meta will reject the ad.`,
      );
    }
    return {
      name: creative.name || "Existing IG Post Creative",
      // `source_instagram_media_id` accepts the IG media id and clones it as
      // an ad creative. Together with `instagram_actor_id` it tells Meta which
      // IG account is doing the boosting.
      source_instagram_media_id: postId,
      ...(igActor ? { instagram_actor_id: igActor } : {}),
    } as MetaCreativePayload;
  }

  // ── Facebook existing post ──────────────────────────────────────────────
  const pageId = creative.identity.pageId;
  // Meta's object_story_id format: "{page_id}_{post_id}".
  // If postId already contains the page prefix, use as-is.
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

// ─── Creative Integrity Mode (strict sanitizer) ──────────────────────────────

/**
 * Every Advantage+ / auto-enhancement Marketing-API feature key we know of.
 * Each one is forced to `OPT_OUT` when Creative Integrity Mode is on.
 *
 * Keys mirror what Meta documents under
 * `creative_features_spec` on the ad creative endpoint. Unknown keys are
 * silently ignored by Meta, but adding a non-existent key has historically
 * been safe — Meta validates the *value* shape, not the key whitelist. We
 * still keep the list reasonably tight so the outbound payload stays small.
 *
 * If any of these names becomes invalid in a future Meta release the worst
 * case is a single creative POST returns a 400, which the launch route
 * surfaces and reports — drop the offending key from the list and re-deploy.
 */
const STRICT_MODE_FEATURE_OPT_OUTS: readonly string[] = [
  // Umbrella switch — Meta treats this as "all default Advantage+ creative".
  "standard_enhancements",
  "advantage_plus_creative",
  // Image transforms
  "image_brightness_and_contrast",
  "image_uncrop",
  "image_touchups",
  "image_background_gen",
  "image_templates",
  "image_enhancement",
  // Video transforms
  "video_auto_crop",
  "video_filtering",
  "video_highlights",
  // Copy / text
  "text_optimizations",
  "text_generation",
  "description_automation",
  "adapt_to_placement",
  // Add-ons
  "music",
  "site_extensions",
  "product_extensions",
  "media_type_automation",
  "3d_animation",
  "inline_comment",
  // Catalog / dynamic
  "catalog_items",
];

/**
 * Fields anywhere inside `link_data` that represent auto-added assets
 * (sitelinks, callouts, app links, dynamic-ad children, etc.). Stripped
 * entirely so an upstream tweak can't sneak them in.
 */
const STRICT_MODE_LINK_DATA_STRIPS: readonly string[] = [
  "child_attachments",
  "app_link_spec",
  "preferred_image_tags",
  "format_option",
  "attachment_style",
  "collection_thumbnails",
  "dynamic_ad_voice",
  "event_id",
  "show_multiple_images",
  "additional_image_index",
  "branded_content_shared_to_sponsor_status",
];

/** Top-level keys on the creative payload that imply auto-content. */
const STRICT_MODE_TOP_LEVEL_STRIPS: readonly string[] = [
  "asset_feed_spec",
  "dynamic_ad_voice",
  "product_set_id",
  "applink_treatment",
  "template_url_spec",
  "recommender_settings",
  "use_page_actor_override",
  "branded_content_sponsor_page_id",
];

/**
 * Result of running {@link sanitizeCreativeForStrictMode}. Surfaced in the
 * launch route so the per-creative log can report exactly what we stripped
 * and which opt-outs we attached.
 */
export interface StrictModeSanitizationReport {
  /** Always `true` — included so callers can structure-log unconditionally. */
  applied: true;
  /** Top-level keys removed from the creative payload. */
  strippedTopLevel: string[];
  /**
   * `link_data` sub-keys removed. Only populated when the creative has a
   * `link_data` block (image / link creatives).
   */
  strippedLinkData: string[];
  /** `creative_features_spec` keys we forced to OPT_OUT. */
  optedOutFeatures: string[];
}

/**
 * Mutates `payload` in place to enforce **Creative Integrity Mode**: ads
 * publish exactly as configured, with every known Advantage+ enhancement
 * and every auto-added asset disabled.
 *
 * Concretely this:
 *   1. Removes top-level fields that introduce auto content
 *      (`asset_feed_spec`, `product_set_id`, `template_url_spec`, …).
 *   2. Strips known sitelink / dynamic-children / app-link fields from
 *      `object_story_spec.link_data`.
 *   3. Adds `degrees_of_freedom_spec.creative_features_spec` with every
 *      enhancement forced to `enroll_status: "OPT_OUT"`.
 *
 * Inputs that the user explicitly chose are **never touched**: page id,
 * Instagram actor id, uploaded media (image_hash / image_url / video_id),
 * caption text, headline, description, destination URL, CTA, and the
 * existing-post id.
 *
 * Idempotent — calling twice is safe; the second call is a no-op for keys
 * that were already removed and re-asserts the same opt-out spec.
 */
export function sanitizeCreativeForStrictMode(
  payload: MetaCreativePayload,
): StrictModeSanitizationReport {
  const strippedTopLevel: string[] = [];
  const strippedLinkData: string[] = [];

  // Cast to a permissive record so we can probe & delete unknown auto-fields
  // that callers may add later without having to widen MetaCreativePayload.
  const bag = payload as unknown as Record<string, unknown>;
  for (const key of STRICT_MODE_TOP_LEVEL_STRIPS) {
    if (key in bag) {
      delete bag[key];
      strippedTopLevel.push(key);
    }
  }

  const linkData = payload.object_story_spec?.link_data as
    | (Record<string, unknown> & { call_to_action?: unknown })
    | undefined;
  if (linkData) {
    for (const key of STRICT_MODE_LINK_DATA_STRIPS) {
      if (key in linkData) {
        delete linkData[key];
        strippedLinkData.push(key);
      }
    }
  }

  // Force every known feature to OPT_OUT. Merge with any pre-existing spec
  // so an explicit caller opt-in (e.g. a future override) isn't silently
  // overridden — but the strict list always wins for keys it owns.
  const existing = payload.degrees_of_freedom_spec?.creative_features_spec ?? {};
  const optedOutFeatures: string[] = [];
  const merged: Record<string, CreativeFeatureOptOut> = { ...existing };
  for (const feature of STRICT_MODE_FEATURE_OPT_OUTS) {
    merged[feature] = { enroll_status: "OPT_OUT" };
    optedOutFeatures.push(feature);
  }
  payload.degrees_of_freedom_spec = { creative_features_spec: merged };

  return {
    applied: true,
    strippedTopLevel,
    strippedLinkData,
    optedOutFeatures,
  };
}
