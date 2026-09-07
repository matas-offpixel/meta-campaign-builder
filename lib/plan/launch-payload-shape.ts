import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import type { PlanAdapterName } from "./types.ts";

export interface PlanLaunchPayloadShape {
  adapter: PlanAdapterName;
  draftId: string | null;
  adAccount: string | null;
  counts: Record<string, number>;
}

/**
 * Log the shape, not the payload — ids and captions must not land in
 * Vercel logs on every Launch press.
 */
export function launchPayloadShape(
  adapter: PlanAdapterName,
  payload: unknown,
): PlanLaunchPayloadShape {
  if (adapter === "meta") {
    const draft = payload as CampaignDraft;
    const adAccount =
      draft.settings?.adAccountId || draft.settings?.metaAdAccountId || null;
    return {
      adapter,
      draftId: draft.id ?? null,
      adAccount: typeof adAccount === "string" && adAccount.trim() ? adAccount : null,
      counts: {
        creatives: draft.creatives?.length ?? 0,
        adSets: draft.adSetSuggestions?.length ?? 0,
      },
    };
  }
  if (adapter === "tiktok") {
    const draft = payload as TikTokCampaignDraft;
    const adAccount = draft.accountSetup?.advertiserId || null;
    return {
      adapter,
      draftId: draft.id ?? null,
      adAccount: typeof adAccount === "string" && adAccount.trim() ? adAccount : null,
      counts: {
        creatives: draft.creatives?.items?.length ?? 0,
      },
    };
  }
  const tree = payload as GoogleSearchPlanTree;
  const adAccount = tree.plan?.google_ads_account_id || null;
  return {
    adapter,
    draftId: tree.plan?.id ?? null,
    adAccount: typeof adAccount === "string" && adAccount.trim() ? adAccount : null,
    counts: {
      campaigns: tree.campaigns?.length ?? 0,
    },
  };
}
