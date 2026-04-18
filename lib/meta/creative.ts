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
 * Pick the ads-compatible Instagram actor id for `instagram_actor_id` in
 * creative payloads, with source logging.
 *
 * Resolution order:
 *   1. `identity.instagramActorId`  — from `GET /{page-id}/instagram_accounts`
 *      (the ads-API-verified actor id).  Preferred.
 *   2. `identity.instagramAccountId` — from `instagram_business_account.id`
 *      on the Page (content API).  Falls back when the actor id is absent
 *      (e.g. older drafts or when the page token was unavailable at identity
 *      resolution time).
 *   3. `undefined`                  — no IG identity found.  `instagram_actor_id`
 *      is omitted from the payload; Meta may still run the ad Page-only.
 *
 * The source is returned alongside the id so callers can log it.
 */
function resolveIgActorForPayload(
  creativeName: string,
  identity: { instagramAccountId?: string; instagramActorId?: string },
  context: string,
): { id: string; source: "actor_id" | "content_id" | "none" } {
  if (identity.instagramActorId) {
    console.log(
      `[${context}] "${creativeName}": instagram_actor_id=${identity.instagramActorId}` +
        ` source=actor_id (ads-verified from /{page}/instagram_accounts)`,
    );
    return { id: identity.instagramActorId, source: "actor_id" };
  }
  if (identity.instagramAccountId) {
    console.warn(
      `[${context}] "${creativeName}": instagramActorId not set;` +
        ` falling back to content id ${identity.instagramAccountId}` +
        ` (source=instagram_business_account). If Meta rejects with #100,` +
        ` refresh the page selection so page-identity can resolve the actor id.`,
    );
    return { id: identity.instagramAccountId, source: "content_id" };
  }
  console.warn(`[${context}] "${creativeName}": no IG identity — omitting instagram_actor_id`);
  return { id: "", source: "none" };
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
   * Used for existing **Instagram** post boosts. Pass the IG media id
   * together with {@link instagram_user_id} (the IG account that owns the
   * media — the content account, NOT the ad-account actor).
   *
   * Correct payload shape (Meta Marketing API):
   *   { name, source_instagram_media_id, instagram_user_id }
   *   — do NOT combine with instagram_actor_id or object_story_spec.
   */
  source_instagram_media_id?: string;
  /**
   * IG business/creator account id that owns the `source_instagram_media_id`
   * post. This is the **content account id** (`instagram_business_account.id`
   * from the Page), NOT the ad-account actor id.
   *
   * Used ONLY with `source_instagram_media_id`. Do NOT send alongside
   * `instagram_actor_id` — they are mutually exclusive for this creative type.
   */
  instagram_user_id?: string;
  /**
   * @deprecated  Use `instagram_user_id` for `source_instagram_media_id` posts.
   * Still present for `object_story_spec`-based new-ad creatives where
   * `spec.instagram_actor_id` is set instead.
   */
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
  const igActor = resolveIgActorForPayload(creative.name, creative.identity, "buildLinkCreative");
  if (igActor.source !== "none") {
    spec.instagram_actor_id = igActor.id;
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
  const igActor = resolveIgActorForPayload(creative.name, creative.identity, "buildVideoCreative");
  if (igActor.source !== "none") {
    spec.instagram_actor_id = igActor.id;
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

  // For source_instagram_media_id (ig_existing_post) the creative is already
  // published — degrees_of_freedom_spec is irrelevant and Meta may reject
  // unknown keys in that context.  Keep the payload minimal.
  const optedOutFeatures: string[] = [];
  if (payload.source_instagram_media_id) {
    // Remove any stale degrees_of_freedom_spec that may have been set by a
    // previous pass or copied from a draft.
    delete (payload as unknown as Record<string, unknown>).degrees_of_freedom_spec;
    console.log(
      `[sanitizeCreativeForStrictMode] source_instagram_media_id detected —` +
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
  };
}
