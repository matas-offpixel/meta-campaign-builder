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
    videos?: {
      video_id?: string;
      thumbnail_hash?: string;
      thumbnail_url?: string;
      adlabels?: { name?: string }[];
    }[];
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

type VideoEntry = { videoId: string; hash: string; posterUrl: string; role: string };

/**
 * One video, in order of trust:
 *
 * 1. A poster image hash (`video_data.image_hash`, `asset_feed_spec.videos[].thumbnail_hash`).
 * 2. The poster file in the URL plus its placement slot (feed / story). The slot
 *    matters: one DHB poster file is the feed video of one creative and the
 *    story video of another.
 * 3. The video id.
 *
 * `video_id` is last because Ads Manager gives every duplicated ad its own
 * copy of the video.
 */
function videoIdentity(entry: VideoEntry): string {
  if (entry.hash) return `video:hash:${entry.hash}${entry.role ? `@${entry.role}` : ""}`;
  const file = urlFile(entry.posterUrl);
  if (file) return `video:poster:${file}@${entry.role || "any"}`;
  return entry.videoId ? `video:id:${entry.videoId}` : "";
}

function role(labels: readonly { name?: string }[] | undefined): string {
  return sortedUnique((labels ?? []).map((label) => text(label?.name))).join("+");
}

function videoEntries(spec: CreativeContentSpec): VideoEntry[] {
  const out: VideoEntry[] = [];
  const video = spec.object_story_spec?.video_data;
  if (video) {
    out.push({
      videoId: text(video.video_id),
      hash: text(video.image_hash),
      posterUrl: text(video.image_url),
      role: "",
    });
  }
  for (const row of spec.asset_feed_spec?.videos ?? []) {
    out.push({
      videoId: text(row?.video_id),
      hash: text(row?.thumbnail_hash),
      posterUrl: text(row?.thumbnail_url),
      role: role(row?.adlabels),
    });
  }
  return out;
}

function mediaIdentities(spec: CreativeContentSpec, nameStem: string): string[] {
  const out: string[] = [];
  const link = spec.object_story_spec?.link_data;
  if (text(link?.image_hash)) out.push(`image:${text(link?.image_hash)}`);
  for (const child of link?.child_attachments ?? []) {
    if (text(child?.image_hash)) out.push(`image:${text(child.image_hash)}`);
  }
  for (const image of spec.asset_feed_spec?.images ?? []) {
    if (text(image?.hash)) out.push(`image:${text(image.hash)}`);
  }
  const videos = videoEntries(spec);
  if (videos.length > 0 && nameStem && videos.every((entry) => !entry.hash)) {
    // No poster hash: the ad name stem, with copy and account, is the identity.
    out.push(`video:stem:${nameStem}`);
  } else {
    out.push(...videos.map(videoIdentity));
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
 *
 * Images are their hashes. A video with a poster hash is that hash. A video
 * without one is keyed by `nameStem` (`adNameStem` of its ads) when the
 * caller passes it, otherwise by poster file and placement slot. Ads Manager
 * copies change both `video_id` and the poster file but keep the ad name, so
 * the stem is what joins an original to its copies.
 *
 * Residual risk, video without a poster hash:
 * - With a stem: two different videos under the same ad name, copy and
 *   account are one creative. The stem also replaces every video entry with
 *   one token, so a single-video object and a feed+story object with the
 *   same stem, copy and account merge.
 * - Without a stem: two different videos given the same poster image (an
 *   operator's preferred-frame override) in the same slot, with the same copy
 *   and account, are one creative; and copies whose poster file changed stay
 *   separate.
 */
export function creativeContentKey(
  spec: CreativeContentSpec,
  options: { nameStem?: string | null } = {},
): string | null {
  if (!hasAppBuiltSpec(spec as ImportCreativeSource)) {
    const post =
      text(spec.source_instagram_media_id) ||
      text(spec.object_story_id) ||
      text(spec.effective_object_story_id);
    if (post) return `post:${post}`;
  }
  const media = mediaIdentities(spec, text(options.nameStem));
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

/** Our launcher's ad name suffix for an attached ad set: ` — attached:<ad set id>`. */
const ATTACHED_SUFFIX = /^attached:\d+$/;
const SUFFIX = /^(.*\S)\s+—\s+(.+)$/;
const COPY_SUFFIX = /\s+[–-]\s+Copy(?:\s+\d+)?$/i;

function collapseSpaces(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function isAdSetSuffix(tail: string, adSetNames: ReadonlySet<string>): boolean {
  return ATTACHED_SUFFIX.test(tail) || adSetNames.has(tail) || adSetNames.has(collapseSpaces(tail));
}

/**
 * The ad name without the ` — <ad set>` suffix our launcher adds per ad set
 * (an ad set name in this campaign, or `attached:<id>`). Other ` — ` text stays.
 * An Ads Manager ` – Copy N` after the suffix is kept: `X — Wide – Copy` → `X – Copy`.
 */
export function adNameWithoutAdSetSuffix(name: string, adSetNames: ReadonlySet<string>): string {
  const match = SUFFIX.exec(name.trim());
  if (match) {
    const tail = match[2]!.trim();
    if (isAdSetSuffix(tail, adSetNames)) return collapseSpaces(match[1]!);
    const copy = COPY_SUFFIX.exec(tail);
    if (copy && isAdSetSuffix(tail.slice(0, copy.index).trim(), adSetNames)) {
      return collapseSpaces(`${match[1]!}${copy[0]}`);
    }
  }
  return collapseSpaces(name);
}

/** The name an original and its Ads Manager copies share: no ad set suffix, no ` – Copy N`. */
export function adNameStem(name: string, adSetNames: ReadonlySet<string>): string {
  let stem = adNameWithoutAdSetSuffix(name, adSetNames);
  while (COPY_SUFFIX.test(stem)) stem = stem.replace(COPY_SUFFIX, "");
  return stem.trim();
}
