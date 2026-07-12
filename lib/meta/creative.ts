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

// ─── CTA mapping ──────────────────────────────────────────────────────────────

export const CTA_MAP: Record<CTAType, string> = {
  sign_up: "SIGN_UP",
  learn_more: "LEARN_MORE",
  book_now: "BOOK_NOW",
  buy_tickets: "BUY_TICKETS",
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
  /**
   * Thumbnail image URL for the video creative. Meta requires either
   * image_url OR image_hash in video_data (code=100, subcode=1443226 when
   * absent). Populated from the asset's thumbnailUrl (set by uploadVideoAsset
   * via POST /act_X/advideos → previewUrl).
   */
  image_url?: string;
  // description is NOT a valid field inside video_data — Meta rejects it
  call_to_action: MetaCallToAction;
}

interface MetaObjectStorySpec {
  page_id: string;
  /**
   * Instagram account id for new-ad placements. Required for IG Stories/Reels
   * rendering when the creative is a new_ad (not an existing post).
   *
   * Use `instagram_user_id` — the Marketing API (v21+) rejects the legacy
   * `instagram_actor_id` field name with (#100) even when the id is valid.
   * Proven via validate_only probes on v21.0 and v23.0 (PR #569 audit).
   *
   * Value = the IG business account id from /{pageId}/instagram_accounts or
   * the BM-asset list (validated by createIgActorValidator / PR #568).
   */
  instagram_user_id?: string;
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

// ─── asset_feed_spec types (Placement Asset Customization) ────────────────────
//
// Per-placement creative: one asset per placement bucket via
// asset_customization_rules. Used by buildMultiPlacementCreative so Feed renders
// the 4:5 asset and Stories/Reels render the 9:16 asset.
//
// Reference: Meta Marketing API → Placement Asset Customization
//   https://developers.facebook.com/documentation/ads-commerce/marketing-api/dynamic-creative/placement-asset-customization

export interface MetaAdLabel {
  name: string;
}

export interface AssetFeedImage {
  hash: string;
  /**
   * Used ONLY by Placement Asset Customization ({@link buildMultiPlacementCreative}),
   * whose per-placement `asset_customization_rules` reference each image by its
   * adlabel name. Left optional because variation-rotation
   * ({@link buildVariationRotationCreative}) and any Dynamic-Creative spec carry
   * NO adlabels and NO rules — Meta rotates the assets natively once the AD SET
   * is `is_dynamic_creative:true`.
   */
  adlabels?: MetaAdLabel[];
}

export interface AssetFeedVideo {
  video_id: string;
  thumbnail_url?: string;
  /** See {@link AssetFeedImage.adlabels}. */
  adlabels?: MetaAdLabel[];
}

export interface AssetFeedText {
  text: string;
  adlabels?: MetaAdLabel[];
}

export interface AssetFeedLinkUrl {
  website_url: string;
  adlabels?: MetaAdLabel[];
}

/**
 * Placement targeting for one customization rule. An **empty object** (`{}`)
 * marks the default / catch-all rule (matches every placement not claimed by a
 * more specific rule) — this is the documented fallback mechanism, see the
 * Threads example in Meta's Placement Asset Customization guide.
 */
export interface CustomizationSpec {
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
}

export interface AssetCustomizationRule {
  customization_spec: CustomizationSpec;
  /** Required for SINGLE_IMAGE rules — references an image's adlabel name. */
  image_label?: MetaAdLabel;
  /** Required for SINGLE_VIDEO rules — references a video's adlabel name. */
  video_label?: MetaAdLabel;
}

export interface AssetFeedSpec {
  images?: AssetFeedImage[];
  videos?: AssetFeedVideo[];
  bodies?: AssetFeedText[];
  titles?: AssetFeedText[];
  descriptions?: AssetFeedText[];
  link_urls?: AssetFeedLinkUrl[];
  call_to_action_types?: string[];
  /** ["SINGLE_VIDEO"] or ["SINGLE_IMAGE"] — single-format per placement. */
  ad_formats?: string[];
  /** "PLACEMENT" for Placement Asset Customization. */
  optimization_type?: string;
  /**
   * The per-placement rules. **At least two are required** by Meta for any
   * asset_feed_spec that uses customization rules. The presence of this
   * (non-empty) array is what distinguishes a user-configured placement spec
   * from an Advantage+ / Dynamic-Creative auto spec (which has no rules).
   */
  asset_customization_rules?: AssetCustomizationRule[];
}

export interface MetaCreativePayload {
  name: string;
  /** Used for new ads (link / image) */
  object_story_spec?: MetaObjectStorySpec;
  /**
   * Per-placement asset feed. When present, `object_story_spec` carries only
   * `page_id` (no link_data / video_data) — the assets live here. See
   * {@link buildMultiPlacementCreative}.
   */
  asset_feed_spec?: AssetFeedSpec;
  /** Used for existing FB Page post boosts: "{pageId}_{postId}" */
  object_story_id?: string;
  /**
   * Used for existing **Instagram** post boosts. Pass the IG media id
   * together with {@link instagram_user_id} (the IG account that owns the
   * media — the content account, NOT the ad-account actor).
   *
   * Correct payload shape (Meta Marketing API):
   *   { name, source_instagram_media_id, instagram_user_id }
   *   — do NOT combine with object_story_spec.
   */
  source_instagram_media_id?: string;
  /**
   * IG business/creator account id — used in two contexts:
   *
   * 1. **Existing-post boosts**: the content account that owns the
   *    `source_instagram_media_id` post. Send alongside `source_instagram_media_id`,
   *    NOT with `object_story_spec`.
   * 2. **New-ad creatives** (v21+): also use `instagram_user_id` inside
   *    `object_story_spec` (via `MetaObjectStorySpec.instagram_user_id`). The
   *    legacy `instagram_actor_id` field is rejected by Meta with (#100) even
   *    when the id value is correct — proven on v21.0 and v23.0 (PR #569).
   *
   * Value = IG business account id validated by `createIgActorValidator`.
   */
  instagram_user_id?: string;
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
 * @deprecated Use pickPrimaryVideoAsset to also get the thumbnail.
 */
function pickPrimaryVideoId(creative: AdCreativeDraft): string | undefined {
  return pickPrimaryVideoAsset(creative)?.videoId;
}

/**
 * Pick the best video asset (videoId + thumbnailUrl) from the first AssetVariation.
 * Returns the same asset that would have been chosen by the old pickPrimaryVideoId so
 * the thumbnail is guaranteed to belong to the same file as the video ID.
 *
 * Priority: 9:16 → 4:5 → 1:1 (matches VIDEO_PRIORITY).
 */
function pickPrimaryVideoAsset(
  creative: AdCreativeDraft,
): { videoId: string; thumbnailUrl?: string } | undefined {
  const assets = creative.assetVariations?.[0]?.assets ?? [];
  for (const ratio of VIDEO_PRIORITY) {
    const a = assets.find((x) => x.aspectRatio === ratio && x.videoId);
    if (a?.videoId) return { videoId: a.videoId, thumbnailUrl: a.thumbnailUrl };
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

function buildLinkCreative(
  creative: AdCreativeDraft,
  validatedIgActorId?: string,
): MetaCreativePayload {
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

  // page_id + link_data. instagram_user_id is added only when the caller has
  // pre-validated it via createIgActorValidator — avoids Meta code=100
  // "unauthorised actor" for unverified ids while restoring IG identity
  // for authorised ones (fixes subcode=1772103 for Instagram placements).
  // NOTE: field is instagram_user_id, NOT instagram_actor_id. The legacy key
  // is rejected by Meta v21+ even when the id value is correct (PR #569).
  const spec: MetaObjectStorySpec = {
    page_id: creative.identity.pageId,
    link_data: linkData,
  };
  if (validatedIgActorId) {
    spec.instagram_user_id = validatedIgActorId;
  }

  console.log(
    `[buildLinkCreative] "${creative.name}": new_ad` +
      `\n  page_id = ${spec.page_id}` +
      `\n  instagram_user_id = ${validatedIgActorId ? "SET (validated)" : "OMITTED (page-only identity)"}` +
      `\n  payload keys: [name, object_story_spec{page_id, link_data${validatedIgActorId ? ", instagram_user_id" : ""}}]`,
  );

  return {
    name: creative.name || "Ad Creative",
    object_story_spec: spec,
  };
}

function buildVideoCreative(
  creative: AdCreativeDraft,
  validatedIgActorId?: string,
): MetaCreativePayload {
  const videoAsset = pickPrimaryVideoAsset(creative);
  if (!videoAsset) {
    throw new Error(
      "Video creative requires an uploaded Meta video ID. " +
        "Upload the video asset first via the Creatives step.",
    );
  }

  const { videoId, thumbnailUrl } = videoAsset;
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

  // Meta requires image_url OR image_hash in video_data (code=100, subcode=1443226
  // when absent). thumbnailUrl comes from uploadVideoAsset → POST /advideos →
  // previewUrl, stored on Asset.thumbnailUrl. For drafts created before this fix,
  // thumbnailUrl may be undefined — in that case omit the field and let Meta
  // auto-generate a thumbnail rather than throwing.
  if (thumbnailUrl) {
    videoData.image_url = thumbnailUrl;
  }

  // page_id + video_data. instagram_user_id added when caller has pre-validated
  // via createIgActorValidator — same logic as buildLinkCreative.
  // NOTE: instagram_user_id, not instagram_actor_id (PR #569).
  const spec: MetaObjectStorySpec = {
    page_id: creative.identity.pageId,
    video_data: videoData,
  };
  if (validatedIgActorId) {
    spec.instagram_user_id = validatedIgActorId;
  }

  const hasThumbnail = Boolean(videoData.image_url);
  console.error(
    `[buildVideoCreative] "${creative.name}": videoId=${videoId} thumbnail=${thumbnailUrl ?? "(none — Meta will auto-generate)"} instagram_user_id=${validatedIgActorId ? "SET (validated)" : "OMITTED"}`,
  );
  if (!hasThumbnail) {
    console.error(
      `[buildVideoCreative] WARNING: no image_url set for "${creative.name}" — ` +
        `Meta may reject with code=100 subcode=1443226. ` +
        `Re-upload the video asset to capture thumbnailUrl.`,
    );
  }

  return {
    name: creative.name || "Ad Creative",
    object_story_spec: spec,
  };
}

// ─── Per-placement (multi-aspect-ratio) creative ──────────────────────────────

/**
 * Placement bucket for the **vertical** (9:16) asset → Stories & Reels.
 *
 * The Feed bucket is intentionally NOT enumerated: its rule uses an empty
 * `customization_spec` ({}) so it acts as the catch-all default, covering Feed
 * plus every placement the vertical rule does not claim (marketplace, search,
 * right-hand column, audience network, …). This guarantees full placement
 * coverage with no gaps — critical because the ad sets use automatic
 * placements, so every placement is eligible.
 */
const STORIES_REELS_SPEC: CustomizationSpec = {
  publisher_platforms: ["facebook", "instagram"],
  facebook_positions: ["story", "facebook_reels"],
  instagram_positions: ["story", "reels"],
};

const FEED_RATIOS = ["4:5", "1:1"] as const;
const VERTICAL_RATIO = "9:16" as const;

interface MultiPlacementPlan {
  mediaKind: "video" | "image";
  /** 4:5 (preferred) or 1:1 — the Feed / default asset. */
  feed: { videoId?: string; assetHash?: string; thumbnailUrl?: string; aspectRatio: string };
  /** 9:16 — the Stories/Reels asset. */
  vertical: { videoId?: string; assetHash?: string; thumbnailUrl?: string; aspectRatio: string };
}

/**
 * Detect whether a creative has both a Feed (4:5/1:1) asset AND a vertical
 * (9:16) asset of the **same media kind**, each with a valid uploaded ID.
 *
 * Returns null (→ caller falls through to the single-asset path) when:
 *   - only one aspect ratio is filled, or
 *   - the two filled buckets are mixed media (image + video), or
 *   - there is no 9:16 asset (no Stories/Reels target).
 *
 * Only looks at `assetVariations[0]` — same scope as the single-asset pickers.
 */
function detectMultiPlacement(creative: AdCreativeDraft): MultiPlacementPlan | null {
  const assets = creative.assetVariations?.[0]?.assets ?? [];

  const vertical = assets.find((a) => a.aspectRatio === VERTICAL_RATIO);
  const feed = FEED_RATIOS.map((r) => assets.find((a) => a.aspectRatio === r)).find(Boolean);
  if (!vertical || !feed) return null;

  const bothVideo = !!vertical.videoId && !!feed.videoId;
  const bothImage = !!vertical.assetHash && !!feed.assetHash;

  // Same-media only. Mixed image+video per-placement is a documented follow-up.
  if (!bothVideo && !bothImage) return null;

  const mediaKind: "video" | "image" = bothVideo ? "video" : "image";
  return {
    mediaKind,
    feed: {
      videoId: feed.videoId,
      assetHash: feed.assetHash,
      thumbnailUrl: feed.thumbnailUrl,
      aspectRatio: feed.aspectRatio,
    },
    vertical: {
      videoId: vertical.videoId,
      assetHash: vertical.assetHash,
      thumbnailUrl: vertical.thumbnailUrl,
      aspectRatio: vertical.aspectRatio,
    },
  };
}

const FEED_LABEL = "feed_asset";
const STORY_LABEL = "story_asset";

/**
 * Build a per-placement creative using `asset_feed_spec` +
 * `asset_customization_rules`: the 4:5/1:1 asset renders in Feed (and all
 * non-vertical placements), the 9:16 asset renders in Stories & Reels.
 *
 * Shape follows Meta's Placement Asset Customization guide:
 *   - `object_story_spec` carries ONLY `page_id` — assets live in
 *     `asset_feed_spec`. (Do NOT also send link_data / video_data here; mixing
 *     them with asset_feed_spec triggers code=100.)
 *   - Two rules (Meta requires ≥2): the vertical rule (explicit Stories/Reels
 *     placements) and the Feed default rule (empty customization_spec catch-all).
 *   - `bodies` / `titles` / `descriptions` / `link_urls` carry no adlabels, so
 *     they apply across every placement (copy is not customized per placement).
 *
 * Caller (`buildCreativePayload`) only routes here when `detectMultiPlacement`
 * returns a plan, so both buckets are guaranteed present and same-media.
 */
function buildMultiPlacementCreative(
  creative: AdCreativeDraft,
  plan: MultiPlacementPlan,
  validatedIgActorId?: string,
): MetaCreativePayload {
  const caption = pickPrimaryCaption(creative);
  const cta = mapCTAToMeta(creative.cta);

  const spec: AssetFeedSpec = {
    bodies: [{ text: caption }],
    link_urls: [{ website_url: creative.destinationUrl }],
    call_to_action_types: [cta],
    optimization_type: "PLACEMENT",
  };

  if (creative.headline) spec.titles = [{ text: creative.headline }];
  if (creative.description) spec.descriptions = [{ text: creative.description }];

  if (plan.mediaKind === "video") {
    spec.ad_formats = ["SINGLE_VIDEO"];
    spec.videos = [
      {
        video_id: plan.feed.videoId!,
        ...(plan.feed.thumbnailUrl ? { thumbnail_url: plan.feed.thumbnailUrl } : {}),
        adlabels: [{ name: FEED_LABEL }],
      },
      {
        video_id: plan.vertical.videoId!,
        ...(plan.vertical.thumbnailUrl ? { thumbnail_url: plan.vertical.thumbnailUrl } : {}),
        adlabels: [{ name: STORY_LABEL }],
      },
    ];
    spec.asset_customization_rules = [
      { customization_spec: STORIES_REELS_SPEC, video_label: { name: STORY_LABEL } },
      // Default catch-all (empty spec) → Feed asset. Must be last.
      { customization_spec: {}, video_label: { name: FEED_LABEL } },
    ];
  } else {
    spec.ad_formats = ["SINGLE_IMAGE"];
    spec.images = [
      { hash: plan.feed.assetHash!, adlabels: [{ name: FEED_LABEL }] },
      { hash: plan.vertical.assetHash!, adlabels: [{ name: STORY_LABEL }] },
    ];
    spec.asset_customization_rules = [
      { customization_spec: STORIES_REELS_SPEC, image_label: { name: STORY_LABEL } },
      { customization_spec: {}, image_label: { name: FEED_LABEL } },
    ];
  }

  const rules = spec.asset_customization_rules ?? [];
  console.error(
    `[buildMultiPlacementCreative] "${creative.name}" multi-placement payload:`,
    JSON.stringify({
      mediaKind: plan.mediaKind,
      feedAspect: plan.feed.aspectRatio,
      storyAspect: plan.vertical.aspectRatio,
      hasFeedVideoId: plan.mediaKind === "video" ? !!plan.feed.videoId : undefined,
      hasStoryVideoId: plan.mediaKind === "video" ? !!plan.vertical.videoId : undefined,
      hasFeedHash: plan.mediaKind === "image" ? !!plan.feed.assetHash : undefined,
      hasStoryHash: plan.mediaKind === "image" ? !!plan.vertical.assetHash : undefined,
      hasFeedThumb: plan.mediaKind === "video" ? !!plan.feed.thumbnailUrl : undefined,
      hasStoryThumb: plan.mediaKind === "video" ? !!plan.vertical.thumbnailUrl : undefined,
      adFormat: spec.ad_formats?.[0],
      optimizationType: spec.optimization_type,
      rulesCount: rules.length,
      ruleSpecs: rules.map((r) => ({
        labelField: "video_label" in r ? "video_label" : "image_label",
        labelName: (r.video_label ?? r.image_label)?.name,
        specKeys: Object.keys(r.customization_spec ?? {}),
        platforms: r.customization_spec?.publisher_platforms,
        fbPositions: r.customization_spec?.facebook_positions,
        igPositions: r.customization_spec?.instagram_positions,
      })),
    }),
  );

  return {
    name: creative.name || "Ad Creative",
    // page_id (+ optional instagram_user_id) — assets are in asset_feed_spec.
    // NOTE: instagram_user_id, not instagram_actor_id (PR #569).
    object_story_spec: {
      page_id: creative.identity.pageId,
      ...(validatedIgActorId ? { instagram_user_id: validatedIgActorId } : {}),
    },
    asset_feed_spec: spec,
  };
}

// ─── Variation rotation (Single mode + N variations) ──────────────────────────
//
// Matas's design intent: "variations" = asset rotation within a single ad via
// asset_feed_spec — Meta natively rotates the assets and optimizes toward the
// best performer (Dynamic Creative). Separate ads are created via the
// "Add Ad" button, not via variations.
//
// SCOPE (this PR): Single mode only (all variations are 9:16, one asset each).
// Dual/Full mode + N variations is a follow-up (see buildCreativePayload).

export interface VariationRotationPlan {
  mediaKind: "video" | "image";
  variations: Array<{
    videoId?: string;
    assetHash?: string;
    thumbnailUrl?: string;
  }>;
}

/**
 * Detect whether a creative is eligible for variation-rotation asset_feed_spec:
 * Single asset mode, 2+ variations, each with exactly one uploaded asset of
 * the same media kind.
 *
 * Returns null (→ caller falls through to existing single-asset / multi-
 * placement paths) when:
 *   - fewer than 2 variations, or
 *   - assetMode is not "single" (Dual/Full + N variations is out of scope
 *     for this PR — see buildCreativePayload's dual-mode fallback log), or
 *   - any variation is missing its asset or the asset has no uploaded id, or
 *   - variations mix image and video assets.
 */
export function detectVariationRotation(creative: AdCreativeDraft): VariationRotationPlan | null {
  const variations = creative.assetVariations ?? [];
  if (variations.length < 2) return null;

  // Single mode only for now — all variations must have exactly 1 asset each,
  // all 9:16 aspect ratio.
  if (creative.assetMode !== "single") return null;

  const collected: VariationRotationPlan["variations"] = [];
  let mediaKind: "video" | "image" | null = null;

  for (const variation of variations) {
    const asset = variation.assets?.[0];
    if (!asset) return null; // incomplete variation
    if (!asset.videoId && !asset.assetHash) return null; // no uploaded asset

    const kind: "video" | "image" = asset.videoId ? "video" : "image";
    if (mediaKind === null) mediaKind = kind;
    else if (mediaKind !== kind) return null; // mixed media across variations

    collected.push({
      videoId: asset.videoId,
      assetHash: asset.assetHash,
      thumbnailUrl: asset.thumbnailUrl,
    });
  }

  return { mediaKind: mediaKind!, variations: collected };
}

/**
 * Build a variation-rotation creative using a **Dynamic Creative**
 * `asset_feed_spec` with N assets and NO `asset_customization_rules`.
 *
 * This is the correct shape for asset rotation (verified 2026-07-02 via Meta
 * MCP probe on account 10151014958791885 — the images[{hash}] + bodies +
 * titles + link_urls + call_to_action_types + ad_formats payload reached the
 * ad-set-level check and was rejected only because the target ad set already
 * had ads, error 1885553 — the payload shape itself is valid):
 *   - `images`/`videos` carry ONLY the asset id (hash / video_id, + optional
 *     thumbnail) — NO adlabels. Meta rotates them natively.
 *   - NO `asset_customization_rules` and NO `optimization_type` — those belong
 *     to Placement Asset Customization ({@link buildMultiPlacementCreative}),
 *     NOT rotation. PR #665's shared-adlabel + rules workaround was structurally
 *     wrong (Meta reject subcode 1885878) and is deleted here.
 *   - single-entry `bodies`/`titles`/`descriptions`/`link_urls`/
 *     `call_to_action_types`/`ad_formats` — copy is shared across the rotation.
 *
 * CRITICAL: this creative only rotates if the AD SET it is attached to is
 * created with `is_dynamic_creative:true` (see `buildAdSetPayload`) — otherwise
 * Meta silently degrades it to a single asset. A dynamic ad set also allows AT
 * MOST ONE ad (enforced in the launch orchestration).
 *
 * `object_story_spec` carries only `page_id` (+ optional `instagram_user_id`);
 * the assets live in `asset_feed_spec`.
 *
 * Caller (`buildCreativePayload`) only routes here when `detectVariationRotation`
 * returns a plan, and never for CTA=BOOK_NOW (blocked in AFS, constraint 1885396).
 */
function buildVariationRotationCreative(
  creative: AdCreativeDraft,
  plan: VariationRotationPlan,
  validatedIgActorId?: string,
): MetaCreativePayload {
  const caption = pickPrimaryCaption(creative);
  const cta = mapCTAToMeta(creative.cta);

  const spec: AssetFeedSpec = {
    bodies: [{ text: caption }],
    link_urls: [{ website_url: creative.destinationUrl }],
    call_to_action_types: [cta],
  };

  if (creative.headline) spec.titles = [{ text: creative.headline }];
  if (creative.description) spec.descriptions = [{ text: creative.description }];

  if (plan.mediaKind === "video") {
    spec.ad_formats = ["SINGLE_VIDEO"];
    spec.videos = plan.variations.map((v) => ({
      video_id: v.videoId!,
      ...(v.thumbnailUrl ? { thumbnail_url: v.thumbnailUrl } : {}),
    }));
  } else {
    spec.ad_formats = ["SINGLE_IMAGE"];
    spec.images = plan.variations.map((v) => ({ hash: v.assetHash! }));
  }

  console.error(
    `[buildVariationRotationCreative] "${creative.name}" DYNAMIC-CREATIVE rotation payload:`,
    JSON.stringify({
      mediaKind: plan.mediaKind,
      variationCount: plan.variations.length,
      adFormat: spec.ad_formats?.[0],
      hasAdlabels: false,
      hasCustomizationRules: false,
      note: "requires is_dynamic_creative:true on the ad set (set in buildAdSetPayload)",
      ids:
        plan.mediaKind === "video"
          ? plan.variations.map((v) => v.videoId)
          : plan.variations.map((v) => v.assetHash),
    }),
  );

  return {
    name: creative.name || "Ad Creative",
    object_story_spec: {
      page_id: creative.identity.pageId,
      ...(validatedIgActorId ? { instagram_user_id: validatedIgActorId } : {}),
    },
    asset_feed_spec: spec,
  };
}

/**
 * True when a creative will build a Dynamic-Creative variation-rotation payload
 * (and therefore requires its ad set to be `is_dynamic_creative:true`).
 *
 * Mirrors the routing in {@link buildCreativePayload} EXACTLY so the launch
 * orchestration flags precisely the ad sets that get a rotation creative:
 *   - gated behind `ENABLE_MULTI_PLACEMENT_ASSETS === "1"` (same flag as the
 *     builder), so it returns false whenever rotation cannot fire;
 *   - never fires for existing-post creatives;
 *   - requires {@link detectVariationRotation} to return a plan (Single mode,
 *     2+ variations, same media kind);
 *   - never fires for CTA=BOOK_NOW (that path falls back to a single asset —
 *     Meta constraint 1885396 — so the ad set must NOT be dynamic).
 */
export function creativeTriggersVariationRotation(creative: AdCreativeDraft): boolean {
  if (process.env.ENABLE_MULTI_PLACEMENT_ASSETS !== "1") return false;
  if (creative.sourceType === "existing_post") return false;
  if (!detectVariationRotation(creative)) return false;
  if (mapCTAToMeta(creative.cta) === "BOOK_NOW") return false;
  return true;
}

/**
 * Detect the BOOK_NOW + multi-placement conflict Meta blocks in
 * `asset_feed_spec.call_to_action_types` (subcode 1885396, PR #574/#575):
 * CTA is BOOK_NOW, `assetMode` is Dual or Full (not Single), and at least
 * one asset variation has BOTH a Feed (4:5/1:1) asset AND a vertical (9:16)
 * asset uploaded.
 *
 * When this fires, {@link buildCreativePayload} silently falls back to a
 * single 9:16 asset cross-published to every placement — the 4:5 Feed asset
 * is never used (live incident: WC26 Bournemouth, 2026-07-10, 10 ads shipped
 * 9:16 to Feed placements). Used to hard-block launch in the bulk-attach
 * Configure Creatives step rather than only warn.
 *
 * Broader than {@link detectMultiPlacement} on purpose: that helper only
 * inspects `assetVariations[0]` (it mirrors the builder's actual launch
 * scope), whereas this checks every variation so the UI block catches the
 * conflict regardless of which variation ends up primary.
 */
export function creativeHasBookNowMultiPlacementConflict(creative: AdCreativeDraft): boolean {
  if (mapCTAToMeta(creative.cta) !== "BOOK_NOW") return false;
  if (creative.assetMode === "single") return false;
  return (creative.assetVariations ?? []).some((variation) => {
    const assets = variation.assets ?? [];
    const hasVertical = assets.some(
      (a) => a.aspectRatio === "9:16" && (a.videoId || a.assetHash),
    );
    const hasFeed = FEED_RATIOS.some((r) =>
      assets.some((a) => a.aspectRatio === r && (a.videoId || a.assetHash)),
    );
    return hasVertical && hasFeed;
  });
}

function buildExistingPostCreative(creative: AdCreativeDraft): MetaCreativePayload {
  const source = creative.existingPost?.source ?? "facebook";
  const postId = creative.existingPost?.postId ?? "";

  // ── Instagram existing post ─────────────────────────────────────────────
  //
  // CORRECT Meta API shape for boosting an existing Instagram post:
  //
  //   {
  //     "name": "...",
  //     "source_instagram_media_id": "<media_id>",
  //     "instagram_user_id": "<content_account_id>"
  //   }
  //
  // Key facts:
  //   - `instagram_user_id`  = the IG business/creator account that OWNS the
  //     post. This is the CONTENT account id (instagram_business_account.id
  //     from the Page), NOT the ad-account-resolved actor id.
  //   - `instagram_actor_id` is for NEW ads via object_story_spec. Do NOT
  //     send it alongside source_instagram_media_id — they are mutually
  //     exclusive for this creative type.
  //   - `object_story_spec` is also NOT used for existing-post boosts.
  //
  // Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-creative/
  if (source === "instagram") {
    // Content account id — the IG account that owns the post.
    // Primary:  identity.instagramAccountId  (page-linked IG, set from the Page's
    //           instagram_business_account.id field at identity resolution time).
    // Fallback: existingPost.instagramAccountId (set when the post was picked in
    //           the post-picker; should equal identity.instagramAccountId).
    const igUserId =
      (creative.identity.instagramAccountId || undefined) ??
      (creative.existingPost?.instagramAccountId || undefined);

    console.log(
      `[buildExistingPostCreative] "${creative.name}": IG existing post` +
        `\n  [Creative Branch]         ig_existing_post` +
        `\n  page_id                   = ${creative.identity.pageId ?? "(unset)"}` +
        `\n  contentAccountId          = ${creative.identity.instagramAccountId ?? "(unset)"}` +
        `\n  existingPost.accountId    = ${creative.existingPost?.instagramAccountId ?? "(unset)"}` +
        `\n  instagram_user_id sent    = ${igUserId ?? "(MISSING)"}` +
        `\n  instagram_actor_id        = OMITTED (not used for source_instagram_media_id)` +
        `\n  source_instagram_media_id = ${postId}`,
    );

    if (!igUserId) {
      throw new Error(
        `No instagram_user_id could be resolved for "${creative.name}". ` +
          `The selected Facebook Page must have a linked Instagram Business or Creator account. ` +
          `Go to the Creatives step, re-select the Page, and confirm the IG account is shown as linked.`,
      );
    }

    // Do NOT include instagram_actor_id — it is not valid for this creative type
    // and causes (#100) rejections when combined with source_instagram_media_id.
    return {
      name: creative.name || "Existing IG Post Creative",
      source_instagram_media_id: postId,
      instagram_user_id: igUserId,
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
 * Build a single-asset creative using the 9:16 VERTICAL asset from a
 * multi-placement plan. Used as the BOOK_NOW fallback: when the user has
 * uploaded both a 4:5 feed asset and a 9:16 vertical asset but chosen
 * BOOK_NOW as the CTA, per-placement AFS routing is unavailable (Meta API
 * subcode=1885396). We cross-publish the vertical asset across all placements
 * so that Stories/Reels receive their native ratio. Feed will auto-crop.
 *
 * The CTA is preserved exactly as configured — no silent substitution.
 */
function buildSingleAssetFromVertical(
  creative: AdCreativeDraft,
  plan: MultiPlacementPlan,
  validatedIgActorId?: string,
): MetaCreativePayload {
  if (plan.mediaKind === "video") {
    // Build a video creative but force the vertical video id + thumbnail.
    // We construct a minimal proxy creative whose only asset is the 9:16 video
    // so that buildVideoCreative's pickPrimaryVideoAsset returns it.
    const caption = pickPrimaryCaption(creative);
    const cta = mapCTAToMeta(creative.cta);
    const videoData: MetaVideoData = {
      video_id: plan.vertical.videoId!,
      message: caption,
      call_to_action: { type: cta, value: { link: creative.destinationUrl } },
    };
    if (creative.headline) videoData.title = creative.headline;
    if (plan.vertical.thumbnailUrl) videoData.image_url = plan.vertical.thumbnailUrl;
    const spec: MetaObjectStorySpec = { page_id: creative.identity.pageId, video_data: videoData };
    if (validatedIgActorId) spec.instagram_user_id = validatedIgActorId;
    return { name: creative.name || "Ad Creative", object_story_spec: spec };
  } else {
    // Build a link creative but force the vertical image hash.
    const caption = pickPrimaryCaption(creative);
    const cta = mapCTAToMeta(creative.cta);
    const linkData: MetaLinkData = {
      message: caption,
      link: creative.destinationUrl,
      name: creative.headline || undefined,
      description: creative.description || undefined,
      call_to_action: { type: cta, value: { link: creative.destinationUrl } },
      image_hash: plan.vertical.assetHash,
    };
    const spec: MetaObjectStorySpec = { page_id: creative.identity.pageId, link_data: linkData };
    if (validatedIgActorId) spec.instagram_user_id = validatedIgActorId;
    return { name: creative.name || "Ad Creative", object_story_spec: spec };
  }
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
/**
 * Options for buildCreativePayload.
 *
 * `validatedIgActorId`: pre-validated Instagram actor id returned by
 * `createIgActorValidator`. When present and truthy the builders set
 * `object_story_spec.instagram_actor_id`, enabling Instagram placement
 * rendering. When absent/undefined the creative falls back to page-only
 * identity (safe for Facebook-only placements, avoids Meta code=100
 * "unauthorised actor" for unverified accounts).
 */
export interface BuildCreativePayloadOpts {
  validatedIgActorId?: string;
}

export function buildCreativePayload(
  creative: AdCreativeDraft,
  opts?: BuildCreativePayloadOpts,
): MetaCreativePayload {
  if (creative.sourceType === "existing_post") {
    return buildExistingPostCreative(creative);
  }

  const { validatedIgActorId } = opts ?? {};

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

  // ── Per-placement (multi-aspect-ratio) creative ──────────────────────────
  // Feature-flagged for safe rollback: when ENABLE_MULTI_PLACEMENT_ASSETS !== "1"
  // we always use the legacy single-asset path (current production behaviour).
  // When ON, a creative that has BOTH a Feed (4:5/1:1) and a vertical (9:16)
  // asset of the same media kind is sent with asset_feed_spec so each placement
  // renders its own asset. Single-aspect creatives are untouched.
  //
  // BOOK_NOW exception (Meta API constraint, PR #574/#575):
  // asset_feed_spec.call_to_action_types: ["BOOK_NOW"] returns subcode=1885396
  // for any objective and any media type — this is a Meta platform restriction,
  // not a wizard bug. When CTA is BOOK_NOW and dual-mode is detected we fall
  // through to the single-asset path using the 9:16 VERTICAL asset so that:
  //   1. The CTA stays BOOK_NOW (never silently substituted).
  //   2. The vertical asset cross-publishes more acceptably across placements
  //      than 4:5 would (Stories/Reels receive the native ratio; Feed auto-crops).
  if (process.env.ENABLE_MULTI_PLACEMENT_ASSETS === "1") {
    // ── Variation rotation (Single mode + N variations) ────────────────────
    // Checked BEFORE multi-placement detection so Single mode + N variations
    // always wins over any accidental multi-placement detection.
    const rotationPlan = detectVariationRotation(creative);
    if (rotationPlan) {
      const metaCta = mapCTAToMeta(creative.cta);
      if (metaCta === "BOOK_NOW") {
        // BOOK_NOW is blocked in asset_feed_spec.call_to_action_types (Meta
        // subcode 1885396) — same constraint as multi-placement. Fall through
        // to the existing single-asset path below, which uses variation[0]
        // only. CTA is preserved as-is (never silently substituted).
        console.error(
          `[buildCreativePayload] "${creative.name}" → SINGLE-ASSET path` +
            ` (BOOK_NOW + N variations blocked in AFS per Meta API constraint 1885396;` +
            ` using variation[0] only. Variations 2-${rotationPlan.variations.length} discarded.` +
            ` To rotate variations: switch CTA to LEARN_MORE, SIGN_UP, or BUY_TICKETS.)`,
        );
        // Fall through — continue to multi-placement / single-asset logic below.
      } else {
        console.error(
          `[buildCreativePayload] "${creative.name}" → VARIATION-ROTATION path` +
            ` (${rotationPlan.variations.length} variations, ${rotationPlan.mediaKind})`,
        );
        return buildVariationRotationCreative(creative, rotationPlan, validatedIgActorId);
      }
    }

    const plan = detectMultiPlacement(creative);
    if (plan) {
      const metaCta = mapCTAToMeta(creative.cta);
      if (metaCta === "BOOK_NOW") {
        // BOOK_NOW is blocked in asset_feed_spec.call_to_action_types (Meta
        // subcode 1885396). Fall through to single-asset using the vertical
        // (9:16) asset. CTA is preserved as-is in link_data / video_data.
        console.error(
          `[buildCreativePayload] "${creative.name}" → SINGLE-ASSET path` +
            ` (BOOK_NOW blocked in AFS per Meta API constraint 1885396;` +
            ` using ${plan.mediaKind} vertical 9:16 asset for all placements)`,
        );
        return buildSingleAssetFromVertical(creative, plan, validatedIgActorId);
      }
      // Dual/Full mode + N variations — OUT OF SCOPE for this PR. The
      // multi-placement path below only ever reads variation[0] (see
      // detectMultiPlacement), so this is already the correct fallback
      // behaviour; we just make the discard explicit in the logs.
      const variationCount = creative.assetVariations?.length ?? 0;
      if (variationCount >= 2) {
        console.error(
          `[buildCreativePayload] "${creative.name}" → variation[0] only` +
            ` (Dual mode + N variations not yet supported — using variation 1 with per-` +
            ` placement customization. Variations 2-${variationCount} discarded. Future PR will extend` +
            ` asset_feed_spec to support Dual + Variations.)`,
        );
      }
      return buildMultiPlacementCreative(creative, plan, validatedIgActorId);
    }
    // Log why we fell through to the single-asset path even though the flag is on.
    const assets = creative.assetVariations?.[0]?.assets ?? [];
    const hasVertical = assets.some((a) => a.aspectRatio === "9:16" && (a.videoId || a.assetHash));
    const hasFeed = FEED_RATIOS.some((r) => assets.some((a) => a.aspectRatio === r && (a.videoId || a.assetHash)));
    const vertAsset = assets.find((a) => a.aspectRatio === "9:16");
    const feedAsset = FEED_RATIOS.map((r) => assets.find((a) => a.aspectRatio === r)).find(Boolean);
    const mixedMedia =
      hasVertical && hasFeed &&
      !!vertAsset?.videoId !== !!feedAsset?.videoId;
    const reason: string = !hasVertical || !hasFeed
      ? "only_one_aspect"
      : mixedMedia
        ? "mixed_media"
        : "missing_id_on_one_aspect";
    console.error(
      `[buildCreativePayload] "${creative.name}" → SINGLE-ASSET path` +
        ` (multi-placement flag ON but fallthrough: ${reason})` +
        ` hasVertical=${hasVertical} hasFeed=${hasFeed} mixedMedia=${mixedMedia}`,
    );
  } else {
    console.error(
      `[buildCreativePayload] "${creative.name}" → SINGLE-ASSET path (multi-placement: flag_off)`,
    );
  }

  return hasVideoId
    ? buildVideoCreative(creative, validatedIgActorId)
    : buildLinkCreative(creative, validatedIgActorId);
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
    // ACTIVE matches the ad set status — ads must be ACTIVE to serve.
    status: "ACTIVE",
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
 * The STRICT allowlist of `creative_features_spec` keys Meta currently
 * accepts (as of the error: "must be one of {…}").  Any key outside this
 * set causes a (#100) 400 error — even previously "safe" keys like
 * `standard_enhancements`, `music`, `image_uncrop`, etc. are now rejected.
 *
 * Only send keys from this list.  We opt out of every accepted key so
 * Meta never silently re-enables enhancements for a strict-mode creative.
 *
 * Source: Meta API error response:
 *   Param key 'music' in degrees_of_freedom_spec[creative_features_spec]
 *   must be one of {IG_VIDEO_NATIVE_SUBTITLE, IMAGE_ANIMATION,
 *   PRODUCT_METADATA_AUTOMATION, PROFILE_CARD, STANDARD_ENHANCEMENTS_CATALOG,
 *   TEXT_OVERLAY_TRANSLATION}
 */
const STRICT_MODE_FEATURE_OPT_OUTS: readonly string[] = [
  "STANDARD_ENHANCEMENTS_CATALOG",
  "IMAGE_ANIMATION",
  "TEXT_OVERLAY_TRANSLATION",
  "PRODUCT_METADATA_AUTOMATION",
  "PROFILE_CARD",
  "IG_VIDEO_NATIVE_SUBTITLE",
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

/**
 * Top-level keys on the creative payload that imply auto-content.
 *
 * NOTE: `asset_feed_spec` is deliberately NOT in this unconditional list.
 * It is handled specially in {@link sanitizeCreativeForStrictMode}: a
 * user-configured Placement Asset Customization spec (one that has
 * `asset_customization_rules`) is **preserved**, while an Advantage+ /
 * Dynamic-Creative auto spec (no rules) is **stripped**.
 */
const STRICT_MODE_TOP_LEVEL_STRIPS: readonly string[] = [
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
  /**
   * How the top-level `asset_feed_spec` (if any) was handled:
   *   - "preserved" — a spec WE built on purpose: Placement Asset Customization
   *     (has `asset_customization_rules`) OR a Dynamic-Creative variation
   *     rotation (no rules but ≥2 images/videos); kept intact.
   *   - "stripped"  — a bare Advantage+ auto spec (no rules AND <2 assets); removed.
   *   - "absent"    — no `asset_feed_spec` on the payload.
   */
  assetFeedSpec: "preserved" | "stripped" | "absent";
}

/**
 * Mutates `payload` in place to enforce **Creative Integrity Mode**: ads
 * publish exactly as configured, with every known Advantage+ enhancement
 * and every auto-added asset disabled.
 *
 * Concretely this:
 *   1. Removes top-level fields that introduce auto content
 *      (`product_set_id`, `template_url_spec`, …).
 *   2. Conditionally handles `asset_feed_spec`: preserves a spec we built —
 *      Placement Asset Customization (has `asset_customization_rules`) or a
 *      Dynamic-Creative variation rotation (no rules, ≥2 assets) — and strips a
 *      bare Advantage+ auto spec (no rules, <2 assets).
 *   3. Strips known sitelink / dynamic-children / app-link fields from
 *      `object_story_spec.link_data`.
 *   4. Adds `degrees_of_freedom_spec.creative_features_spec` with every
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

  // ── asset_feed_spec: preserve the ones WE built, strip a bare auto spec ────
  // Discrimination:
  //   - Placement Asset Customization (ours, buildMultiPlacementCreative)
  //     carries `asset_customization_rules` (per-placement pinning) → PRESERVE.
  //   - Variation rotation (ours, buildVariationRotationCreative) is a
  //     Dynamic-Creative spec: NO customization rules but ALWAYS ≥2 images or
  //     videos ("For Dynamic Creative, asset_feed_spec should not have
  //     customization rules" — Meta docs). ≥2 assets is the positive signal that
  //     we built this on purpose → PRESERVE. (Stripping it would silently defeat
  //     the fix, since Creative Integrity Mode defaults ON.)
  //   - A bare Advantage+ / auto spec has no rules AND <2 assets (Meta only
  //     ever auto-adds a single extra asset) → auto-generated → STRIP.
  let assetFeedSpec: StrictModeSanitizationReport["assetFeedSpec"] = "absent";
  if ("asset_feed_spec" in bag && bag.asset_feed_spec) {
    const afs = bag.asset_feed_spec as {
      asset_customization_rules?: unknown;
      images?: unknown[];
      videos?: unknown[];
    };
    const rules = afs.asset_customization_rules;
    const hasRules = Array.isArray(rules) && rules.length > 0;
    const imageCount = Array.isArray(afs.images) ? afs.images.length : 0;
    const videoCount = Array.isArray(afs.videos) ? afs.videos.length : 0;
    const isDynamicRotation = imageCount >= 2 || videoCount >= 2;
    if (hasRules || isDynamicRotation) {
      assetFeedSpec = "preserved";
    } else {
      delete bag.asset_feed_spec;
      strippedTopLevel.push("asset_feed_spec");
      assetFeedSpec = "stripped";
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

  // Both existing-post branches (ig_existing_post and fb_existing_post) are
  // already-published content — degrees_of_freedom_spec is irrelevant and
  // Meta may reject enhancement opt-outs in that context.  Keep payloads
  // minimal: { name, source_instagram_media_id, instagram_user_id } for IG
  // and { name, object_story_id } for FB.
  const optedOutFeatures: string[] = [];
  if (payload.source_instagram_media_id || payload.object_story_id) {
    // Remove any stale degrees_of_freedom_spec that may have been set by a
    // previous pass or copied from a draft.
    delete (payload as unknown as Record<string, unknown>).degrees_of_freedom_spec;
    const branch = payload.source_instagram_media_id ? "ig_existing_post" : "fb_existing_post";
    console.log(
      `[sanitizeCreativeForStrictMode] ${branch} detected —` +
        ` degrees_of_freedom_spec OMITTED (not applicable for existing-post boost).` +
        ` Final payload keys: [${Object.keys(payload).join(", ")}]`,
    );
  } else {
    // Force every accepted feature key to OPT_OUT (strict allowlist only —
    // unknown keys cause (#100) rejections).
    const existing = payload.degrees_of_freedom_spec?.creative_features_spec ?? {};
    const merged: Record<string, CreativeFeatureOptOut> = { ...existing };
    for (const feature of STRICT_MODE_FEATURE_OPT_OUTS) {
      merged[feature] = { enroll_status: "OPT_OUT" };
      optedOutFeatures.push(feature);
    }
    payload.degrees_of_freedom_spec = { creative_features_spec: merged };
  }

  return {
    applied: true,
    strippedTopLevel,
    strippedLinkData,
    optedOutFeatures,
    assetFeedSpec,
  };
}
