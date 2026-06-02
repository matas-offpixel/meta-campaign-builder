/**
 * Builds TikTokRollupTotals for display, separating conversion-style
 * results from engagement-style metrics (e.g. VIEW_CONTENT).
 */

import type { TikTokRollupTotals } from "@/components/report/meta-insights-sections";
import {
  isConversionStyleGoal,
  isEngagementStyleGoal,
  resolveGoalInfo,
  type TikTokGoalInfo,
} from "./optimization-goal-map.ts";

export interface TikTokCampaignGoalRow {
  optimizationGoal: string | null | undefined;
  results: number;
  spend: number;
}

export interface RollupTikTokSums {
  spend: number;
  impressions: number;
  clicks: number;
  videoViews: number;
  reach?: number | null;
  /** Raw tiktok_results column sum — conversion-style only post re-sync. */
  rollupResults: number;
  /** Raw tiktok_engagement_results column sum (VIEW_CONTENT etc.). */
  rollupEngagementResults?: number;
}

/**
 * When per-campaign goal rows are available (campaign insights), use them
 * to split conversion vs engagement counts. Otherwise infer from rollup
 * sums only (legacy path).
 */
export function buildTikTokRollupTotalsDisplay(
  rollup: RollupTikTokSums,
  campaigns?: TikTokCampaignGoalRow[],
): TikTokRollupTotals {
  if (campaigns && campaigns.length > 0) {
    let conversionResults = 0;
    let engagementEvents = 0;
    let primaryGoal: TikTokGoalInfo | null = null;
    const goals = new Set<string>();

    for (const c of campaigns) {
      const goalInfo = resolveGoalInfo(c.optimizationGoal);
      goals.add(goalInfo.label);
      if (!primaryGoal) primaryGoal = goalInfo;
      if (isConversionStyleGoal(c.optimizationGoal)) {
        conversionResults += c.results;
      } else if (isEngagementStyleGoal(c.optimizationGoal)) {
        engagementEvents += c.results;
      }
    }

    const mixedGoals = goals.size > 1;
    const dominantGoal = primaryGoal ?? resolveGoalInfo(null);

    return {
      spend: rollup.spend,
      impressions: rollup.impressions,
      clicks: rollup.clicks,
      videoViews: rollup.videoViews,
      reach: rollup.reach ?? null,
      conversions: conversionResults,
      engagementEvents,
      resultsLabel: mixedGoals
        ? "Conversions"
        : dominantGoal.resultsLabel,
      costPerLabel: mixedGoals
        ? "Cost per conversion"
        : dominantGoal.costPerLabel,
      isConversionStyle: !mixedGoals && isConversionStyleGoal(
        campaigns[0]?.optimizationGoal,
      ),
      showEngagementRow: engagementEvents > 0,
      showConversionRow: conversionResults > 0 || isConversionStyleGoal(campaigns[0]?.optimizationGoal),
    };
  }

  // Legacy rollup-only path: explicit engagement column (post re-sync).
  const engagementFromColumn = rollup.rollupEngagementResults ?? 0;
  if (engagementFromColumn > 0) {
    return {
      spend: rollup.spend,
      impressions: rollup.impressions,
      clicks: rollup.clicks,
      videoViews: rollup.videoViews,
      reach: rollup.reach ?? null,
      conversions: rollup.rollupResults,
      engagementEvents: engagementFromColumn,
      resultsLabel:
        rollup.rollupResults > 0 ? "Conversions" : "View Content events",
      costPerLabel:
        rollup.rollupResults > 0
          ? "Cost per conversion"
          : "Cost per View Content",
      isConversionStyle: rollup.rollupResults > 0,
      showEngagementRow: true,
      showConversionRow: rollup.rollupResults > 0,
    };
  }

  // Pre-fix data: large tiktok_results likely mislabelled view_content events.
  const inferredEngagement = rollup.rollupResults > 10_000;
  const engagementEvents = inferredEngagement ? rollup.rollupResults : 0;
  const conversionCount = inferredEngagement ? 0 : rollup.rollupResults;
  return {
    spend: rollup.spend,
    impressions: rollup.impressions,
    clicks: rollup.clicks,
    videoViews: rollup.videoViews,
    reach: rollup.reach ?? null,
    conversions: conversionCount,
    engagementEvents,
    resultsLabel: inferredEngagement ? "View Content events" : "Conversions",
    costPerLabel: inferredEngagement ? "Cost per View Content" : "Cost per conversion",
    isConversionStyle: !inferredEngagement,
    showEngagementRow: engagementEvents > 0,
    showConversionRow: !inferredEngagement && conversionCount > 0,
  };
}
