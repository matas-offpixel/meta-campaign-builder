/**
 * Agency policy: blocked Advantage+ creative features must not be OPT_IN /
 * DEFAULT_OPT_IN on active ads. Grounded in live probes (2026-05-06).
 */

// Off/Pixel policy: every key here must be OPT_OUT on every active ad.
// Empirically grounded against 4theFans + Louder + Junction 2 probes 2026-05-06.
export const POLICY_BLOCKED_FEATURES = [
  "standard_enhancements", // weight 3 — bundle, cascades
  "text_optimizations", // weight 3 — rewrites client's ad copy
  "product_extensions",
  "contextual_multi_ads", // multi-advertiser ads (creative-level)
  "video_auto_crop",
  "video_filtering",
  "video_uncrop",
  "ig_video_native_subtitle",
  "image_animation",
  "image_templates",
  "image_touchups",
  "image_background_gen",
  "image_uncrop",
  "show_summary",
  "show_destination_blurbs",
  "video_to_image",
  "carousel_to_video",
  "multi_photo_to_video",
  "text_translation",
  "description_automation",
  "replace_media_text",
  "add_text_overlay",
  "creative_stickers",
  "ads_with_benefits",
  "site_extensions",
  "local_store_extension",
  "profile_card",
  "reveal_details_over_time",
  "enhance_cta",
  "media_type_automation",
  "media_order",
  "advantage_plus_creative",
  "biz_ai",
  "cv_transformation",
  "pac_relaxation",
  "pac_recomposition",
  "adapt_to_placement",
  "hide_price",
] as const;

/** Still scanned and stored, but excluded from severity, banner counts, and pills. */
export const POLICY_TRACKED_FEATURES = ["inline_comment"] as const;

export type PolicyBlockedFeature = (typeof POLICY_BLOCKED_FEATURES)[number];

export type PolicyTier = "BLOCKED" | "TRACKED";

const BLOCKED_SET = new Set<string>(POLICY_BLOCKED_FEATURES);
const TRACKED_SET = new Set<string>(POLICY_TRACKED_FEATURES);

export function getPolicyTier(featureKey: string): PolicyTier | null {
  if (BLOCKED_SET.has(featureKey)) return "BLOCKED";
  if (TRACKED_SET.has(featureKey)) return "TRACKED";
  return null;
}

const HEAVY_WEIGHT_FEATURES = new Set<PolicyBlockedFeature>([
  "standard_enhancements",
  "text_optimizations",
]);

/** Exported for dashboard severity-aware UI (pills / copy). */
export const HEAVY_WEIGHT_FEATURE_KEYS: ReadonlySet<string> = HEAVY_WEIGHT_FEATURES;

export type FlaggedFeatureMap = Record<string, "OPT_IN" | "DEFAULT_OPT_IN">;

export interface FeatureEvaluation {
  flagged: FlaggedFeatureMap;
  severityScore: number;
}

/** True when every flagged key is TRACKED tier (no BLOCKED violations). */
export function isTrackedOnlyFlagSet(flagged: FlaggedFeatureMap): boolean {
  const keys = Object.keys(flagged);
  if (keys.length === 0) return false;
  return keys.every((k) => getPolicyTier(k) === "TRACKED");
}

export function evaluateCreativeFeatures(
  spec: Record<string, { enroll_status?: string }> | null | undefined,
): FeatureEvaluation {
  const flagged: FlaggedFeatureMap = {};
  let severityScore = 0;
  if (!spec || typeof spec !== "object") {
    return { flagged, severityScore };
  }

  const considerBlocked = (key: PolicyBlockedFeature) => {
    const status = spec[key]?.enroll_status;
    if (status === "OPT_IN" || status === "DEFAULT_OPT_IN") {
      flagged[key] = status as "OPT_IN" | "DEFAULT_OPT_IN";
      severityScore += HEAVY_WEIGHT_FEATURES.has(key) ? 3 : 1;
    }
  };

  const considerTracked = (key: (typeof POLICY_TRACKED_FEATURES)[number]) => {
    const status = spec[key]?.enroll_status;
    if (status === "OPT_IN" || status === "DEFAULT_OPT_IN") {
      flagged[key] = status as "OPT_IN" | "DEFAULT_OPT_IN";
    }
  };

  for (const key of POLICY_BLOCKED_FEATURES) {
    considerBlocked(key);
  }
  for (const key of POLICY_TRACKED_FEATURES) {
    considerTracked(key);
  }

  return { flagged, severityScore };
}
