import type { AdCreativeDraft } from "@/lib/types";

export interface LaunchValidationErrorBody {
  error?: string;
  details?: unknown;
}

/** Parse bulk-attach-ads 400 validation response. */
export function parseLaunchValidationResponse(data: unknown): {
  message: string;
  details: string[];
} {
  const body = (data ?? {}) as LaunchValidationErrorBody;
  const message =
    typeof body.error === "string" ? body.error : "Launch failed";
  const details = Array.isArray(body.details)
    ? body.details.filter((d): d is string => typeof d === "string" && d.length > 0)
    : [];
  return { message, details };
}

export interface CreativeLaunchReadiness {
  ready: boolean;
  pagesStillLoading: boolean;
  missingPageId: boolean;
  missingUploadedAsset: boolean;
}

/** Gate the Review step Launch button — does not mutate creatives. */
export function assessCreativeLaunchReadiness(
  creatives: AdCreativeDraft[],
  opts: { pagesLoading: boolean; pagesCount: number },
): CreativeLaunchReadiness {
  const pagesStillLoading = opts.pagesLoading && opts.pagesCount === 0;
  const missingPageId = creatives.some((c) => !c.identity?.pageId?.trim());
  const missingUploadedAsset = !creatives.every((c) =>
    c.assetVariations?.some((v) =>
      v.assets?.some((a) => a.uploadStatus === "uploaded"),
    ),
  );
  const ready =
    !pagesStillLoading && !missingPageId && !missingUploadedAsset;

  return { ready, pagesStillLoading, missingPageId, missingUploadedAsset };
}
