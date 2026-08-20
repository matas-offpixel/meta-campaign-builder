/**
 * lib/tiktok/write/preflight.ts
 *
 * Collects every launch blocker before any TikTok write. Returns ALL
 * problems at once so the wizard can render them the same way as Meta
 * launch preflight.
 */

import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { validOptimisationGoalForObjective } from "../../tiktok-wizard/campaign-setup.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import {
  SMART_PLUS_BLOCK_MESSAGE,
  TIKTOK_LAUNCHER_UNSUPPORTED_OBJECTIVES,
  buildTikTokAdGroupPayload,
  buildTikTokAdPayload,
  buildTikTokCampaignPayload,
  mapTikTokIdentityType,
  mapTikTokObjectiveType,
  resolveTikTokAdGroupBudget,
  tikTokAdGroupBudgetFloor,
  tikTokBudgetFloorUnverified,
} from "./mapping.ts";

export interface TikTokLaunchPreflightIssue {
  id: string;
  field: string;
  message: string;
}

export interface TikTokLaunchPreflightResult {
  ok: boolean;
  issues: TikTokLaunchPreflightIssue[];
  warnings: TikTokLaunchPreflightIssue[];
}

export function collectTikTokLaunchPreflight(
  draft: TikTokCampaignDraft,
): TikTokLaunchPreflightResult {
  const issues: TikTokLaunchPreflightIssue[] = [];
  const warnings: TikTokLaunchPreflightIssue[] = [];

  if (!draft.eventId) {
    issues.push(
      issue(
        "event",
        "event_id",
        "An event is required to launch (write idempotency is keyed by event_id)",
      ),
    );
  }
  if (!draft.accountSetup.advertiserId) {
    issues.push(
      issue("advertiser", "advertiser_id", "TikTok advertiser is required"),
    );
  }
  if (!draft.accountSetup.identityId) {
    issues.push(
      issue(
        "identity",
        "identity_id",
        "Select a TikTok identity (manual display names cannot be launched)",
      ),
    );
  } else {
    const identityType = mapTikTokIdentityType(draft.accountSetup.identityType);
    if (!identityType.ok) {
      issues.push(
        issue("identity-type", identityType.error.field, identityType.error.message),
      );
    }
  }

  if (draft.optimisation.smartPlusEnabled) {
    issues.push(issue("smart-plus", "smartPlusEnabled", SMART_PLUS_BLOCK_MESSAGE));
  }
  if (draft.campaignSetup.bidStrategy === "SMART_PLUS") {
    issues.push(issue("smart-plus-bid", "bidStrategy", SMART_PLUS_BLOCK_MESSAGE));
  }

  const objective = draft.campaignSetup.objective;
  if (
    objective &&
    TIKTOK_LAUNCHER_UNSUPPORTED_OBJECTIVES.includes(objective)
  ) {
    issues.push(
      issue(
        "objective-unsupported",
        "objective",
        `${objective} is not supported by the launcher yet`,
      ),
    );
  }
  if (
    !validOptimisationGoalForObjective(
      draft.campaignSetup.objective,
      draft.campaignSetup.optimisationGoal,
    )
  ) {
    issues.push(
      issue(
        "objective-goal",
        "optimisationGoal",
        "Objective and optimisation goal are not a compatible pair",
      ),
    );
  }

  if (objective === "CONVERSIONS") {
    if (!draft.accountSetup.pixelId) {
      issues.push(
        issue("pixel", "pixel_id", "CONVERSIONS requires a TikTok pixel"),
      );
    }
    if (!draft.accountSetup.optimisationEvent) {
      issues.push(
        issue(
          "optimisation-event",
          "optimization_event",
          "CONVERSIONS requires an optimisation event from the selected pixel",
        ),
      );
    }
  }

  const mappedObjective = mapTikTokObjectiveType(objective);
  if (!mappedObjective.ok) {
    issues.push(
      issue(
        `campaign-${mappedObjective.error.field}`,
        mappedObjective.error.field,
        mappedObjective.error.message,
      ),
    );
  }

  const campaign = buildTikTokCampaignPayload({
    advertiserId: draft.accountSetup.advertiserId ?? "",
    draft,
  });
  if (!campaign.ok) {
    issues.push(issue(`campaign-${campaign.error.field}`, campaign.error.field, campaign.error.message));
  }

  const start = draft.budgetSchedule.scheduleStartAt;
  const end = draft.budgetSchedule.scheduleEndAt;
  if (!start || !end) {
    issues.push(
      issue("schedule", "schedule", "Schedule start and end are required"),
    );
  } else if (end <= start) {
    issues.push(
      issue("schedule-order", "schedule", "Schedule end must be after start"),
    );
  }

  const campaignBudget = draft.budgetSchedule.budgetAmount;
  const campaignFloor = tikTokAdGroupBudgetFloor({
    budgetMode: draft.budgetSchedule.budgetMode,
    startAt: start,
    endAt: end,
  });
  if (campaignBudget == null) {
    issues.push(issue("budget", "budget", "Budget is required"));
  } else if (!campaignFloor.ok) {
    issues.push(
      issue("budget-minimum", campaignFloor.error.field, campaignFloor.error.message),
    );
  } else if (campaignBudget < campaignFloor.value) {
    issues.push(
      issue(
        "budget-minimum",
        "budget",
        `Budget must be at least ${campaignFloor.value} for ${draft.budgetSchedule.budgetMode} mode`,
      ),
    );
  }

  const adGroups = suggestTikTokAdGroups(draft);
  if (adGroups.length === 0) {
    issues.push(issue("ad-groups", "adGroups", "At least one ad group is required"));
  }

  for (const adGroup of adGroups) {
    const assigned = draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [];
    const creatives = assigned
      .map((id) => draft.creatives.items.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const withVideo = creatives.filter((creative) => Boolean(creative.videoId));
    if (withVideo.length === 0) {
      issues.push(
        issue(
          `adgroup-creative-${adGroup.id}`,
          "creativeAssignments",
          `Ad group "${adGroup.name}" needs at least one assigned creative with a videoId`,
        ),
      );
    }

    const groupBudget = resolveTikTokAdGroupBudget(draft, adGroup);
    const groupFloor = tikTokAdGroupBudgetFloor({
      budgetMode: draft.budgetSchedule.budgetMode,
      startAt: adGroup.startAt ?? start,
      endAt: adGroup.endAt ?? end,
    });
    if (groupBudget == null) {
      issues.push(
        issue(
          `adgroup-budget-${adGroup.id}`,
          "budget",
          `Ad group "${adGroup.name}" is missing a budget`,
        ),
      );
    } else if (!groupFloor.ok) {
      issues.push(
        issue(
          `adgroup-budget-floor-${adGroup.id}`,
          groupFloor.error.field,
          `${adGroup.name}: ${groupFloor.error.message}`,
        ),
      );
    } else if (groupBudget < groupFloor.value) {
      issues.push(
        issue(
          `adgroup-budget-${adGroup.id}`,
          "budget",
          `Ad group "${adGroup.name}" budget ${groupBudget} is below the ${groupFloor.value} floor for ${draft.budgetSchedule.budgetMode} mode`,
        ),
      );
    }

    const groupPayload = buildTikTokAdGroupPayload({
      advertiserId: draft.accountSetup.advertiserId ?? "",
      campaignId: "preflight",
      draft,
      adGroup,
    });
    if (!groupPayload.ok) {
      issues.push(
        issue(
          `adgroup-${adGroup.id}-${groupPayload.error.field}`,
          groupPayload.error.field,
          `${adGroup.name}: ${groupPayload.error.message}`,
        ),
      );
    }

    for (const creative of creatives) {
      if (!isAbsoluteHttpUrl(creative.landingPageUrl)) {
        issues.push(
          issue(
            `landing-${creative.id}`,
            "landing_page_url",
            `Creative "${creative.name}" needs an absolute landing page URL`,
          ),
        );
      }
      const adPayload = buildTikTokAdPayload({
        advertiserId: draft.accountSetup.advertiserId ?? "",
        adGroupId: "preflight",
        draft,
        creative,
      });
      if (!adPayload.ok) {
        issues.push(
          issue(
            `ad-${creative.id}-${adPayload.error.field}`,
            adPayload.error.field,
            `${creative.name}: ${adPayload.error.message}`,
          ),
        );
      }
    }
  }

  const hashtagCount = (draft.audiences.interestGroups ?? []).reduce(
    (sum, group) => sum + group.hashtagIds.length,
    0,
  );
  if (hashtagCount > 0) {
    warnings.push(
      issue(
        "hashtag-unverified",
        "interest_keyword_ids",
        "Hashtag targeting is unverified against TikTok — selected hashtag IDs are sent as interest_keyword_ids",
      ),
    );
  }

  if (tikTokBudgetFloorUnverified(draft.accountSetup.currency)) {
    const currency = draft.accountSetup.currency?.trim() || "unknown";
    warnings.push(
      issue(
        "budget-currency",
        "currency",
        `Advertiser currency is ${currency} — the 20 budget floor is documented for GBP and is unverified for this account`,
      ),
    );
  }

  return {
    ok: issues.length === 0,
    issues: dedupeIssues(issues),
    warnings: dedupeIssues(warnings),
  };
}

export function isAbsoluteHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function issue(
  id: string,
  field: string,
  message: string,
): TikTokLaunchPreflightIssue {
  return { id, field, message };
}

function dedupeIssues(
  issues: TikTokLaunchPreflightIssue[],
): TikTokLaunchPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.field}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
