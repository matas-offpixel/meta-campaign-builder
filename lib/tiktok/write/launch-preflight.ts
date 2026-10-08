/**
 * One preflight entry for every launch mode. `"new"` is
 * {@link collectTikTokLaunchPreflight} unchanged; the attach modes plan
 * against the targets (live at launch, selection-time snapshots in the
 * browser).
 */

import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import {
  isTikTokAttachMode,
  planTikTokAttachLaunch,
  type TikTokAttachPlan,
} from "../attach/plan.ts";
import {
  tikTokAttachTargetsFromSnapshots,
  type TikTokAttachLiveTargets,
} from "../attach/targets.ts";
import {
  collectTikTokLaunchPreflight,
  type TikTokLaunchPreflightOptions,
  type TikTokLaunchPreflightResult,
} from "./preflight.ts";

export interface TikTokDraftLaunchPreflightResult extends TikTokLaunchPreflightResult {
  attachPlan: TikTokAttachPlan | null;
}

export function collectTikTokDraftLaunchPreflight(
  draft: TikTokCampaignDraft,
  options: TikTokLaunchPreflightOptions & {
    attachTargets?: TikTokAttachLiveTargets;
  } = {},
): TikTokDraftLaunchPreflightResult {
  if (!isTikTokAttachMode(draft.launchMode)) {
    return { ...collectTikTokLaunchPreflight(draft, options), attachPlan: null };
  }
  const result = planTikTokAttachLaunch(
    draft,
    options.attachTargets ?? tikTokAttachTargetsFromSnapshots(draft),
    { now: options.now, advertiserTimezone: options.advertiserTimezone },
  );
  return {
    ok: result.ok,
    issues: result.issues,
    warnings: result.warnings,
    attachPlan: result.plan,
  };
}
