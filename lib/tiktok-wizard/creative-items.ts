import { nameCreativeVariations } from "../tiktok/creative.ts";
import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export interface TikTokUploadedCreativeInput {
  videoId: string;
  thumbnailUrl: string | null;
  thumbnailExpiresAt?: string | null;
  durationSeconds: number | null;
  fileName: string;
}

export function appendUploadedTikTokCreatives(input: {
  existing: TikTokCreativeDraft[];
  uploads: TikTokUploadedCreativeInput[];
  baseName: string;
  adText: string;
  displayName: string;
  landingPageUrl: string;
  cta: string;
  newId?: () => string;
}): TikTokCreativeDraft[] {
  // Uploads ignore the Variations input — one file is one creative.
  // Number names across existing + this batch so 14 files become v1…v14,
  // not fourteen copies of "base · v1".
  const names = nameCreativeVariations(
    input.baseName,
    input.existing.length + input.uploads.length,
  );
  const next = [...input.existing];
  const newId = input.newId ?? (() => crypto.randomUUID());
  input.uploads.forEach((upload, index) => {
    const name =
      names[input.existing.length + index] ??
      `${input.baseName.trim() || "TikTok creative"} · v${input.existing.length + index + 1}`;
    next.push({
      id: newId(),
      name,
      baseName: input.baseName.trim() || "TikTok creative",
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
  });
  return next;
}
