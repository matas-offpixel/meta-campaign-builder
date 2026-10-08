/**
 * Payload plan for the three attach modes. Pure: draft + targets in,
 * every write the launch will make (or the reasons it won't) out.
 *
 * What comes from the target, never from the draft:
 * - objective: new ad groups are built for the campaign's objective_type;
 * - campaign budget optimisation: no ad-group budget is sent;
 * - pixel + optimisation event (`attach_campaign`): the most common pair
 *   on the campaign's existing ad groups, unless the operator overrode it.
 *
 * Ads-only modes copy nothing from the ad group into the ad and change
 * nothing on it: identity, video, CTA and landing URL are the draft's.
 */

import type { BodyValue } from "../client.ts";
import type {
  TikTokCampaignDraft,
  TikTokCreativeDraft,
  TikTokLaunchMode,
  TikTokObjective,
} from "../../types/tiktok-draft.ts";
import { validOptimisationGoalForObjective } from "../../tiktok-wizard/campaign-setup.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import { isUnsupportedTikTokOptimisationEvent } from "../optimisation-event.ts";
import {
  buildTikTokAdGroupPayload,
  buildTikTokAdPayload,
  SMART_PLUS_BLOCK_MESSAGE,
} from "../write/mapping.ts";
import {
  collapseTikTokLaunchPreflightIssues,
  collectTikTokCreativePreflightIssues,
  collectTikTokIdentityPreflightIssues,
  collectTikTokLaunchPreflight,
  type TikTokLaunchPreflightIssue,
  type TikTokLaunchPreflightResult,
} from "../write/preflight.ts";
import {
  draftObjectiveForTikTokObjectiveType,
  isSmartPlusTikTokTarget,
  type TikTokAttachAdGroup,
  type TikTokAttachCampaign,
  type TikTokAttachLiveTargets,
} from "./targets.ts";

export type TikTokAttachMode = Exclude<TikTokLaunchMode, "new">;

export function isTikTokAttachMode(
  mode: TikTokLaunchMode | null | undefined,
): mode is TikTokAttachMode {
  return (
    mode === "attach_campaign" ||
    mode === "attach_adgroup" ||
    mode === "attach_all_adgroups"
  );
}

export interface TikTokAttachAdPlan {
  creative: TikTokCreativeDraft;
  /** The draft the ad payload is built from (objective set to the target's). */
  draft: TikTokCampaignDraft;
}

export interface TikTokAttachNewAdGroupPlan {
  draftAdGroupId: string;
  name: string;
  payload: Record<string, BodyValue>;
  ads: TikTokAttachAdPlan[];
}

export interface TikTokAttachConversion {
  pixelId: string;
  optimisationEvent: string;
  source: "override" | "inherited" | "draft";
  /** Ad groups carrying this pair, of those with a pixel. */
  inheritedFrom?: { matching: number; withPixel: number };
}

export interface TikTokAttachCampaignPlan {
  campaignId: string;
  campaignName: string;
  objective: TikTokObjective;
  budgetOptimizeOn: boolean;
  conversion: TikTokAttachConversion | null;
  adGroups: TikTokAttachNewAdGroupPlan[];
}

export interface TikTokAttachTargetAdGroupPlan {
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  ads: Array<{ creative: TikTokCreativeDraft; payload: Record<string, BodyValue> }>;
}

export interface TikTokAttachPlan {
  mode: TikTokAttachMode;
  /** `attach_campaign`: new ad groups (and their ads) per target campaign. */
  campaigns: TikTokAttachCampaignPlan[];
  /** Ads-only modes: new ads per existing ad group. */
  adGroups: TikTokAttachTargetAdGroupPlan[];
  counts: {
    campaigns: number;
    adGroupsCreated: number;
    adGroupTargets: number;
    ads: number;
  };
}

export interface TikTokAttachPlanResult extends TikTokLaunchPreflightResult {
  plan: TikTokAttachPlan | null;
}

export interface TikTokAttachPlanOptions {
  now?: Date;
  advertiserTimezone?: string | null;
}

function block(
  id: string,
  field: string,
  message: string,
  scope: TikTokLaunchPreflightIssue["scope"] = "campaign",
): TikTokLaunchPreflightIssue {
  return { id, field, message, scope, reason: message };
}

function dedupe(issues: TikTokLaunchPreflightIssue[]): TikTokLaunchPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.field}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tikTokAttachSmartPlusMessage(kind: "campaign" | "ad group", name: string): string {
  return `${kind === "campaign" ? "Campaign" : "Ad group"} "${name}" is Smart+. This launcher never calls Smart+ endpoints, so it cannot add ${kind === "campaign" ? "ad groups or ads" : "ads"} to it.`;
}

