import { createDefaultTikTokDraft, type TikTokCampaignDraft } from "../../../types/tiktok-draft.ts";

export const ATTACH_CONTEXT = {
  userId: "00000000-0000-0000-0000-000000000001",
  eventId: "00000000-0000-0000-0000-000000000002",
  draftId: "00000000-0000-0000-0000-000000000003",
  advertiserId: "advertiser_1",
  token: "token_1",
};

/** Sales draft: 2 ad groups, 2 creatives, one shared, one per group. */
export function salesDraft(): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft(ATTACH_CONTEXT.draftId);
  draft.eventId = ATTACH_CONTEXT.eventId;
  draft.accountSetup.advertiserId = ATTACH_CONTEXT.advertiserId;
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "Europe/London";
  draft.accountSetup.pixelId = "pixel_draft";
  draft.accountSetup.optimisationEvent = "SHOPPING";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "CONVERSIONS";
  draft.campaignSetup.optimisationGoal = "CONVERSION";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2027-09-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2027-09-08T09:00:00Z";
  draft.budgetSchedule.adGroups = [
    { id: "ag-draft-1", name: "Prospecting", budget: 60, startAt: null, endAt: null },
    { id: "ag-draft-2", name: "Retargeting", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [creative("creative-1", "Hero · v1", "video_1"), creative("creative-2", "Teaser · v1", "video_2")];
  draft.creativeAssignments.byAdGroupId = {
    "ag-draft-1": ["creative-1", "creative-2"],
    "ag-draft-2": ["creative-1"],
  };
  return draft;
}

function creative(id: string, name: string, videoId: string) {
  return {
    id,
    name,
    mode: "VIDEO_REFERENCE" as const,
    baseName: name.split(" · ")[0]!,
    videoId,
    videoUrl: null,
    thumbnailUrl: null,
    coverImageId: `img_${videoId}`,
    durationSeconds: null,
    title: null,
    sparkPostId: null,
    caption: "",
    adText: "Ad text",
    displayName: "Off/Pixel",
    landingPageUrl: "https://example.com",
    cta: "LEARN_MORE",
    musicId: null,
  };
}
