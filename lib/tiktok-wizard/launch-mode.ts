import type {
  TikTokAttachAdGroupSnapshot,
  TikTokAttachCampaignSnapshot,
  TikTokCampaignDraft,
  TikTokLaunchMode,
  TikTokObjective,
} from "../types/tiktok-draft.ts";
import {
  draftObjectiveForTikTokObjectiveType,
  isSmartPlusTikTokTarget,
} from "../tiktok/attach/targets.ts";
import { TIKTOK_OBJECTIVE_LABELS } from "./campaign-setup.ts";

/** The three "What do you want to do?" tiles. */
export type TikTokLaunchTile = "new" | "campaign" | "adgroup";

/** "What should happen under each campaign at launch?" */
export type TikTokCampaignSubMode = "attach_campaign" | "attach_all_adgroups";

export const TIKTOK_LAUNCH_TILES: ReadonlyArray<{
  tile: TikTokLaunchTile;
  label: string;
  description: string;
}> = [
  {
    tile: "new",
    label: "Create new campaign",
    description: "The wizard provisions everything from scratch.",
  },
  {
    tile: "campaign",
    label: "Add to existing campaign",
    description:
      "Pick live campaign(s): create a new ad group under each, or attach ads to all their existing ad groups.",
  },
  {
    tile: "adgroup",
    label: "Add to existing ad group",
    description:
      "Pick specific live ad groups and add new ads only. Audience, budget and optimisation are inherited.",
  },
];

export const TIKTOK_CAMPAIGN_SUB_TILES: ReadonlyArray<{
  mode: TikTokCampaignSubMode;
  label: string;
  description: string;
}> = [
  {
    mode: "attach_campaign",
    label: "Create new ad group",
    description:
      "One new ad group per campaign, with this draft's audience, budget and creatives.",
  },
  {
    mode: "attach_all_adgroups",
    label: "Attach ads to all existing ad groups",
    description:
      "New ads in every active or paused ad group of each campaign. No new ad group.",
  },
];

export const TIKTOK_ATTACH_ALL_NOTE =
  "Active and paused ad groups are read from TikTok at launch, and every creative with a video becomes a new ad in each. No ad group's budget, targeting or optimisation is changed.";

export const TIKTOK_LAUNCH_MODE_READ_ONLY_NOTE =
  "Already launched: duplicate the draft to launch again.";

export function tikTokLaunchModeOf(draft: Pick<TikTokCampaignDraft, "launchMode">): TikTokLaunchMode {
  return draft.launchMode ?? "new";
}

export function isTikTokAttachLaunchMode(mode: TikTokLaunchMode): boolean {
  return mode !== "new";
}

/** Ads-only: nothing but ads is created, so audience, budget and assignment don't apply. */
export function isTikTokAdsOnlyLaunchMode(mode: TikTokLaunchMode): boolean {
  return mode === "attach_adgroup" || mode === "attach_all_adgroups";
}

export function tikTokLaunchTileForMode(mode: TikTokLaunchMode): TikTokLaunchTile {
  if (mode === "attach_adgroup") return "adgroup";
  if (mode === "attach_campaign" || mode === "attach_all_adgroups") return "campaign";
  return "new";
}

/** "Add to existing campaign" keeps the current sub-mode, else "Create new ad group". */
export function tikTokLaunchModeForTile(
  tile: TikTokLaunchTile,
  current: TikTokLaunchMode,
): TikTokLaunchMode {
  if (tile === "new") return "new";
  if (tile === "adgroup") return "attach_adgroup";
  return current === "attach_all_adgroups" ? "attach_all_adgroups" : "attach_campaign";
}

/**
 * Draft patch for switching launch mode. Selections that the next mode
 * doesn't read are dropped. Entering an attach mode from "new" sets
 * Launch as to paused; the operator can switch it to live on Review.
 */
export function tikTokLaunchModePatch(
  draft: Pick<TikTokCampaignDraft, "launchMode" | "launchPaused">,
  next: TikTokLaunchMode,
): Partial<TikTokCampaignDraft> {
  const current = tikTokLaunchModeOf(draft);
  if (current === next) return {};
  const patch: Partial<TikTokCampaignDraft> = { launchMode: next };
  if (next === "new") {
    patch.attachCampaigns = [];
    patch.attachAdGroups = [];
    patch.attachConversionOverride = null;
    return patch;
  }
  if (next !== "attach_adgroup") patch.attachAdGroups = [];
  if (next !== "attach_campaign") patch.attachConversionOverride = null;
  if (current === "new") patch.launchPaused = true;
  return patch;
}

