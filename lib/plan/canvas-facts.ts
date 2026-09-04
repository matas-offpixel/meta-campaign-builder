/**
 * Zone E facts — the counts on each `ChannelRow`.
 *
 * Every number is read off the linked draft, never off the plan: the
 * plan holds intent, the draft holds what actually exists. A channel
 * with no draft has no facts, which is what the `waiting` state renders.
 */

import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import type { ChannelFact } from "../viz/channel-row.ts";
import type { AudienceSettings, CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

/**
 * One audience = one thing the operator selected, whichever tab it came
 * from. Saved audiences and Off/Pixel audiences are counted as ids
 * because that is the unit the operator picked; every other tab is
 * counted as groups, which is the unit that becomes an ad set.
 */
export function countAudiences(audiences: AudienceSettings | null | undefined): number {
  if (!audiences) return 0;
  return (
    (audiences.pageGroups?.length ?? 0) +
    (audiences.customAudienceGroups?.length ?? 0) +
    (audiences.interestGroups?.length ?? 0) +
    (audiences.selectedPagesLookalikeGroups?.length ?? 0) +
    (audiences.savedAudiences?.audienceIds?.length ?? 0) +
    (audiences.offpixelCustomAudienceIds?.length ?? 0)
  );
}

export function metaChannelFacts(draft: CampaignDraft | null | undefined): ChannelFact[] {
  if (!draft) return [];
  return [
    { n: countAudiences(draft.audiences), noun: "audiences" },
    { n: draft.creatives?.length ?? 0, noun: "creatives" },
    { n: draft.adSetSuggestions?.length ?? 0, noun: "ad sets" },
  ];
}

export function tiktokChannelFacts(
  draft: TikTokCampaignDraft | null | undefined,
): ChannelFact[] {
  if (!draft) return [];
  const videos = draft.creatives?.items?.length ?? 0;
  return [{ n: videos, noun: videos === 1 ? "video" : "videos" }];
}

/**
 * Positives live on ad groups; negatives are split between the shared
 * plan list and per-campaign lists. Both negative scopes are one number
 * to the operator — the scope is a Google detail, not a fact about
 * whether the plan is ready.
 */
export function googleChannelFacts(
  tree: GoogleSearchPlanTree | null | undefined,
): ChannelFact[] {
  if (!tree) return [];
  let keywords = 0;
  let negatives = tree.plan_negatives?.length ?? 0;
  for (const campaign of tree.campaigns ?? []) {
    negatives += campaign.negatives?.length ?? 0;
    for (const group of campaign.ad_groups ?? []) {
      keywords += group.keywords?.length ?? 0;
    }
  }
  return [
    { n: keywords, noun: "keywords" },
    { n: negatives, noun: "negatives" },
  ];
}

export const EMPTY_CHANNEL_FACTS = {
  meta: [] as ChannelFact[],
  tiktok: [] as ChannelFact[],
  google: [] as ChannelFact[],
};
