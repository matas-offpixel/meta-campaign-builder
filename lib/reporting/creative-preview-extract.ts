import type { CreativePreview } from "@/lib/reporting/active-creatives-group";

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
    call_to_action_types?: string[];
    link_urls?: Array<{ website_url?: string }>;
  };
}

/**
 * Internal tag identifying which tier of `extractPreview`'s waterfall
 * resolved `image_url`.
 */
export type PreviewTier =
  | "link_data_picture"
  | "video_data_image_url"
  | "top_image_url"
  | "top_thumbnail_url"
  | "child_attachment_cover"
  | "afs_image_url"
  | "afs_video_thumb"
  | "video_id_graph_fallback"
  | "none";

/**
 * Subset of {@link PreviewTier} that produces a low-resolution
 * stand-in rather than a full-size marketer asset.
 */
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
): CreativePreview & { tier: PreviewTier } {
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
