import type { Asset, AssetMode, AssetRatio, CTAType } from "../../types.ts";
import type { MetaImportDropped } from "./types.ts";

/** Inverse of `CTA_MAP` in `lib/meta/creative.ts`. Unmapped values are not defaulted. */
export const CTA_FROM_META: Record<string, CTAType> = {
  SIGN_UP: "sign_up",
  LEARN_MORE: "learn_more",
  BOOK_NOW: "book_now",
  BUY_TICKETS: "buy_tickets",
};

/** Labels `buildMultiPlacementCreative` writes on `asset_customization_rules`. */
const FEED_LABEL = "feed_asset";
const STORY_LABEL = "story_asset";

export const IMPORTED_HEADLINE_ABSENT =
  "No headline was on this creative in Meta.";

export type ImportedCopyDrop = Pick<MetaImportDropped, "field" | "value">;

export type ImportedCreativeCopy = {
  captions: string[];
  headline: string;
  description: string;
  destinationUrl: string;
  cta: CTAType | "";
  headlineAbsent: boolean;
  dropped: ImportedCopyDrop[];
};

type TextRow = { text?: string };
type LinkRow = { website_url?: string };
type Label = { name?: string };
type FeedImage = { hash?: string; adlabels?: Label[] };
type FeedVideo = { video_id?: string; thumbnail_url?: string; adlabels?: Label[] };
type Cta = { type?: string; value?: { link?: string } };
type LinkData = {
  name?: string;
  message?: string;
  description?: string;
  link?: string;
  image_hash?: string;
  call_to_action?: Cta;
};
type VideoData = {
  title?: string;
  message?: string;
  video_id?: string;
  call_to_action?: Cta;
};
type Feed = {
  bodies?: TextRow[];
  titles?: TextRow[];
  descriptions?: TextRow[];
  link_urls?: LinkRow[];
  call_to_action_types?: string[];
  images?: FeedImage[];
  videos?: FeedVideo[];
  asset_customization_rules?: unknown[];
  additional_data?: unknown;
};

export type ImportCreativeSource = {
  name?: string;
  image_hash?: string;
  video_id?: string;
  body?: string;
  title?: string;
  link_url?: string;
  call_to_action_type?: string;
  object_story_id?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  object_story_spec?: {
    page_id?: string;
    instagram_user_id?: string;
    link_data?: LinkData;
    video_data?: VideoData;
  };
  asset_feed_spec?: Feed;
};

export type ImportedExistingPost = {
  source: "facebook" | "instagram";
  postId: string;
  pageId: string;
  instagramAccountId?: string;
};

function storyText(value: string | undefined): string {
  return value?.trim() ?? "";
}

/** App-built creatives keep `sourceType: "new"` even when Meta also returns a story id. */
function hasAppBuiltSpec(creative: ImportCreativeSource): boolean {
  const feed = creative.asset_feed_spec;
  if (
    feed &&
    (feed.bodies ||
      feed.titles ||
      feed.descriptions ||
      feed.link_urls ||
      feed.images ||
      feed.videos)
  ) {
    return true;
  }
  const oss = creative.object_story_spec;
  return Boolean(oss?.link_data || oss?.video_data);
}

/**
 * A boosted post has `object_story_id` or `effective_object_story_id` and no
 * app-built spec. Instagram only when `instagram_user_id` is set and the
 * story id is a bare media id. A `{page}_{post}` id is the Facebook story
 * Meta already uses to relaunch — SCHAK's boosted posts have that shape on
 * `effective_object_story_id` and no `instagram_user_id`.
 * `null` means this is not an existing post. `{ unreachable: true }` means
 * the id is present but cannot be launched.
 */
export function classifyImportedExistingPost(
  creative: ImportCreativeSource,
): ImportedExistingPost | { unreachable: true } | null {
  if (hasAppBuiltSpec(creative)) return null;
  const permalink = storyText(creative.instagram_permalink_url);
  const igUser = storyText(creative.object_story_spec?.instagram_user_id);
  if (!permalink && !igUser) return null;
  const explicit = storyText(creative.object_story_id);
  const effective = storyText(creative.effective_object_story_id);
  const storyId = explicit || effective;
  if (!storyId) return null;

  const bare = !storyId.includes("_");
  if (igUser && bare) {
    return {
      source: "instagram",
      postId: storyId,
      pageId: storyText(creative.object_story_spec?.page_id),
      instagramAccountId: igUser,
    };
  }
  const pagePost = explicit.includes("_") ? explicit : effective.includes("_") ? effective : "";
  if (pagePost) {
    return {
      source: "facebook",
      postId: pagePost,
      pageId: pagePost.slice(0, pagePost.indexOf("_")),
    };
  }
  return { unreachable: true };
}

