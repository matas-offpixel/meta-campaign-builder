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

export const TIKTOK_TEMPLATE_ACCOUNT_RESTORED =
  "Account setup restored from template";
export const TIKTOK_TEMPLATE_ACCOUNT_CLEARED =
  "Account setup cleared — this template was saved for a different client";

export const TIKTOK_TEMPLATE_NOTICE_STORAGE_KEY =
  "tiktok-template-account-notice";

export type TikTokTemplateApplyResult = {
  draft: TikTokCampaignDraft;
  accountSetupRestored: boolean;
};

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
    identityBcId: null,
    identityType: null,
    pixelId: null,
    pixelName: null,
    optimisationEvent: null,
    currency: null,
    timezone: null,
  };
}

/**
 * identityBcId is derived from the live identity list (#803 heals a miss).
 * Never restore a snapshot value — re-resolve on load.
 */
function restoreTikTokAccountSetup(
  accountSetup: TikTokAccountSetup,
): TikTokAccountSetup {
  return {
    ...accountSetup,
    identityBcId: null,
  };
}

export function tikTokTemplateSameClient(
  templateClientId: string | null,
  targetClientId: string | null,
): boolean {
  return (
    templateClientId != null &&
    targetClientId != null &&
    templateClientId === targetClientId
  );
}

export function tikTokTemplateAccountNotice(restored: boolean): string {
  return restored
    ? TIKTOK_TEMPLATE_ACCOUNT_RESTORED
    : TIKTOK_TEMPLATE_ACCOUNT_CLEARED;
}

export function storeTikTokTemplateAccountNotice(
  draftId: string,
  restored: boolean,
): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(
    TIKTOK_TEMPLATE_NOTICE_STORAGE_KEY,
    JSON.stringify({
      draftId,
      notice: tikTokTemplateAccountNotice(restored),
    }),
  );
}

export function consumeTikTokTemplateAccountNotice(
  draftId: string,
): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(TIKTOK_TEMPLATE_NOTICE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { draftId?: string; notice?: string };
    if (parsed.draftId !== draftId || !parsed.notice) return null;
    sessionStorage.removeItem(TIKTOK_TEMPLATE_NOTICE_STORAGE_KEY);
    return parsed.notice;
  } catch {
    sessionStorage.removeItem(TIKTOK_TEMPLATE_NOTICE_STORAGE_KEY);
    return null;
  }
}

export function snapshotTikTokDraft(
  draft: TikTokCampaignDraft,
): TikTokTemplateSnapshot {
  return {
    clientId: draft.clientId,
    eventId: draft.eventId,
    accountSetup: draft.accountSetup,
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
  targetClientId: string | null = template.snapshot.clientId,
): TikTokTemplateApplyResult {
  const now = new Date().toISOString();
  const base = createDefaultTikTokDraft(draftId);
  const accountSetupRestored = tikTokTemplateSameClient(
    template.snapshot.clientId,
    targetClientId,
  );
  const draft: TikTokCampaignDraft = {
    ...base,
    ...template.snapshot,
    accountSetup: accountSetupRestored
      ? restoreTikTokAccountSetup(template.snapshot.accountSetup)
      : stripTikTokAccountIds(template.snapshot.accountSetup),
    budgetSchedule: {
      ...template.snapshot.budgetSchedule,
      scheduleStartAt: null,
      scheduleEndAt: null,
    },
    id: draftId,
    status: "draft",
    publishedIds: null,
    reviewReadyAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return { draft, accountSetupRestored };
}
