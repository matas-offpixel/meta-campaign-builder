import {
  capCreativeName,
  creativeNameFromFilename,
  isExplicitTikTokBaseName,
  TIKTOK_CREATIVE_DEFAULT_NAME,
  withCreativeVariationSuffix,
} from "../creative-name-from-filename.ts";
import type { TikTokSparkPost } from "../tiktok/spark-posts.ts";
import { defaultTikTokSparkPosterExpiry } from "../tiktok/video-preview.ts";
import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export interface TikTokUploadedCreativeInput {
  videoId: string;
  thumbnailUrl: string | null;
  thumbnailExpiresAt?: string | null;
  coverImageId?: string | null;
  durationSeconds: number | null;
  fileName: string;
}

export function clampTikTokVariationCount(raw: string | number): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  return Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed : 1));
}

/**
 * One base per upload. `variationCount` is how many creatives that upload
 * becomes.
 *
 * `numberSingles` (an operator-typed base) keeps the historical shape: every
 * creative is `base · vN`, including a batch of one. Filename bases leave a
 * single creative as the bare stem so it matches the plan canvas, and only
 * a multi-variation upload adds ` · vN`.
 *
 * Names already in `existingNames`, including a bare stem, are skipped, so
 * two files with the same stem stay distinct when the base varies per file.
 */
export function nextTikTokCreativeNames(
  bases: readonly string[],
  existingNames: readonly string[],
  variationCount: number,
  numberSingles = false,
): string[] {
  const count = clampTikTokVariationCount(variationCount);
  const taken = new Set(existingNames);
  const names: string[] = [];
  for (const base of bases) {
    const allocated = allocateTikTokCreativeNames(base, count, taken, numberSingles);
    for (const name of allocated) {
      taken.add(name);
      names.push(name);
    }
  }
  return names;
}

function allocateTikTokCreativeNames(
  base: string,
  count: number,
  taken: Set<string>,
  numberSingles: boolean,
): string[] {
  if (!numberSingles && count === 1) {
    if (!taken.has(base)) return [base];
    let n = 2;
    while (taken.has(withCreativeVariationSuffix(base, n))) n += 1;
    return [withCreativeVariationSuffix(base, n)];
  }
  const out: string[] = [];
  let n = 1;
  while (out.length < count) {
    const candidate = withCreativeVariationSuffix(base, n);
    n += 1;
    if (!taken.has(candidate)) out.push(candidate);
  }
  return out;
}

function uploadBases(baseName: string, fileNames: readonly string[]): {
  bases: string[];
  explicit: boolean;
} {
  const explicit = isExplicitTikTokBaseName(baseName);
  if (explicit) {
    const base = capCreativeName(baseName.trim());
    return { explicit: true, bases: fileNames.map(() => base) };
  }
  return {
    explicit: false,
    bases: fileNames.map((fileName) =>
      creativeNameFromFilename(fileName, TIKTOK_CREATIVE_DEFAULT_NAME),
    ),
  };
}

export function appendUploadedTikTokCreatives(input: {
  existing: TikTokCreativeDraft[];
  uploads: TikTokUploadedCreativeInput[];
  baseName: string;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string;
  variationCount?: string | number;
  newId?: () => string;
}): TikTokCreativeDraft[] {
  const count = clampTikTokVariationCount(input.variationCount ?? 1);
  const next = [...input.existing];
  const newId = input.newId ?? (() => crypto.randomUUID());
  const { bases, explicit } = uploadBases(
    input.baseName,
    input.uploads.map((upload) => upload.fileName),
  );
  const names = nextTikTokCreativeNames(
    bases,
    input.existing.map((item) => item.name),
    count,
    explicit,
  );
  let nameIndex = 0;
  input.uploads.forEach((upload, uploadIndex) => {
    const resolvedBase = bases[uploadIndex] ?? TIKTOK_CREATIVE_DEFAULT_NAME;
    for (let variation = 0; variation < count; variation += 1) {
      const name = names[nameIndex] ?? withCreativeVariationSuffix(resolvedBase, nameIndex + 1);
      nameIndex += 1;
      next.push({
        id: newId(),
        name,
        baseName: resolvedBase,
        mode: "VIDEO_REFERENCE",
        videoId: upload.videoId,
        videoUrl: null,
        thumbnailUrl: upload.thumbnailUrl,
        thumbnailExpiresAt: upload.thumbnailExpiresAt ?? null,
        coverImageId: upload.coverImageId ?? null,
        durationSeconds: upload.durationSeconds,
        title: upload.fileName,
        sparkPostId: null,
        caption: input.adText,
        adText: input.adText,
        displayName: input.displayName,
        landingPageUrl: input.landingPageUrl,
        cta: input.cta,
        musicId: null,
      });
    }
  });
  return next;
}

export function appendSparkTikTokCreatives(input: {
  existing: TikTokCreativeDraft[];
  posts: TikTokSparkPost[];
  baseName: string;
  adText: string;
  landingPageUrl: string;
  cta: string;
  now?: number;
  newId?: () => string;
}): TikTokCreativeDraft[] {
  const next = [...input.existing];
  const newId = input.newId ?? (() => crypto.randomUUID());
  const resolvedBase = capCreativeName(input.baseName.trim() || TIKTOK_CREATIVE_DEFAULT_NAME);
  const names = nextTikTokCreativeNames(
    input.posts.map(() => resolvedBase),
    input.existing.map((item) => item.name),
    1,
    true,
  );
  const now = input.now ?? Date.now();
  input.posts.forEach((post, index) => {
    const name = names[index] ?? withCreativeVariationSuffix(resolvedBase, index + 1);
    next.push({
      id: newId(),
      name,
      baseName: resolvedBase,
      mode: "SPARK_AD",
      videoId: null,
      videoUrl: null,
      thumbnailUrl: post.poster_url,
      thumbnailExpiresAt: defaultTikTokSparkPosterExpiry(now),
      durationSeconds: post.duration_seconds,
      title: post.text,
      sparkPostId: post.item_id,
      identityId: post.identity_id,
      identityType: post.identity_type,
      identityDisplayName: post.identity_display_name,
      caption: input.adText,
      adText: input.adText,
      displayName: post.identity_display_name ?? "",
      landingPageUrl: input.landingPageUrl,
      cta: input.cta,
      musicId: null,
    });
  });
  return next;
}