function texts(rows: TextRow[] | undefined): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const text = row?.text?.trim();
    return text ? [text] : [];
  });
}

function first(values: string[]): string {
  return values[0] ?? "";
}

/**
 * Copy for an imported creative. `asset_feed_spec` first — that is what
 * this app writes — then `object_story_spec`. Never the creative's name.
 */
export function extractImportedCreativeCopy(creative: ImportCreativeSource): ImportedCreativeCopy {
  const dropped: ImportedCopyDrop[] = [];
  const feed = creative.asset_feed_spec;
  const link = creative.object_story_spec?.link_data;
  const video = creative.object_story_spec?.video_data;

  const bodies = texts(feed?.bodies);
  const captions = bodies.length > 0 ? bodies : texts([
    { text: link?.message },
    { text: video?.message },
  ]).slice(0, 1);

  const titles = texts(feed?.titles);
  const headline = first(titles) || link?.name?.trim() || video?.title?.trim() || "";
  for (const extra of titles.slice(1)) dropped.push({ field: "titles", value: extra });

  const descriptions = texts(feed?.descriptions);
  const description = first(descriptions) || link?.description?.trim() || "";
  for (const extra of descriptions.slice(1)) dropped.push({ field: "descriptions", value: extra });

  const urls = (feed?.link_urls ?? []).flatMap((row) => {
    const url = row?.website_url?.trim();
    return url ? [url] : [];
  });
  const destinationUrl =
    first(urls) ||
    link?.link?.trim() ||
    link?.call_to_action?.value?.link?.trim() ||
    video?.call_to_action?.value?.link?.trim() ||
    "";
  for (const extra of urls.slice(1)) dropped.push({ field: "link_urls", value: extra });

  const ctaValues = [
    ...(feed?.call_to_action_types ?? []),
    link?.call_to_action?.type,
    video?.call_to_action?.type,
  ].flatMap((value) => {
    const trimmed = value?.trim();
    return trimmed ? [trimmed.toUpperCase()] : [];
  });
  const seen = new Set<string>();
  const uniqueCtas = ctaValues.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
  const chosen = uniqueCtas.find((value) => CTA_FROM_META[value]);
  const mapped = chosen ? CTA_FROM_META[chosen]! : "";
  for (const value of uniqueCtas) {
    if (value !== chosen) dropped.push({ field: "call_to_action_type", value });
  }

  const additional = feed?.additional_data;
  if (additional && typeof additional === "object" && Object.values(additional as Record<string, unknown>).some(Boolean)) {
    dropped.push({ field: "additional_data", value: additional });
  }

  return {
    captions,
    headline,
    description,
    destinationUrl,
    cta: mapped,
    headlineAbsent: headline.length === 0,
    dropped,
  };
}

export function importedHeadlineNote(
  creative: { id: string; headline: string },
  notes: readonly { creativeId: string }[] | undefined,
): string | null {
  if (creative.headline.trim()) return null;
  if (!notes?.some((note) => note.creativeId === creative.id)) return null;
  return IMPORTED_HEADLINE_ABSENT;
}

type Sized = { width: number; height: number };

/** A measured size that sits on one of the three ratios the draft can store. */
export function aspectRatioFromSize(width: number, height: number): AssetRatio | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const ratio = width / height;
  const slots: { ratio: AssetRatio; value: number }[] = [
    { ratio: "1:1", value: 1 },
    { ratio: "4:5", value: 4 / 5 },
    { ratio: "9:16", value: 9 / 16 },
  ];
  let best: { ratio: AssetRatio; error: number } | null = null;
  for (const slot of slots) {
    const error = Math.abs(ratio - slot.value) / slot.value;
    if (!best || error < best.error) best = { ratio: slot.ratio, error };
  }
  if (!best || best.error > 0.08) return null;
  return best.ratio;
}

