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
 *
 * Priority chain for the resolver:
 *   1. Exact match on the uppercase goal string.
 *   2. If the goal is unrecognised (custom pixel event, future API
 *      value, or null/undefined), fall back to `view_content`.
 *      This produces Results = 0 and CPR = — for awareness-only
 *      campaigns, which is intentionally conservative.
 *
 * Reference: https://business-api.tiktok.com/portal/docs?id=1738864915188737
 */

export interface TikTokGoalInfo {
  /** Field name in the TikTok integrated-report metrics payload. */
  metricKey: string;
  /** Human-readable label: shown as "Optimising for: <label>". */
  label: string;
}

const GOAL_MAP: Record<string, TikTokGoalInfo> = {
  // Conversion events — specific pixel events
  COMPLETE_REGISTRATION: {
    metricKey: "complete_registration",
    label: "Registration",
  },
  COMPLETE_PAYMENT: {
    metricKey: "complete_payment",
    label: "Purchase",
  },
  ADD_TO_CART: {
    metricKey: "add_to_cart",
    label: "Add to Cart",
  },
  INITIATE_CHECKOUT: {
    metricKey: "initiate_checkout",
    label: "Initiate Checkout",
  },
  ADD_TO_WISHLIST: {
    metricKey: "add_to_wishlist",
    label: "Add to Wishlist",
  },
  // Lead form fills (not tied to a registration pixel event)
  LEAD: {
    metricKey: "conversion",
    label: "Lead",
  },
  // Generic CONVERT — campaign has conversions but specific event lives
  // at ad-group level; use the aggregate conversion count as the best
  // available campaign-level proxy.
  CONVERT: {
    metricKey: "conversion",
    label: "Conversion",
  },
  // Awareness / engagement objectives — no meaningful conversion metric
  VIEW_CONTENT: {
    metricKey: "view_content",
    label: "View Content",
  },
  VIDEO_VIEW: {
    metricKey: "view_content",
    label: "Video View",
  },
  REACH: {
    metricKey: "view_content",
    label: "Reach",
  },
  CLICK: {
    metricKey: "view_content",
    label: "Click",
  },
};

/** Fallback for unrecognised or missing optimization goals. */
export const FALLBACK_GOAL_INFO: TikTokGoalInfo = {
  metricKey: "view_content",
  label: "View Content",
};

/**
 * Return the `TikTokGoalInfo` for a campaign's `optimization_goal`.
 * Accepts null / undefined (campaigns with no goal set) and any
 * unexpected future API value — both resolve to the fallback.
 */
export function resolveGoalInfo(
  optimizationGoal: string | null | undefined,
): TikTokGoalInfo {
  if (!optimizationGoal) return FALLBACK_GOAL_INFO;
  return GOAL_MAP[optimizationGoal.toUpperCase()] ?? FALLBACK_GOAL_INFO;
}
