import { nameCreativeVariations } from "../tiktok/creative.ts";
import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export interface TikTokUploadedCreativeInput {
  videoId: string;
  thumbnailUrl: string | null;
  thumbnailExpiresAt?: string | null;
  durationSeconds: number | null;
  fileName: string;
}

export function clampTikTokVariationCount(raw: string | number): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw, 10);
  return Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed : 1));
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
  const resolvedBase = input.baseName.trim() || "TikTok creative";
  for (const upload of input.uploads) {
    const names = nameCreativeVariations(resolvedBase, count);
    for (const name of names) {
      next.push({
        id: newId(),
        name,
        baseName: resolvedBase,
        mode: "VIDEO_REFERENCE",
        videoId: upload.videoId,
        videoUrl: null,
        thumbnailUrl: upload.thumbnailUrl,
        thumbnailExpiresAt: upload.thumbnailExpiresAt ?? null,
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
  }
  return next;
}
