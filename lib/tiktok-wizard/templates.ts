import {
  createDefaultTikTokDraft,
  type TikTokAccountSetup,
  type TikTokCampaignDraft,
} from "../types/tiktok-draft.ts";

export interface TikTokCampaignTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  snapshot: TikTokTemplateSnapshot;
  createdAt: string;
  updatedAt: string;
}

export type TikTokTemplateSnapshot = Omit<
  TikTokCampaignDraft,
  "id" | "status" | "createdAt" | "updatedAt" | "publishedIds" | "reviewReadyAt"
>;

function stripTikTokAccountIds(
  accountSetup: TikTokAccountSetup,
): TikTokAccountSetup {
  return {
    ...accountSetup,
    tiktokAccountId: null,
    advertiserId: null,
    identityId: null,
    identityDisplayName: null,
    identityManualName: null,
    identityType: null,
    pixelId: null,
    pixelName: null,
    optimisationEvent: null,
    currency: null,
  };
}

export function snapshotTikTokDraft(
  draft: TikTokCampaignDraft,
): TikTokTemplateSnapshot {
  return {
    clientId: draft.clientId,
    eventId: draft.eventId,
    accountSetup: stripTikTokAccountIds(draft.accountSetup),
    campaignSetup: draft.campaignSetup,
    optimisation: draft.optimisation,
    audiences: draft.audiences,
    creatives: draft.creatives,
    budgetSchedule: {
      ...draft.budgetSchedule,
      scheduleStartAt: null,
      scheduleEndAt: null,
    },
    creativeAssignments: draft.creativeAssignments,
    creativeIntegrityMode: draft.creativeIntegrityMode,
  };
}

export function applyTikTokTemplate(
  template: TikTokCampaignTemplate,
  draftId: string,
): TikTokCampaignDraft {
  const now = new Date().toISOString();
  const base = createDefaultTikTokDraft(draftId);
  return {
    ...base,
    ...template.snapshot,
    accountSetup: stripTikTokAccountIds(template.snapshot.accountSetup),
    id: draftId,
    status: "draft",
    publishedIds: null,
    reviewReadyAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
