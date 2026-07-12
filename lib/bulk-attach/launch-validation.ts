import type { AdCreativeDraft } from "@/lib/types";
import type { AdSetGuardInfo } from "@/lib/meta/client";

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

// ─── Relaunch guard ("Launch another variation to these ad sets") ─────────
//
// Meta allows only ONE ad on an ad set that has gone Dynamic Creative
// (is_dynamic_creative:true) — see PR #666 / lib/meta/creative.ts
// creativeTriggersVariationRotation + the create-time equivalent guard in
// app/api/meta/launch-campaign/route.ts. Bulk-attach never creates ad sets,
// so instead of *planning* dynamic ad sets we read their live state
// (fetchAdSetGuardInfo) and refuse to relaunch into any that already
// qualify. This is shared between the client-side pre-check (wizard "Launch
// another variation" panel) and the server-side hard enforcement in
// POST /api/meta/bulk-attach-ads — same message, two layers.

/** Soft warning threshold — not a Meta constraint, just an operator sanity check. */
export const RELAUNCH_AD_COUNT_WARNING_THRESHOLD = 6;

function isAdSetBlockedForDynamicCreative(adSet: AdSetGuardInfo): boolean {
  return adSet.isDynamicCreative && adSet.adCount >= 1;
}

export interface RelaunchGuardSummary {
  /** Non-null → hard block, refuse to relaunch. */
  blockedMessage: string | null;
  /** Non-null → soft warning, still allowed to proceed. */
  warningMessage: string | null;
}

/**
 * @param adSets Live guard info for every ad set targeted by the relaunch.
 * @param additionalAdsCount How many new ads this relaunch is about to add
 *   per ad set (typically `creatives.length`) — used only for the soft
 *   over-threshold warning, not the hard block.
 */
export function summariseRelaunchGuard(
  adSets: AdSetGuardInfo[],
  additionalAdsCount: number,
): RelaunchGuardSummary {
  const blocked = adSets.filter(isAdSetBlockedForDynamicCreative);
  const blockedMessage =
    blocked.length > 0
      ? `${blocked.length} ad set${blocked.length !== 1 ? "s" : ""} already use Dynamic Creative and already ` +
        `contain an ad — Meta allows only ONE ad per Dynamic Creative ad set, so no more ads can be added. ` +
        `Remove ${blocked.length !== 1 ? "them" : "it"} from the targeted ad sets, or create a fresh ad set for ` +
        `this variation. Affected ad set ID(s): ${blocked.map((a) => a.id).join(", ")}.`
      : null;

  const overThreshold = adSets.filter(
    (a) =>
      !isAdSetBlockedForDynamicCreative(a) &&
      a.adCount + additionalAdsCount > RELAUNCH_AD_COUNT_WARNING_THRESHOLD,
  );
  const warningMessage =
    overThreshold.length > 0
      ? `${overThreshold.length} ad set${overThreshold.length !== 1 ? "s" : ""} will have more than ` +
        `${RELAUNCH_AD_COUNT_WARNING_THRESHOLD} ads after this launch (currently ` +
        `${overThreshold.map((a) => a.adCount).join(", ")}, +${additionalAdsCount} new). Not blocked — just worth ` +
        `spreading future variations across more ad sets.`
      : null;

  return { blockedMessage, warningMessage };
}
