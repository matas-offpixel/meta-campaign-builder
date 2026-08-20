import { nameCreativeVariations } from "../tiktok/creative.ts";
import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export interface TikTokUploadedCreativeInput {
  videoId: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  fileName: string;
}

export function appendUploadedTikTokCreatives(input: {
  existing: TikTokCreativeDraft[];
  uploads: TikTokUploadedCreativeInput[];
  baseName: string;
  variationCount: number;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string;
  newId?: () => string;
}): TikTokCreativeDraft[] {
  const count = Math.max(1, Math.min(10, input.variationCount));
  const next = [...input.existing];
  for (const upload of input.uploads) {
    const names = nameCreativeVariations(input.baseName, count);
    for (const name of names) {
      next.push({
        id: (input.newId ?? crypto.randomUUID)(),
        name,
        baseName: input.baseName.trim() || "TikTok creative",
        mode: "VIDEO_REFERENCE",
        videoId: upload.videoId,
        videoUrl: null,
        thumbnailUrl: upload.thumbnailUrl,
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
