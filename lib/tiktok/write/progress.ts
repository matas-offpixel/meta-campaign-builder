import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";

export type TikTokLaunchPhase = "campaign" | "adgroup" | "ad";

/**
 * Snapshot the orchestrator reports after a unit of work completes.
 * Counts are only present once the launcher has computed them — callers
 * must not invent in-between values.
 */
export interface TikTokLaunchProgress {
  phase: TikTokLaunchPhase;
  campaignId: string | null;
  adGroupsDone: number;
  adGroupsTotal: number;
  adsDone: number;
  adsTotal: number;
}

/** Planned write counts — same loops the orchestrator will execute. */
export function plannedTikTokLaunchCounts(draft: TikTokCampaignDraft): {
  adGroupsTotal: number;
  adsTotal: number;
} {
  const adGroups = suggestTikTokAdGroups(draft);
  let adsTotal = 0;
  for (const adGroup of adGroups) {
    const creativeIds = draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [];
    for (const creativeId of creativeIds) {
      const creative = draft.creatives.items.find((item) => item.id === creativeId);
      if (creative?.videoId) adsTotal += 1;
    }
  }
  return { adGroupsTotal: adGroups.length, adsTotal };
}
