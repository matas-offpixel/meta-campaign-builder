import type { AdCreativeDraft, AssetMode, AssetRatio } from "../types.ts";
import { getAspectRatioSlots } from "../meta/upload.ts";
import { sendsAtLaunch } from "../creatives/stored-at-launch.ts";

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
  opts: {
    /**
     * Count a slot whose file is in Storage and goes to Meta at Launch (M3a,
     * lib/creatives/stored-at-launch.ts) as filled. Review and the launch
     * checks pass it; the send step stamps the ids before the launch.
     */
    sendsAtLaunch?: boolean;
  } = {},
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
        .filter((a) => Boolean(a.videoId) || Boolean(a.assetHash) || (opts.sendsAtLaunch === true && sendsAtLaunch(a)))
        .map((a) => a.aspectRatio),
    );
    // Dual: the Feed slot is 4:5, or 1:1 (the multi-placement path takes either as Feed;
    // a connector pair can carry a 1:1 Feed file).
    if (creative.assetMode === "dual" && uploadedRatios.has("1:1")) uploadedRatios.add("4:5");

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
  return creatives.flatMap((c) => validateCreativeAssetCompleteness(c));
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