/** Review's initial "Launch as": the stored choice, else paused in every attach mode. */
export function tikTokReviewDefaultLaunchPaused(
  draft: Pick<TikTokCampaignDraft, "launchMode" | "launchPaused">,
): boolean {
  if (typeof draft.launchPaused === "boolean") return draft.launchPaused;
  return isTikTokAttachLaunchMode(tikTokLaunchModeOf(draft));
}

export function tikTokLaunchModeReadOnly(
  draft: Pick<TikTokCampaignDraft, "publishedIds">,
): boolean {
  return Boolean(draft.publishedIds?.campaignId);
}

export function isSmartPlusTikTokSnapshot(
  snapshot: Pick<TikTokAttachCampaignSnapshot | TikTokAttachAdGroupSnapshot, "automationType">,
): boolean {
  return isSmartPlusTikTokTarget({
    automationType: snapshot.automationType,
    isSmartPerformanceCampaign: false,
  });
}

/** `operation_status` as Ads Manager shows it. */
export function tikTokStatusChip(status: string | null): string {
  const value = (status ?? "").toUpperCase();
  if (value === "ENABLE") return "ACTIVE";
  if (value === "DISABLE") return "PAUSED";
  return value || "—";
}

export function tikTokObjectiveBadge(objectiveType: string | null): string {
  const objective = draftObjectiveForTikTokObjectiveType(objectiveType);
  return objective ? TIKTOK_OBJECTIVE_LABELS[objective] : (objectiveType ?? "Unknown objective");
}

/** Objective the new ad groups take in `attach_campaign`: the first picked campaign's, when supported. */
export function tikTokAttachGoalObjective(
  draft: Pick<TikTokCampaignDraft, "launchMode" | "attachCampaigns">,
): TikTokObjective | null {
  if (tikTokLaunchModeOf(draft) !== "attach_campaign") return null;
  for (const campaign of draft.attachCampaigns ?? []) {
    const objective = draftObjectiveForTikTokObjectiveType(campaign.objectiveType);
    if (objective) return objective;
  }
  return null;
}

function nameList(names: string[], fallback: string): string {
  if (names.length === 0) return fallback;
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** Who an attach launch inherits from, by name. */
export function tikTokAttachInheritSource(
  draft: Pick<TikTokCampaignDraft, "launchMode" | "attachCampaigns" | "attachAdGroups">,
): string {
  const mode = tikTokLaunchModeOf(draft);
  if (mode === "attach_adgroup") {
    return nameList(
      (draft.attachAdGroups ?? []).map((group) => group.name),
      "the ad groups you pick",
    );
  }
  const campaigns = nameList(
    (draft.attachCampaigns ?? []).map((campaign) => campaign.name),
    "the campaigns you pick",
  );
  return mode === "attach_all_adgroups" ? `the ad groups in ${campaigns}` : campaigns;
}

export type TikTokInheritedStep = "campaign" | "audiences" | "budget" | "assign";

/** One-line "Inherited from …" note for a step an attach mode collapses, or null when it applies. */
export function tikTokInheritedStepNote(
  draft: Pick<TikTokCampaignDraft, "launchMode" | "attachCampaigns" | "attachAdGroups">,
  step: TikTokInheritedStep,
): string | null {
  const mode = tikTokLaunchModeOf(draft);
  if (mode === "new") return null;
  const source = tikTokAttachInheritSource(draft);
  if (mode === "attach_campaign") {
    if (step === "campaign") {
      return `Inherited from ${source}: no campaign is created, so name, objective and campaign budget stay as they are. The optimisation goal and bid below are for the new ad groups.`;
    }
    if (step === "budget") {
      return `Inherited from ${source}: the campaign budget isn't changed. The amount here is each new ad group's budget; a campaign on campaign budget optimisation gets no ad-group budget.`;
    }
    return null;
  }
  switch (step) {
    case "campaign":
      return `Inherited from ${source}: objective, optimisation goal, bid and pixel. Only ads are created.`;
    case "audiences":
      return `Inherited from ${source}: the audience isn't changed. Only ads are created.`;
    case "budget":
      return `Inherited from ${source}: budget and schedule aren't changed. Only ads are created.`;
    case "assign":
      return `Inherited from ${source}: every creative with a video becomes a new ad in each ad group.`;
  }
}
