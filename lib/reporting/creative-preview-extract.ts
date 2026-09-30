import type { CreativePreview } from "@/lib/reporting/active-creatives-group";
import type { PreviewTier } from "@/lib/reporting/preview-tier";

/**
 * Raw creative document from Meta's `/{creative-id}` batch read.
 * Kept in this file (no `server-only`) so `extractPreview` is unit-
 * testable under `node --test` and importable without the Next shim.
 */
export interface RawCreative {
  id?: string;
  name?: string;
  title?: string;
  body?: string;
  thumbnail_url?: string;
  image_url?: string;
  image_hash?: string;
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
      child_attachments?: Array<{
        picture?: string;
        image_hash?: string;
      }>;
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
    videos?: Array<{
      video_id?: string;
      thumbnail_url?: string;
      url_tags?: string;
    }>;
    titles?: Array<{ text?: string }>;
    bodies?: Array<{ text?: string }>;
    descriptions?: Array<{ text?: string }>;
    call_to_action_types?: string[];
    link_urls?: Array<{ website_url?: string }>;
  };
}

export type { PreviewTier } from "@/lib/reporting/preview-tier";

/**
 * First value that contains a real character. Whitespace-only values —
 * the single space `blankAsNoScrape` sends — count as absent.
 * `nameFallback` is used only when every copy field was missing entirely.
 * An explicit blank must not be replaced by the creative's internal name.
 */
export function firstPresentCopy(
  values: ReadonlyArray<string | null | undefined>,
  nameFallback?: string | null,
): string | null {
  let sawBlank = false;
  for (const value of values) {
    if (value == null) continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
    sawBlank = true;
  }
  if (sawBlank) return null;
  const name = nameFallback?.trim();
  return name ? name : null;
}

/** Tiers that produce a low-resolution stand-in rather than a full-size asset. */
const LOW_RES_PREVIEW_TIERS: ReadonlySet<PreviewTier> = new Set([
  "top_thumbnail_url",
  "afs_video_thumb",
  "video_id_graph_fallback",
]);

/**
 * Build the modal preview payload from a raw Meta creative. Each
 * field falls through the same probe order as `extractCopy`
 * (object_story_spec → top-level), so the modal can render across
 * single-image, video, link, and Advantage+ creatives.
 *
 * **Waterfall order (PR #88):** After `link_data.picture`,
 * `video_data.image_url`, and top-level `image_url`, we probe
 * carousel cover + `asset_feed_spec` **before** Meta's top-level
 * `thumbnail_url` (typically 64×64). Promoting `asset_feed_spec
 * .images[0].url` (1080px+ marketer assets) above the tiny thumb
 * fixes blurry modal previews on Dynamic / Advantage+ creatives.
 */
export function extractPreview(
  creative: RawCreative | undefined,
): CreativePreview {
  if (!creative) {
    return {
      image_url: null,
      video_id: null,
      instagram_permalink_url: null,
      headline: null,
      body: null,
      call_to_action_type: null,
      link_url: null,
      tier: "none",
    };
  }
  const oss = creative.object_story_spec;
  const ld = oss?.link_data;
  const vd = oss?.video_data;
  const afs = creative.asset_feed_spec;
  const childAttachments = ld?.child_attachments;
  const childCover = childAttachments?.[0]?.picture?.trim() || null;
  const afsImage = afs?.images?.[0]?.url?.trim() || null;
  const afsVideoThumb = afs?.videos?.[0]?.thumbnail_url?.trim() || null;
  const video_id =
    vd?.video_id?.trim() ||
    creative.video_id?.trim() ||
    afs?.videos?.[0]?.video_id?.trim() ||
    null;
  const graphApiVersion = process.env.META_API_VERSION || "v21.0";
  const videoIdFallback = video_id
    ? `https://graph.facebook.com/${graphApiVersion}/${video_id}/picture?type=normal`
    : null;

  let image_url: string | null = null;
  let tier: PreviewTier = "none";
  const set = (v: string | null | undefined, t: PreviewTier) => {
    if (!image_url && v?.trim()) {
      image_url = v.trim();
      tier = t;
    }
  };
  set(ld?.picture, "link_data_picture");
  set(vd?.image_url, "video_data_image_url");
  set(creative.image_url, "top_image_url");
  // Carousel + Advantage+ before Meta's 64×64 `thumbnail_url` — that
  // top-level field wins too early and blurs modals (PR #88).
  set(childCover, "child_attachment_cover");
  set(afsImage, "afs_image_url");
  set(afsVideoThumb, "afs_video_thumb");
  set(creative.thumbnail_url, "top_thumbnail_url");
  set(videoIdFallback, "video_id_graph_fallback");

  const instagram_permalink_url =
    creative.instagram_permalink_url?.trim() || null;
  // A single space is the launcher's "blank" sentinel (blankAsNoScrape). It
  // must not surface as headline copy, and it must not fall through to the
  // creative's internal name — that name is what clients were seeing.
  const headline = firstPresentCopy(
    [
      afs?.titles?.[0]?.text,
      ld?.name,
      vd?.title,
      creative.title,
    ],
    creative.name,
  );
  const body =
    ld?.message?.trim() ||
    creative.body?.trim() ||
    null;
  const call_to_action_type =
    ld?.call_to_action?.type?.trim() ||
    creative.call_to_action_type?.trim() ||
    null;
  const link_url = ld?.link?.trim() || creative.link_url?.trim() || null;
  const is_low_res_fallback = LOW_RES_PREVIEW_TIERS.has(tier);
  return {
    image_url,
    video_id,
    instagram_permalink_url,
    headline,
    body,
    call_to_action_type,
    link_url,
    tier,
    is_low_res_fallback,
  };
}
