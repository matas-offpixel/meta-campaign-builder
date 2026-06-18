import type { AdCreativeDraft, AssetMode, AssetRatio } from "../types.ts";
import { getAspectRatioSlots } from "../meta/upload.ts";

export interface AssetCompletenessIssue {
  creativeId: string;
  creativeName: string;
  assetMode: AssetMode;
  variationName: string;
  missingRatios: AssetRatio[];
}

/**
 * Per-variation check: every required aspect ratio must have an asset with a
 * Meta asset ID (assetHash for images, videoId for videos), indicating that the
 * upload completed and the ID was echoed back from the Meta API.
 *
 * Returns an empty array when the creative is complete OR when
 * assetMode === "single" (operator explicitly opted into one aspect ratio).
 */
export function validateCreativeAssetCompleteness(
  creative: AdCreativeDraft,
): AssetCompletenessIssue[] {
  if (creative.assetMode === "single") return [];

  const requiredRatios = getAspectRatioSlots(
    creative.mediaType ?? "image",
    creative.assetMode,
  );

  const issues: AssetCompletenessIssue[] = [];

  for (const variation of creative.assetVariations ?? []) {
    const uploadedRatios = new Set(
      variation.assets
        .filter((a) => Boolean(a.videoId) || Boolean(a.assetHash))
        .map((a) => a.aspectRatio),
    );

    const missingRatios = requiredRatios.filter((r) => !uploadedRatios.has(r));

    if (missingRatios.length > 0) {
      issues.push({
        creativeId: creative.id,
        creativeName: creative.name || "Untitled creative",
        assetMode: creative.assetMode,
        variationName: variation.name || "Variation",
        missingRatios,
      });
    }
  }

  return issues;
}

/**
 * Across all creatives. Used by launch gates and the review step.
 */
export function validateAllCreativesAssetCompleteness(
  creatives: AdCreativeDraft[],
): AssetCompletenessIssue[] {
  return creatives.flatMap(validateCreativeAssetCompleteness);
}

/**
 * Format issues for display in a launch-error banner.
 */
export function formatAssetCompletenessIssues(
  issues: AssetCompletenessIssue[],
): string {
  if (issues.length === 0) return "";
  const lines = issues.map(
    (i) =>
      `- "${i.creativeName}" (${i.assetMode} mode) ${i.variationName}: missing ${i.missingRatios.join(", ")}`,
  );
  return (
    `Cannot launch — asset variations incomplete:\n${lines.join("\n")}\n\n` +
    `Upload the missing aspects or switch the affected creative(s) to Single mode.`
  );
}
