import type { CreativeInsightRow } from "@/lib/types/intelligence";

/**
 * lib/intelligence/objective-metrics.ts
 *
 * Maps Meta campaign objectives → success-metric presets so the
 * heatmap can stop pretending every campaign measures the same
 * thing. A registration-objective ad with 0 purchases isn't broken
 * — its "Purchases" column is meaningless, and what we actually
 * want to see is registrations + CPR.
 *
 * H1 already cached `campaign_objective` on every snapshot row, so
 * grouping is a pure client-side transform — no schema changes, no
 * extra round-trips. This module is the single source of truth for
 * "which group does objective X belong to" and "what does that
 * group care about" so the chip filter, default sort, summary bar,
 * and column-swap logic all stay in sync.
 *
 * Preset rules are written down here intentionally (see
 * OBJECTIVE_PRESETS) — they will be revisited once the Motion trial
 * informs how Matas wants brand vs performance split. Anything
 * heavier than a small lookup table belongs in a follow-up.
 */

export type ObjectiveGroup =
  | "leads"
  | "sales"
  | "traffic"
  | "awareness"
  | "engagement"
  | "other";

export type CreativeNumericMetric = Extract<
  keyof CreativeInsightRow,
  | "spend"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cpm"
  | "cpc"
  | "frequency"
  | "reach"
  | "linkClicks"
  | "purchases"
  | "registrations"
  | "cpl"
  | "cpr"
>;

export interface ObjectivePreset {
  group: ObjectiveGroup;
  /** Chip + summary label, e.g. "Leads / Registrations". */
  label: string;
  /**
   * The metric to surface first in the summary. Drives the default
   * sort column when this group is active, and is highlighted in the
   * per-objective summary headline.
   */
  primaryMetric: CreativeNumericMetric;
  /** Display label for the primary metric (e.g. "CPR"). */
  primaryLabel: string;
  /**
   * Format hint for `primaryMetric`. The component owns the actual
   * formatters (`fmtMoney` / `fmtNum` / `fmtPct`); this just tells it
   * which one to call.
   */
  primaryFormat: "money" | "int" | "pct" | "ratio";
  /**
   * Default sort direction when activating this preset. Cost metrics
   * sort ascending (cheaper = better), counts/rates sort descending
   * (more = better).
   */
  defaultSortDir: "asc" | "desc";
  /**
   * Ordered metrics list for the table when this preset is active.
   * The component pins thumbnail + ad name on the left and
   * fatigue + tags on the right around this list.
   */
  visibleMetrics: CreativeNumericMetric[];
}

/**
 * Normalise + map an arbitrary Meta objective string to an
 * ObjectiveGroup. Comparison is case-insensitive and tolerates the
 * legacy (TRAFFIC / CONVERSIONS / …) and Outcome-era
 * (OUTCOME_TRAFFIC / OUTCOME_SALES / …) names — every ad account in
 * Matas's portfolio currently mixes both.
 *
 * Unknowns map to `'other'` so the chip count stays meaningful and
 * we never silently bucket something into the wrong group. If a new
 * Meta objective shows up, add it to the lookup here rather than
 * silently relying on the fallback.
 */
export function groupForObjective(
  objective: string | null | undefined,
): ObjectiveGroup {
  if (!objective) return "other";
  const o = objective.toUpperCase();

  // Leads / lead generation
  if (
    o.includes("LEAD") ||
    o.includes("REGISTRATION") ||
    o === "OUTCOME_LEADS"
  ) {
    return "leads";
  }
  // Sales / conversions / purchases
  if (
    o.includes("SALES") ||
    o.includes("CONVERSION") ||
    o.includes("PURCHASE") ||
    o === "OUTCOME_SALES"
  ) {
    return "sales";
  }
  // Traffic / link clicks
  if (o.includes("TRAFFIC") || o === "LINK_CLICKS" || o === "OUTCOME_TRAFFIC") {
    return "traffic";
  }
  // Awareness / reach / brand awareness / video views (we treat
  // video views as awareness since we don't surface ThruPlay yet —
  // engagement is reserved for post-engagement / ctr-led objectives).
  if (
    o.includes("AWARENESS") ||
    o.includes("REACH") ||
    o.includes("VIDEO_VIEW") ||
    o === "OUTCOME_AWARENESS"
  ) {
    return "awareness";
  }
  // Engagement / post engagement / messages / app engagement
  if (
    o.includes("ENGAGEMENT") ||
    o.includes("MESSAGE") ||
    o === "OUTCOME_ENGAGEMENT"
  ) {
    return "engagement";
  }
  return "other";
}

/**
 * Per-group preset table. The `other` preset matches the current
 * full column set so unrecognised objectives don't silently change
 * the layout under the user.
 */
export const OBJECTIVE_PRESETS: Record<ObjectiveGroup, ObjectivePreset> = {
  leads: {
    group: "leads",
    label: "Leads / Registrations",
    primaryMetric: "cpr",
    primaryLabel: "CPR",
    primaryFormat: "money",
    defaultSortDir: "asc",
    visibleMetrics: ["spend", "impressions", "ctr", "registrations", "cpr"],
  },
  sales: {
    group: "sales",
    label: "Sales",
    primaryMetric: "purchases",
    primaryLabel: "Purchases",
    primaryFormat: "int",
    defaultSortDir: "desc",
    visibleMetrics: ["spend", "impressions", "ctr", "purchases", "cpc", "frequency"],
  },
  traffic: {
    group: "traffic",
    label: "Traffic",
    primaryMetric: "cpc",
    primaryLabel: "CPC",
    primaryFormat: "money",
    defaultSortDir: "asc",
    visibleMetrics: ["spend", "linkClicks", "ctr", "cpc", "frequency"],
  },
  awareness: {
    group: "awareness",
    label: "Awareness",
    primaryMetric: "cpm",
    primaryLabel: "CPM",
    primaryFormat: "money",
    defaultSortDir: "asc",
    visibleMetrics: ["spend", "impressions", "reach", "cpm", "frequency"],
  },
  engagement: {
    group: "engagement",
    label: "Engagement",
    primaryMetric: "ctr",
    primaryLabel: "CTR",
    primaryFormat: "pct",
    defaultSortDir: "desc",
    visibleMetrics: ["spend", "impressions", "ctr", "cpc", "frequency"],
  },
  other: {
    group: "other",
    label: "Other",
    primaryMetric: "cpl",
    primaryLabel: "CPL",
    primaryFormat: "money",
    defaultSortDir: "asc",
    visibleMetrics: [
      "spend",
      "impressions",
      "ctr",
      "cpm",
      "cpc",
      "frequency",
      "cpl",
      "purchases",
    ],
  },
};

/**
 * Display order for the chip row. `other` is last so the row reads
 * by importance: leads first because that's where Matas spends most
 * of his Meta budget (event registrations + Eventbrite-style sign-up
 * funnels), then sales, then the rest.
 */
export const OBJECTIVE_GROUP_ORDER: ObjectiveGroup[] = [
  "leads",
  "sales",
  "traffic",
  "awareness",
  "engagement",
  "other",
];
