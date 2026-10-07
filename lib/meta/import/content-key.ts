import { hasAppBuiltSpec, type ImportCreativeSource } from "./creative-copy.ts";

type Text = { text?: string };
type Cta = { type?: string; value?: { link?: string } };

/** The parts of a Meta AdCreative read the content key looks at. */
export type CreativeContentSpec = {
  image_hash?: string;
  video_id?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  source_instagram_media_id?: string;
  object_story_spec?: {
    page_id?: string;
    instagram_user_id?: string;
    link_data?: {
      name?: string;
      message?: string;
      description?: string;
      link?: string;
      image_hash?: string;
      call_to_action?: Cta;
      child_attachments?: { image_hash?: string }[];
    };
    video_data?: {
      title?: string;
      message?: string;
      video_id?: string;
      image_hash?: string;
      image_url?: string;
      call_to_action?: Cta;
    };
  };
  asset_feed_spec?: {
    images?: { hash?: string }[];
    videos?: { video_id?: string; thumbnail_hash?: string; thumbnail_url?: string }[];
    bodies?: Text[];
    titles?: Text[];
    descriptions?: Text[];
    link_urls?: { website_url?: string }[];
    call_to_action_types?: string[];
  };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function texts(rows: readonly Text[] | undefined): string[] {
  return sortedUnique((rows ?? []).map((row) => text(row?.text)));
}

function urlFile(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

/**
 * A video by the poster image it carries, then by id. Ads Manager gives every
 * duplicated ad its own copy of the video (a new `video_id`) but keeps the
 * poster file, so the id alone splits one creative into one row per ad.
 */
function videoIdentity(input: { videoId: string; posterHash: string; posterUrl: string }): string {
  if (input.posterHash) return `video:poster-hash:${input.posterHash}`;
  const file = urlFile(input.posterUrl);
  if (file) return `video:poster:${file}`;
  return input.videoId ? `video:id:${input.videoId}` : "";
}

function mediaIdentities(spec: CreativeContentSpec): string[] {
  const out: string[] = [];
  const link = spec.object_story_spec?.link_data;
  const video = spec.object_story_spec?.video_data;
  const feed = spec.asset_feed_spec;
  if (text(link?.image_hash)) out.push(`image:${text(link?.image_hash)}`);
  for (const child of link?.child_attachments ?? []) {
    if (text(child?.image_hash)) out.push(`image:${text(child.image_hash)}`);
  }
  if (video) {
    out.push(
      videoIdentity({
        videoId: text(video.video_id),
        posterHash: text(video.image_hash),
        posterUrl: text(video.image_url),
      }),
    );
  }
  for (const image of feed?.images ?? []) {
    if (text(image?.hash)) out.push(`image:${text(image.hash)}`);
  }
  for (const row of feed?.videos ?? []) {
    out.push(
      videoIdentity({
        videoId: text(row?.video_id),
        posterHash: text(row?.thumbnail_hash),
        posterUrl: text(row?.thumbnail_url),
      }),
    );
  }
  const media = sortedUnique(out);
  if (media.length > 0) return media;
  if (text(spec.video_id)) return [`video:id:${text(spec.video_id)}`];
  if (text(spec.image_hash)) return [`image:${text(spec.image_hash)}`];
  return [];
}

/**
 * What a Meta AdCreative shows, independent of the object Meta stored it in.
 * Two creatives with the same key are the same creative to an operator.
 *
 * An existing post is its story (`source_instagram_media_id`, then
 * `object_story_id`, then `effective_object_story_id`). Anything else is its
 * media plus copy, link, CTA and the page / Instagram account it runs as.
 * `null` when the read carries neither.
 */
export function creativeContentKey(spec: CreativeContentSpec): string | null {
  if (!hasAppBuiltSpec(spec as ImportCreativeSource)) {
    const post =
      text(spec.source_instagram_media_id) ||
      text(spec.object_story_id) ||
      text(spec.effective_object_story_id);
    if (post) return `post:${post}`;
  }
  const media = mediaIdentities(spec);
  if (media.length === 0) return null;
  const oss = spec.object_story_spec;
  const link = oss?.link_data;
  const video = oss?.video_data;
  const feed = spec.asset_feed_spec;
  const or = (primary: string[], fallback: string[]) =>
    primary.length > 0 ? primary : sortedUnique(fallback);
  return `content:${JSON.stringify({
    media,
    bodies: or(texts(feed?.bodies), [text(link?.message), text(video?.message)]),
    titles: or(texts(feed?.titles), [text(link?.name), text(video?.title)]),
    descriptions: or(texts(feed?.descriptions), [text(link?.description)]),
    links: or(
      sortedUnique((feed?.link_urls ?? []).map((row) => text(row?.website_url))),
      [text(link?.link), text(video?.call_to_action?.value?.link)],
    ),
    ctas: or(
      sortedUnique((feed?.call_to_action_types ?? []).map(text)),
      [text(link?.call_to_action?.type), text(video?.call_to_action?.type)],
    ),
    page: text(oss?.page_id),
    instagram: text(oss?.instagram_user_id),
  })}`;
}

/** Meta's auto-name for a creative object: `<post title> YYYY-MM-DD-<32 hex>`. */
export const META_AUTO_CREATIVE_NAME = /^(.+?)\s\d{4}-\d{2}-\d{2}-[0-9a-f]{32}$/;

export function isMetaAutoCreativeName(name: string): boolean {
  return META_AUTO_CREATIVE_NAME.test(name.trim());
}

/** The title Meta prefixed to its auto-name, or `null` when the name is not one. */
export function stripMetaAutoCreativeName(name: string): string | null {
  const match = META_AUTO_CREATIVE_NAME.exec(name.trim());
  return match ? match[1]!.trim() || null : null;
}