export function tikTokAttachObjectiveMismatchMessage(input: {
  campaignName: string;
  objectiveType: string;
  goal: string | null;
}): string {
  return `Campaign "${input.campaignName}" is ${input.objectiveType}, but the draft optimises for ${input.goal ?? "nothing"}. TikTok does not allow that goal under this objective — change the draft's optimisation goal or pick another campaign.`;
}

export function tikTokAttachUnsupportedObjectiveMessage(input: {
  campaignName: string;
  objectiveType: string | null;
}): string {
  return `Campaign "${input.campaignName}" is ${input.objectiveType ?? "an unknown objective"}. The launcher creates ad groups only under TRAFFIC, WEB_CONVERSIONS (Sales) or LEAD_GENERATION campaigns.`;
}

/** Creatives every ads-only target gets: the draft's, with a video. */
export function tikTokAttachCreatives(draft: TikTokCampaignDraft): TikTokCreativeDraft[] {
  return draft.creatives.items.filter((item) => Boolean(item.videoId));
}

/**
 * Most common (pixel_id, optimization_event) pair on the campaign's
 * existing ad groups. Ties go to the pair seen first. Under Sales, pairs
 * on the event deny-list are skipped: existing Ironworks WEB_CONVERSIONS
 * ad groups run on ON_WEB_REGISTER, and a new one created that way can't
 * be edited in Ads Manager.
 */
