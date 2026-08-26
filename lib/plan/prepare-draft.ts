import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import type { CampaignPlan, PlanAdapterName } from "./types.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

export type PreparableAdapter = PlanAdapterName;

export function wizardHrefForDraft(
  adapter: PlanAdapterName,
  draftId: string,
): string | null {
  if (adapter === "meta") return `/campaign/${draftId}`;
  if (adapter === "tiktok") return `/tiktok-campaign/${draftId}`;
  if (adapter === "google") return `/google-search/${draftId}`;
  return null;
}

export function resolvePreparedDraftId(
  existingDraftId: string | null | undefined,
  createdDraftId: string,
): { draftId: string; reused: boolean } {
  if (existingDraftId) return { draftId: existingDraftId, reused: true };
  return { draftId: createdDraftId, reused: false };
}

export function buildPrefillMetaDraft(
  plan: CampaignPlan,
  clientId?: string | null,
): CampaignDraft {
  const draft = planToMetaDraft(plan);
  if (clientId) draft.settings.clientId = clientId;
  return draft;
}

export function buildPrefillTikTokDraft(
  plan: CampaignPlan,
  clientId?: string | null,
): TikTokCampaignDraft {
  const draft = planToTikTokDraft(plan);
  if (clientId) draft.clientId = clientId;
  return draft;
}

/**
 * Google prep is only refused when there is no Meta draft to derive from.
 * With a Meta draft the seed keywords are the Meta targeting vocabulary
 * verbatim — still not invented, just no longer empty.
 */
export const GOOGLE_PREPARE_REASON =
  "google_keywords_not_invented — build the Meta campaign first; Google seed keywords are derived from the Meta targeting vocabulary, never guessed";
