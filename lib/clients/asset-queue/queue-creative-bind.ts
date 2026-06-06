import {
  createDefaultAsset,
  createDefaultAssetVariation,
} from "@/lib/campaign-defaults";
import { getAspectRatioSlots } from "@/lib/meta/upload";
import type { AdCreativeDraft, Asset, AssetMode, AssetRatio } from "@/lib/types";

import type { DetectedAspect } from "./aspect-detect";

export const MAX_QUEUE_META_UPLOAD = 10;

export interface UploadedQueueAsset {
  fileName: string;
  aspect: DetectedAspect;
  mediaType: "image" | "video";
  url: string;
  previewUrl?: string;
  hash?: string;
  videoId?: string;
}

export function inferAssetModeFromAspects(aspects: Iterable<AssetRatio>): AssetMode {
  const set = new Set(aspects);
  const has45 = set.has("4:5");
  const has916 = set.has("9:16");
  const has11 = set.has("1:1");

  if (has45 && has916 && has11) return "full";
  if (has45 && has916) return "dual";
  if (has916) return "single";
  // Single mode only exposes 9:16 — use dual when only 4:5 assets exist.
  if (has45) return "dual";
  return "dual";
}

function assetFromUpload(
  aspect: AssetRatio,
  upload: UploadedQueueAsset,
): Asset {
  return {
    ...createDefaultAsset(aspect),
    uploadedUrl: upload.url,
    thumbnailUrl: upload.previewUrl ?? upload.url,
    assetHash: upload.hash,
    videoId: upload.videoId,
    uploadStatus: "uploaded",
  };
}

function emptySlot(aspect: AssetRatio): Asset {
  return createDefaultAsset(aspect);
}

/**
 * Bind auto-uploaded queue assets into the first creative's variations.
 */
export function applyUploadedAssetsToCreative(
  creative: AdCreativeDraft,
  uploads: UploadedQueueAsset[],
  preferredMediaType?: "image" | "video",
): { creative: AdCreativeDraft; skippedMediaType: number; skippedAspect: number } {
  const mediaType =
    preferredMediaType ??
    (uploads.filter((u) => u.mediaType === "video").length >=
    uploads.filter((u) => u.mediaType === "image").length
      ? "video"
      : "image");

  const eligible = uploads.filter((u) => u.mediaType === mediaType);
  const skippedMediaType = uploads.length - eligible.length;

  const standard = eligible.filter(
    (u): u is UploadedQueueAsset & { aspect: AssetRatio } => u.aspect !== "other",
  );
  const skippedAspect = eligible.length - standard.length;

  const aspectSet = new Set(standard.map((u) => u.aspect));
  const assetMode = inferAssetModeFromAspects(aspectSet);
  const ratios = getAspectRatioSlots(mediaType, assetMode);

  const byAspect = new Map<AssetRatio, UploadedQueueAsset[]>();
  for (const ratio of ratios) byAspect.set(ratio, []);
  for (const upload of standard) {
    if (byAspect.has(upload.aspect)) {
      byAspect.get(upload.aspect)!.push(upload);
    }
  }

  const variationCount = Math.max(
    1,
    ...ratios.map((r) => byAspect.get(r)?.length ?? 0),
  );

  const variations = Array.from({ length: variationCount }, (_, index) => {
    const variation = createDefaultAssetVariation(ratios);
    variation.name = `Variation ${index + 1}`;
    variation.assets = ratios.map((ratio) => {
      const pool = byAspect.get(ratio) ?? [];
      const upload = pool[index];
      return upload ? assetFromUpload(ratio, upload) : emptySlot(ratio);
    });
    return variation;
  });

  return {
    creative: {
      ...creative,
      mediaType,
      assetMode,
      assetVariations: variations,
    },
    skippedMediaType,
    skippedAspect,
  };
}

export function formatAutoUploadSummary(
  uploads: UploadedQueueAsset[],
  assetMode: AssetMode,
): string {
  const counts = new Map<string, number>();
  for (const u of uploads) {
    const key = `${u.aspect} ${u.mediaType}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([k, n]) => `${n} × ${k}`);
  const modeLabel =
    assetMode === "full"
      ? "Full"
      : assetMode === "dual"
        ? "Dual"
        : "Single";
  return `✓ Auto-uploaded ${uploads.length} assets · Detected: ${parts.join(", ")} → Mode: ${modeLabel}`;
}
