/**
 * lib/tiktok/optimization-goal-map.ts
 *
 * Maps TikTok campaign `optimization_goal` values (returned by
 * /v1.3/campaign/get/) to:
 *
 *   - `metricKey` — the field name in the integrated-report metrics
 *     payload that represents "results" for that objective.
 *   - `label`     — the human-readable string shown in the
 *     "Optimising for: X" badge beneath each campaign name.
 *   - `resultKind` — whether the metric is a conversion-style result
 *     (shown as "Conversions") or engagement-style (shown with a
 *     goal-specific label like "View Content events").
 *
 * Reference: https://business-api.tiktok.com/portal/docs?id=1738864915188737
 */

export type TikTokResultKind = "conversion" | "engagement" | "none";

export interface TikTokGoalInfo {
  /** Field name in the TikTok integrated-report metrics payload. */
  metricKey: string;
  /** Human-readable label: shown as "Optimising for: <label>". */
  label: string;
  /** Drives whether the stats card uses "Conversions" wording. */
  resultKind: TikTokResultKind;
  /** Primary metric label on the TikTok stats card. */
  resultsLabel: string;
  /** Cost-per label on the TikTok stats card subline. */
  costPerLabel: string;
}

function conversionGoal(
  metricKey: string,
  label: string,
  resultsLabel = "Conversions",
): TikTokGoalInfo {
  return {
    metricKey,
    label,
    resultKind: "conversion",
    resultsLabel,
    costPerLabel: "Cost per conversion",
  };
}

function engagementGoal(
  metricKey: string,
  label: string,
  resultsLabel: string,
  costPerLabel: string,
): TikTokGoalInfo {
  return {
    metricKey,
    label,
    resultKind: "engagement",
    resultsLabel,
    costPerLabel,
  };
}

const GOAL_MAP: Record<string, TikTokGoalInfo> = {
  COMPLETE_REGISTRATION: conversionGoal(
    "complete_registration",
    "Registration",
    "Sign-ups",
  ),
  COMPLETE_PAYMENT: conversionGoal("complete_payment", "Purchase", "Purchases"),
  ADD_TO_CART: conversionGoal("add_to_cart", "Add to Cart", "Adds to cart"),
  INITIATE_CHECKOUT: conversionGoal(
    "initiate_checkout",
    "Initiate Checkout",
    "Checkouts initiated",
  ),
  ADD_TO_WISHLIST: conversionGoal(
    "add_to_wishlist",
    "Add to Wishlist",
    "Adds to wishlist",
  ),
  LEAD: conversionGoal("conversion", "Lead", "Leads"),
  CONVERT: conversionGoal("conversion", "Conversion", "Conversions"),
  LEAD_GENERATION: conversionGoal("conversion", "Lead", "Leads"),
  VIEW_CONTENT: engagementGoal(
    "view_content",
    "View Content",
    "View Content events",
    "Cost per View Content",
  ),
  VIDEO_VIEW: engagementGoal(
    "view_content",
    "Video View",
    "Video views",
    "Cost per video view",
  ),
  REACH: engagementGoal(
    "view_content",
    "Reach",
    "Reach events",
    "Cost per reach event",
  ),
  CLICK: engagementGoal(
    "view_content",
    "Click",
    "Click events",
    "Cost per click event",
  ),
};

/** Fallback for unrecognised or missing optimization goals. */
export const FALLBACK_GOAL_INFO: TikTokGoalInfo = engagementGoal(
  "view_content",
  "View Content",
  "View Content events",
  "Cost per View Content",
);

/**
 * Return the `TikTokGoalInfo` for a campaign's `optimization_goal`.
 */
export function resolveGoalInfo(
  optimizationGoal: string | null | undefined,
): TikTokGoalInfo {
  if (!optimizationGoal) return FALLBACK_GOAL_INFO;
  return GOAL_MAP[optimizationGoal.toUpperCase()] ?? FALLBACK_GOAL_INFO;
}

export function isConversionStyleGoal(
  optimizationGoal: string | null | undefined,
): boolean {
  return resolveGoalInfo(optimizationGoal).resultKind === "conversion";
}

export function isEngagementStyleGoal(
  optimizationGoal: string | null | undefined,
): boolean {
  return resolveGoalInfo(optimizationGoal).resultKind === "engagement";
}