export function inheritTikTokConversion(
  adGroups: readonly Pick<TikTokAttachAdGroup, "pixelId" | "optimizationEvent">[],
  objective: TikTokObjective | null = null,
): { pixelId: string; optimisationEvent: string; matching: number; withPixel: number } | null {
  const counts = new Map<string, { pixelId: string; event: string; n: number }>();
  let withPixel = 0;
  for (const group of adGroups) {
    if (!group.pixelId || !group.optimizationEvent) continue;
    withPixel += 1;
    if (isUnsupportedTikTokOptimisationEvent(objective, group.optimizationEvent)) continue;
    const key = `${group.pixelId}\u0000${group.optimizationEvent}`;
    const entry = counts.get(key) ?? { pixelId: group.pixelId, event: group.optimizationEvent, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  let best: { pixelId: string; event: string; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best
    ? { pixelId: best.pixelId, optimisationEvent: best.event, matching: best.n, withPixel }
    : null;
}

function withObjective(
  draft: TikTokCampaignDraft,
  objective: TikTokObjective,
  conversion: TikTokAttachConversion | null,
): TikTokCampaignDraft {
  return {
    ...draft,
    campaignSetup: {
      ...draft.campaignSetup,
      objective,
      salesDestination:
        objective === "CONVERSIONS" ? "WEBSITE" : draft.campaignSetup.salesDestination,
    },
    accountSetup: conversion
      ? {
          ...draft.accountSetup,
          pixelId: conversion.pixelId,
          optimisationEvent: conversion.optimisationEvent,
        }
      : draft.accountSetup,
  };
}

function commonIssues(draft: TikTokCampaignDraft): TikTokLaunchPreflightIssue[] {
  const issues: TikTokLaunchPreflightIssue[] = [];
  if (!draft.eventId) {
    issues.push(
      block(
        "event",
        "event_id",
        "An event is required to launch (write idempotency is keyed by event_id)",
      ),
    );
  }
  if (!draft.accountSetup.advertiserId) {
    issues.push(block("advertiser", "advertiser_id", "TikTok advertiser is required"));
  }
  return issues;
}

export function planTikTokAttachLaunch(
  draft: TikTokCampaignDraft,
  targets: TikTokAttachLiveTargets,
  options: TikTokAttachPlanOptions = {},
): TikTokAttachPlanResult {
  const mode = draft.launchMode;
  if (!isTikTokAttachMode(mode)) {
    throw new Error(`planTikTokAttachLaunch called for launch mode ${mode ?? "new"}`);
  }
  if (targets.source === "read_failed") {
    return {
      ok: false,
      issues: [
        block(
          "attach-read-failed",
          "attachCampaigns",
          "Could not read the selected campaigns and ad groups from TikTok, so this launch can't confirm they exist or that none is Smart+. Nothing was created. Retry the launch.",
        ),
      ],
      warnings: [],
      plan: null,
    };
  }
  const result =
    mode === "attach_campaign"
      ? planAttachCampaign(draft, targets, options)
      : planAttachAds(draft, mode, targets);
  const issues = collapseTikTokLaunchPreflightIssues(dedupe(result.issues));
  const ok = issues.length === 0;
  return {
    ok,
    issues,
    warnings: dedupe(result.warnings),
    plan: ok ? result.plan : null,
  };
}

interface PartialResult {
  issues: TikTokLaunchPreflightIssue[];
  warnings: TikTokLaunchPreflightIssue[];
  plan: TikTokAttachPlan;
}

function planAttachCampaign(
  draft: TikTokCampaignDraft,
  targets: TikTokAttachLiveTargets,
  options: TikTokAttachPlanOptions,
): PartialResult {
  const issues: TikTokLaunchPreflightIssue[] = [];
  const warnings: TikTokLaunchPreflightIssue[] = [];
  const selected = draft.attachCampaigns ?? [];
  if (selected.length === 0) {
    issues.push(block("attach-campaigns", "attachCampaigns", "Pick at least one existing campaign to launch into"));
  }
  const campaigns: TikTokAttachCampaignPlan[] = [];

  for (const pick of selected) {
    const live = targets.campaigns.find((row) => row.id === pick.id);
    if (!live) {
      if (targets.source === "live") {
        issues.push(
          block(
            `attach-campaign-missing-${pick.id}`,
            "attachCampaigns",
            `Campaign "${pick.name}" (${pick.id}) was not found on this advertiser or has been deleted.`,
          ),
        );
      }
      continue;
    }
    const plan = planOneCampaign(draft, live, targets, options, issues, warnings);
    if (plan) campaigns.push(plan);
  }

  if (campaigns.length === 0 && selected.length > 0 && issues.length === 0) {
    issues.push(
      block(
        "attach-campaigns-unread",
        "attachCampaigns",
        "None of the selected campaigns could be read from TikTok. Retry the launch.",
      ),
    );
  }
  issues.push(...commonIssues(draft));

  const adGroupsCreated = campaigns.reduce((sum, c) => sum + c.adGroups.length, 0);
  const ads = campaigns.reduce(
    (sum, c) => sum + c.adGroups.reduce((n, g) => n + g.ads.length, 0),
    0,
  );
  return {
    issues,
    warnings,
    plan: {
      mode: "attach_campaign",
      campaigns,
      adGroups: [],
      counts: { campaigns: campaigns.length, adGroupsCreated, adGroupTargets: 0, ads },
    },
  };
}

function planOneCampaign(
  draft: TikTokCampaignDraft,
  live: TikTokAttachCampaign,
  targets: TikTokAttachLiveTargets,
  options: TikTokAttachPlanOptions,
  issues: TikTokLaunchPreflightIssue[],
  warnings: TikTokLaunchPreflightIssue[],
): TikTokAttachCampaignPlan | null {
  if (isSmartPlusTikTokTarget(live)) {
    issues.push(block(`attach-smart-plus-${live.id}`, "attachCampaigns", tikTokAttachSmartPlusMessage("campaign", live.name)));
    return null;
  }
  const objective = draftObjectiveForTikTokObjectiveType(live.objectiveType);
  if (!objective) {
    issues.push(
      block(
        `attach-objective-${live.id}`,
        "objective",
        tikTokAttachUnsupportedObjectiveMessage({ campaignName: live.name, objectiveType: live.objectiveType }),
      ),
    );
    return null;
  }
  if (
    objective === "CONVERSIONS" &&
    live.salesDestination &&
    live.salesDestination.toUpperCase() !== "WEBSITE"
  ) {
    issues.push(
      block(
        `attach-sales-destination-${live.id}`,
        "salesDestination",
        `Campaign "${live.name}" sells to ${live.salesDestination}. The launcher creates website ad groups only.`,
      ),
    );
    return null;
  }
  if (!validOptimisationGoalForObjective(objective, draft.campaignSetup.optimisationGoal)) {
    issues.push(
      block(
        `attach-objective-goal-${live.id}`,
        "optimisationGoal",
        tikTokAttachObjectiveMismatchMessage({
          campaignName: live.name,
          objectiveType: live.objectiveType ?? objective,
          goal: draft.campaignSetup.optimisationGoal,
        }),
      ),
    );
    return null;
  }

  const existing = targets.adGroups.filter((group) => group.campaignId === live.id);
  let conversion: TikTokAttachConversion | null = null;
  if (objective === "CONVERSIONS" || objective === "LEAD_GENERATION") {
    const override = draft.attachConversionOverride;
    const inherited = inheritTikTokConversion(existing, objective);
    if (override) {
      conversion = { ...override, source: "override" };
    } else if (inherited) {
      conversion = {
        pixelId: inherited.pixelId,
        optimisationEvent: inherited.optimisationEvent,
        source: "inherited",
        inheritedFrom: { matching: inherited.matching, withPixel: inherited.withPixel },
      };
    } else if (draft.accountSetup.pixelId && draft.accountSetup.optimisationEvent) {
      conversion = {
        pixelId: draft.accountSetup.pixelId,
        optimisationEvent: draft.accountSetup.optimisationEvent,
        source: "draft",
      };
      warnings.push(
        block(
          `attach-conversion-draft-${live.id}`,
          "pixel_id",
          `Campaign "${live.name}" has no ad group with a usable pixel and event to copy, so new ad groups use the draft's pixel ${conversion.pixelId} and event ${conversion.optimisationEvent}.`,
        ),
      );
    }
  }
  if ((live.operationStatus ?? "").toUpperCase() === "DISABLE") {
    warnings.push(
      block(
        `attach-campaign-paused-${live.id}`,
        "attachCampaigns",
        `Campaign "${live.name}" is paused. New ad groups won't deliver until it's turned on — this launch never changes it.`,
      ),
    );
  }

  const effective = withObjective(draft, objective, conversion);
  const cbo = live.budgetOptimizeOn;
  issues.push(
    ...collectTikTokLaunchPreflight(effective, {
      now: options.now,
      advertiserTimezone: options.advertiserTimezone,
      createsCampaign: false,
      campaignBudgetOptimisation: cbo,
    }).issues,
  );

  const adGroups: TikTokAttachNewAdGroupPlan[] = [];
  for (const adGroup of suggestTikTokAdGroups(effective)) {
    const payload = buildTikTokAdGroupPayload({
      advertiserId: effective.accountSetup.advertiserId ?? "",
      campaignId: live.id,
      draft: effective,
      adGroup,
      ...(cbo ? { campaignBudgetOptimisation: true } : {}),
    });
    if (!payload.ok) {
      issues.push(
        block(
          `attach-adgroup-payload-${live.id}-${adGroup.id}`,
          payload.error.field,
          `Ad group "${adGroup.name}" can't be built for campaign "${live.name}": ${payload.error.message}`,
        ),
      );
      continue;
    }
    const ads: TikTokAttachAdPlan[] = [];
    for (const creativeId of effective.creativeAssignments.byAdGroupId[adGroup.id] ?? []) {
      const creative = effective.creatives.items.find((item) => item.id === creativeId);
      if (creative?.videoId) {
        ads.push({ creative, draft: effective });
      } else {
        issues.push(
          block(
            `attach-ad-video-${live.id}-${adGroup.id}-${creativeId}`,
            "video_id",
            `Creative "${creative?.name ?? creativeId}" is assigned to ad group "${adGroup.name}" but has no uploaded video, so its ad can't be created. Upload the video or unassign it.`,
            "adgroup",
          ),
        );
      }
    }
    adGroups.push({ draftAdGroupId: adGroup.id, name: adGroup.name, payload: payload.value, ads });
  }
  return {
    campaignId: live.id,
    campaignName: live.name,
    objective,
    budgetOptimizeOn: cbo,
    conversion,
    adGroups,
  };
}

function planAttachAds(
  draft: TikTokCampaignDraft,
  mode: "attach_adgroup" | "attach_all_adgroups",
  targets: TikTokAttachLiveTargets,
): PartialResult {
  const issues: TikTokLaunchPreflightIssue[] = [...commonIssues(draft)];
  const warnings: TikTokLaunchPreflightIssue[] = [];
  const advertiserId = draft.accountSetup.advertiserId ?? "";
  issues.push(...collectTikTokIdentityPreflightIssues(draft));
  if (draft.optimisation.smartPlusEnabled) {
    issues.push(block("smart-plus", "smartPlusEnabled", SMART_PLUS_BLOCK_MESSAGE));
  }

  const creatives = tikTokAttachCreatives(draft);
  if (creatives.length === 0) {
    issues.push(block("attach-creatives", "creatives", "At least one creative with a video is required"));
  }

  const campaignById = new Map(targets.campaigns.map((row) => [row.id, row]));
  const chosen: TikTokAttachAdGroup[] = [];
  if (mode === "attach_adgroup") {
    const picks = draft.attachAdGroups ?? [];
    if (picks.length === 0) {
      issues.push(block("attach-adgroups", "attachAdGroups", "Pick at least one existing ad group to launch into"));
    }
    for (const pick of picks) {
      const live = targets.adGroups.find((row) => row.id === pick.id);
      if (live) chosen.push(live);
      else if (targets.source === "live") {
        issues.push(
          block(
            `attach-adgroup-missing-${pick.id}`,
            "attachAdGroups",
            `Ad group "${pick.name}" (${pick.id}) was not found in campaign "${pick.campaignName}" or has been deleted.`,
            "adgroup",
          ),
        );
      }
    }
  } else {
    const picks = draft.attachCampaigns ?? [];
    if (picks.length === 0) {
      issues.push(block("attach-campaigns", "attachCampaigns", "Pick at least one existing campaign to launch into"));
    }
    for (const pick of picks) {
      if (targets.source === "live" && !campaignById.has(pick.id)) {
        issues.push(
          block(
            `attach-campaign-missing-${pick.id}`,
            "attachCampaigns",
            `Campaign "${pick.name}" (${pick.id}) was not found on this advertiser or has been deleted.`,
          ),
        );
        continue;
      }
      const groups = targets.adGroups.filter((row) => row.campaignId === pick.id);
      if (groups.length === 0 && targets.source === "live") {
        issues.push(
          block(
            `attach-campaign-empty-${pick.id}`,
            "attachCampaigns",
            `Campaign "${pick.name}" has no active or paused ad groups to add ads to.`,
          ),
        );
      }
      chosen.push(...groups);
    }
  }

  const plans: TikTokAttachTargetAdGroupPlan[] = [];
  const creativeChecksByObjective = new Set<string>();
  for (const group of chosen) {
    const parent = campaignById.get(group.campaignId);
    const campaignName = parent?.name ?? group.campaignName ?? group.campaignId;
    if (isSmartPlusTikTokTarget(group) || (parent && isSmartPlusTikTokTarget(parent))) {
      issues.push(
        block(
          `attach-smart-plus-${group.id}`,
          "attachAdGroups",
          tikTokAttachSmartPlusMessage(
            parent && isSmartPlusTikTokTarget(parent) ? "campaign" : "ad group",
            parent && isSmartPlusTikTokTarget(parent) ? campaignName : group.name,
          ),
          "adgroup",
        ),
      );
      continue;
    }
    const objective = draftObjectiveForTikTokObjectiveType(parent?.objectiveType ?? null);
    if (parent?.objectiveType && !objective) {
      warnings.push(
        block(
          `attach-objective-${group.id}`,
          "objective",
          `Ad group "${group.name}" is under a ${parent.objectiveType} campaign. The launcher has not created ads under that objective; if TikTok rejects them, the ads this launch created are removed.`,
        ),
      );
    }
    if ((group.optimizationGoal ?? "").toUpperCase() === "LEADS") {
      warnings.push(
        block(
          `attach-instant-form-${group.id}`,
          "attachAdGroups",
          `Ad group "${group.name}" optimises for instant-form leads. The draft's ads carry a website landing URL, not a form; TikTok may reject them.`,
        ),
      );
    }
    if (
      (group.operationStatus ?? "").toUpperCase() === "DISABLE" ||
      (parent?.operationStatus ?? "").toUpperCase() === "DISABLE"
    ) {
      warnings.push(
        block(
          `attach-adgroup-paused-${group.id}`,
          "attachAdGroups",
          `Ad group "${group.name}" (or its campaign) is paused. New ads won't deliver until it's turned on — this launch never changes it.`,
        ),
      );
    }
    const adDraft = objective ? withObjective(draft, objective, null) : draft;
    const objectiveKey = adDraft.campaignSetup.objective ?? "none";
    if (!creativeChecksByObjective.has(objectiveKey)) {
      creativeChecksByObjective.add(objectiveKey);
      issues.push(...collectTikTokCreativePreflightIssues(adDraft, creatives));
    }
    const ads: TikTokAttachTargetAdGroupPlan["ads"] = [];
    for (const creative of creatives) {
      const payload = buildTikTokAdPayload({ advertiserId, adGroupId: group.id, draft: adDraft, creative });
      if (payload.ok) {
        ads.push({ creative, payload: payload.value });
      } else {
        issues.push(
          block(
            `attach-ad-payload-${group.id}-${creative.id}`,
            payload.error.field,
            `Ad "${creative.name}" can't be built for ad group "${group.name}": ${payload.error.message}`,
            "adgroup",
          ),
        );
      }
    }
    plans.push({
      adGroupId: group.id,
      adGroupName: group.name,
      campaignId: group.campaignId,
      campaignName,
      ads,
    });
  }

  return {
    issues,
    warnings,
    plan: {
      mode,
      campaigns: [],
      adGroups: plans,
      counts: {
        campaigns: new Set(plans.map((p) => p.campaignId)).size,
        adGroupsCreated: 0,
        adGroupTargets: plans.length,
        ads: plans.reduce((sum, p) => sum + p.ads.length, 0),
      },
    },
  };
}
