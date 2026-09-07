import {
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  type ResolvedChannelDefaults,
} from "../clients/channel-defaults.ts";
import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import { planToGoogleDraft } from "./adapters/google.ts";
import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import type { CampaignPlan } from "./types.ts";

export interface PlanLaunchDrafts {
  meta: CampaignDraft;
  tiktok: TikTokCampaignDraft;
  google: GoogleSearchPlanTree;
}

export interface PlanLaunchLinkedDrafts {
  meta?: CampaignDraft | null;
  tiktok?: TikTokCampaignDraft | null;
  google?: GoogleSearchPlanTree | null;
}

/**
 * The draft preflight blesses and the draft fan-out launches — one
 * helper, so a green preflight cannot be followed by a write of a
 * different (empty-account) draft.
 */
export function buildPlanLaunchDrafts(
  plan: CampaignPlan,
  linked?: PlanLaunchLinkedDrafts,
  resolved?: ResolvedChannelDefaults | null,
): PlanLaunchDrafts {
  const meta = linked?.meta ?? planToMetaDraft(plan);
  const tiktok = linked?.tiktok ?? planToTikTokDraft(plan);
  const google = linked?.google ?? planToGoogleDraft(plan);
  if (!resolved) {
    return { meta, tiktok, google };
  }
  return {
    meta: applyMetaChannelDefaults(meta, resolved),
    tiktok: applyTikTokChannelDefaults(tiktok, resolved),
    google: applyGoogleChannelDefaults(google, resolved),
  };
}