function labelNames(labels: Label[] | undefined): string[] {
  return (labels ?? []).flatMap((label) => (label?.name ? [label.name] : []));
}

function ratioForLabels(labels: string[]): AssetRatio | null {
  if (labels.includes(STORY_LABEL)) return "9:16";
  if (labels.includes(FEED_LABEL)) return "4:5";
  return null;
}

export type ImportedCreativeAssets = {
  mediaType: "image" | "video";
  assetMode: AssetMode;
  assets: Asset[];
  /** No placement label and no measured size. Stays Single. */
  aspectUnrecorded: boolean;
};

/**
 * Feed and Story labels from `asset_customization_rules` decide the
 * ratio. No labels and no measured size stays Single — never Full.
 */
export function assetsFromCreative(
  creative: ImportCreativeSource,
  imageSizes: Readonly<Record<string, Sized>> = {},
): ImportedCreativeAssets | null {
  const feed = creative.asset_feed_spec;
  const labeled: { kind: "image" | "video"; key: string; labels: string[]; thumbnailUrl?: string }[] = [];
  for (const image of feed?.images ?? []) {
    const hash = image?.hash?.trim();
    if (!hash) continue;
    labeled.push({ kind: "image", key: hash, labels: labelNames(image.adlabels) });
  }
  for (const video of feed?.videos ?? []) {
    const id = video?.video_id?.trim();
    if (!id) continue;
    labeled.push({
      kind: "video",
      key: id,
      labels: labelNames(video.adlabels),
      thumbnailUrl: video.thumbnail_url?.trim() || undefined,
    });
  }
  if (labeled.length === 0) {
    const hash = creative.object_story_spec?.link_data?.image_hash?.trim() || creative.image_hash?.trim();
    const videoId = creative.object_story_spec?.video_data?.video_id?.trim() || creative.video_id?.trim();
    if (hash) labeled.push({ kind: "image", key: hash, labels: [] });
    else if (videoId) labeled.push({ kind: "video", key: videoId, labels: [] });
    else return null;
  }

  const hasFeed = labeled.some((asset) => asset.labels.includes(FEED_LABEL));
  const hasStory = labeled.some((asset) => asset.labels.includes(STORY_LABEL));
  const assetMode: AssetMode = hasFeed && hasStory ? "dual" : "single";
  let aspectUnrecorded = false;
  const assets: Asset[] = labeled.map((asset) => {
    let aspectRatio = ratioForLabels(asset.labels);
    if (!aspectRatio && asset.kind === "image") {
      const size = imageSizes[asset.key];
      if (size) aspectRatio = aspectRatioFromSize(size.width, size.height);
    }
    if (!aspectRatio) {
      aspectUnrecorded = true;
      aspectRatio = "1:1";
    }
    return {
      id: `asset:${asset.key}`,
      aspectRatio,
      ...(asset.kind === "image" ? { assetHash: asset.key } : { videoId: asset.key }),
      ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
      uploadStatus: "uploaded" as const,
    };
  });
  assets.sort((a, b) => {
    const order = (ratio: AssetRatio) => (ratio === "4:5" ? 0 : ratio === "9:16" ? 1 : 2);
    return order(a.aspectRatio) - order(b.aspectRatio);
  });
  const mediaType = assets.some((asset) => asset.videoId) && !assets.some((asset) => asset.assetHash)
    ? "video"
    : assets.some((asset) => asset.assetHash) && !assets.some((asset) => asset.videoId)
      ? "image"
      : assets[0]?.videoId
        ? "video"
        : "image";
  return { mediaType, assetMode, assets, aspectUnrecorded: aspectUnrecorded && assetMode === "single" };
}

/** Image hashes with no placement label. One `/adimages` read can size them. */
export function unlabeledImageHashes(creatives: readonly ImportCreativeSource[]): string[] {
  const hashes = new Set<string>();
  for (const creative of creatives) {
    const built = assetsFromCreative(creative);
    if (!built) continue;
    for (const asset of built.assets) {
      if (asset.assetHash && asset.aspectRatio === "1:1" && built.aspectUnrecorded) hashes.add(asset.assetHash);
    }
  }
  return [...hashes];
}
