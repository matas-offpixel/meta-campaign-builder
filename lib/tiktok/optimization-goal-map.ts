/**
 * lib/tiktok/optimization-goal-map.ts
 *
 * Maps TikTok campaign `optimization_goal` values (returned by
 * /v1.3/campaign/get/) to:
 *
 *   - `metricKey` — the field name in the integrated-report metrics
 *     payload that represents the campaign's optimization event.
 *   - `rollupConversionKey` — field written to `tiktok_results` when
 *     the goal optimises for a soft event (VIEW_CONTENT) but still
 *     reports pixel conversions separately (e.g. sign-ups).
 *   - `rollupEngagementKey` — field written to `tiktok_engagement_results`.
 *   - `label` — human-readable "Optimising for: X" badge text.
 *
 * Reference: https://business-api.tiktok.com/portal/docs?id=1738864915188737
 */

export type TikTokResultKind = "conversion" | "engagement" | "none";

export interface TikTokGoalInfo {
  /** Primary optimization metric in the TikTok report payload. */
  metricKey: string;
  /**
   * When set with `rollupEngagementKey`, the campaign optimises for an
   * engagement event but also reports conversions via a separate field.
   */
  rollupConversionKey?: string;
  rollupEngagementKey?: string;
  /** Human-readable label: shown as "Optimising for: <label>". */
  label: string;
  /** Drives whether the stats card uses pure conversion wording. */
  resultKind: TikTokResultKind;
  /** Primary metric label on the TikTok stats card. */
  resultsLabel: string;
  /** Cost-per label on the TikTok stats card subline. */
  costPerLabel: string;
}

export interface RollupMetricCounts {
  conversionResults: number;
  engagementResults: number;
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

/**
 * Campaigns optimised for VIEW_CONTENT (or similar soft goals) still report
 * pixel conversions via `conversion` / `complete_registration`. Those go to
 * `tiktok_results`; the optimisation event (`view_content`) goes to
 * `tiktok_engagement_results`.
 */
function dualOptimizationGoal(
  optimizationMetricKey: string,
  label: string,
  rollupConversionKey: string,
): TikTokGoalInfo {
  return {
    metricKey: optimizationMetricKey,
    rollupConversionKey,
    rollupEngagementKey: optimizationMetricKey,
    label,
    resultKind: "engagement",
    resultsLabel: "Conversions",
    costPerLabel: "Cost per conversion",
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
  VIEW_CONTENT: dualOptimizationGoal("view_content", "View Content", "conversion"),
  VIDEO_VIEW: dualOptimizationGoal("view_content", "Video View", "conversion"),
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
export const FALLBACK_GOAL_INFO: TikTokGoalInfo = dualOptimizationGoal(
  "view_content",
  "View Content",
  "conversion",
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

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Split a TikTok integrated-report metrics row into rollup columns.
 * Pure — safe to unit-test without I/O.
 */
export function resolveRollupCountsFromMetrics(
  optimizationGoal: string | null | undefined,
  metrics: Record<string, string | number | null | undefined>,
  objectiveType?: string | null,
): RollupMetricCounts {
  // TikTok does NOT return `optimization_goal` on /campaign/get/ (it is an
  // ad-group field), so campaign-level goal resolution almost always falls
  // through to the fallback. The campaign `objective_type` IS returned and is
  // the reliable signal for engagement-objective campaigns, whose headline
  // result is followers gained — `view_content` is 0 for these. Conversions
  // (if any) still flow to the results column.
  if ((objectiveType ?? "").toUpperCase() === "ENGAGEMENT") {
    return {
      conversionResults:
        numberMetric(metrics.conversion) ||
        numberMetric(metrics.real_time_conversion),
      engagementResults: numberMetric(metrics.follows),
    };
  }

  const goalInfo = resolveGoalInfo(optimizationGoal);

  if (goalInfo.rollupEngagementKey) {
    const conversionKey = goalInfo.rollupConversionKey ?? "conversion";
    const registration = numberMetric(metrics.complete_registration);
    const conversion = numberMetric(metrics[conversionKey]);
    const realtime = numberMetric(metrics.real_time_conversion);
    const conversionResults =
      registration > 0
        ? registration
        : conversion > 0
          ? conversion
          : realtime;
    return {
      conversionResults,
      engagementResults: numberMetric(metrics[goalInfo.rollupEngagementKey]),
    };
  }

  if (goalInfo.resultKind === "conversion") {
    return {
      conversionResults: numberMetric(metrics[goalInfo.metricKey]),
      engagementResults: 0,
    };
  }

  return {
    conversionResults: 0,
    engagementResults: numberMetric(metrics[goalInfo.metricKey]),
  };
}

/**
 * Campaign-level results count for the reporting UI (same semantics as rollup
 * conversion column, but from pre-aggregated per-campaign totals).
 */
export function resolveCampaignResultsCount(
  optimizationGoal: string | null | undefined,
  totals: Partial<Record<string, number>>,
): number {
  const goalInfo = resolveGoalInfo(optimizationGoal);

  if (goalInfo.rollupEngagementKey) {
    const conversionKey = goalInfo.rollupConversionKey ?? "conversion";
    const registration = totals.complete_registration ?? 0;
    const conversion = totals[conversionKey] ?? 0;
    return registration > 0 ? registration : conversion;
  }

  return totals[goalInfo.metricKey] ?? 0;
}
