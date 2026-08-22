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
  isUnsupportedTikTokOptimisationEvent,
  tikTokUnsupportedOptimisationEventMessage,
} from "../optimisation-event.ts";
import { tikTokCampaignNameCollisionMessage } from "./campaign-names.ts";
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
  tikTokWriteSchedule,
} from "./mapping.ts";
import {
  TIKTOK_SCHEDULE_START_MARGIN_MS,
  formatWallClockForTikTok,
  isIanaTimeZone,
  resolveScheduleInstant,
  tikTokAdvertiserTimezoneMissingMessage,
  tikTokScheduleStartTooSoonMessage,
} from "./schedule-time.ts";

export type TikTokPreflightScope = "campaign" | "adgroup" | "creative";

export interface TikTokLaunchPreflightIssue {
  id: string;
  field: string;
  message: string;
  scope?: TikTokPreflightScope;
  /** Unprefixed problem text used as the collapse key. */
  reason?: string;
  creativeIds?: string[];
  adGroupIds?: string[];
}

const PREFLIGHT_FIELD_ALIASES: Record<string, string> = {
  bid_type: "bidStrategy",
  bidStrategy: "bidStrategy",
  optimization_goal: "optimisationGoal",
  optimisationGoal: "optimisationGoal",
};

export function canonicalTikTokPreflightField(field: string): string {
  return PREFLIGHT_FIELD_ALIASES[field] ?? field;
}

export interface TikTokLaunchPreflightResult {
  ok: boolean;
  issues: TikTokLaunchPreflightIssue[];
  warnings: TikTokLaunchPreflightIssue[];
}

export function collectTikTokLaunchPreflight(
  draft: TikTokCampaignDraft,
  options: {
    existingCampaignNames?: string[];
    now?: Date;
    advertiserTimezone?: string | null;
  } = {},
): TikTokLaunchPreflightResult {
  const issues: TikTokLaunchPreflightIssue[] = [];
  const warnings: TikTokLaunchPreflightIssue[] = [];
  const campaignName = draft.campaignSetup.campaignName.trim();
  const existingNames = options.existingCampaignNames ?? [];
  if (
    campaignName &&
    existingNames.some((name) => name.trim() === campaignName)
  ) {
    issues.push(
      issue(
        "campaign-name-taken",
        "campaign_name",
        tikTokCampaignNameCollisionMessage(campaignName, existingNames),
      ),
    );
  }

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
    } else if (
      identityType.value === "BC_AUTH_TT" &&
      !draft.accountSetup.identityBcId?.trim()
    ) {
      const name =
        draft.accountSetup.identityDisplayName ??
        draft.accountSetup.identityManualName ??
        draft.accountSetup.identityId ??
        "unknown";
      issues.push(
        issue(
          "identity-bc-id",
          "identity_bc_id",
          `Identity "${name}" is BC_AUTH_TT but no Business Center id could be resolved. TikTok requires identity_bc_id for Business-Center-shared identities.`,
        ),
      );
    }
  }

  if (draft.optimisation.smartPlusEnabled) {
    issues.push(issue("smart-plus", "smartPlusEnabled", SMART_PLUS_BLOCK_MESSAGE));
  }
  const bidStrategy =
    draft.optimisation.bidStrategy ?? draft.campaignSetup.bidStrategy;
  if (bidStrategy == null) {
    issues.push(
      issue(
        "bid-strategy",
        "bidStrategy",
        "Choose a bid strategy before launch. A missing strategy publishes the ad group with no bid.",
      ),
    );
  }
  if (bidStrategy === "SMART_PLUS") {
    issues.push(issue("smart-plus-bid", "bidStrategy", SMART_PLUS_BLOCK_MESSAGE));
  }
  if (
    bidStrategy === "COST_CAP" &&
    (draft.campaignSetup.optimisationGoal === "CONVERSION" ||
      draft.campaignSetup.optimisationGoal === "VALUE") &&
    draft.optimisation.targetCostPerResult == null
  ) {
    issues.push(
      issue(
        "target-cost",
        "targetCostPerResult",
        "Cost cap requires a target cost per result",
      ),
    );
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

  if (objective === "CONVERSIONS" || objective === "LEAD_GENERATION") {
    if (!draft.accountSetup.pixelId) {
      issues.push(
        issue("pixel", "pixel_id", `${objective} requires a TikTok pixel`),
      );
    }
    if (!draft.accountSetup.optimisationEvent) {
      issues.push(
        issue(
          "optimisation-event",
          "optimization_event",
          `${objective} requires an optimisation event from the selected pixel`,
        ),
      );
    } else if (
      isUnsupportedTikTokOptimisationEvent(
        objective,
        draft.accountSetup.optimisationEvent,
      )
    ) {
      issues.push(
        issue(
          "optimisation-event-unsupported",
          "optimization_event",
          tikTokUnsupportedOptimisationEventMessage(
            draft.accountSetup.optimisationEvent,
          ),
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

  const { startAt: start, endAt: end } = tikTokWriteSchedule(draft);
  const timeZone =
    options.advertiserTimezone ?? draft.accountSetup.timezone ?? null;
  if (!isIanaTimeZone(timeZone)) {
    issues.push(
      issue(
        "advertiser-timezone",
        "timezone",
        tikTokAdvertiserTimezoneMissingMessage(),
      ),
    );
  }
  if (!start || !end) {
    issues.push(
      issue("schedule", "schedule", "Schedule start and end are required"),
    );
  } else if (end <= start) {
    issues.push(
      issue("schedule-order", "schedule", "Schedule end must be after start"),
    );
  } else if (isIanaTimeZone(timeZone)) {
    const now = options.now ?? new Date();
    const startInstant = resolveScheduleInstant(start, timeZone);
    const formattedStart =
      formatWallClockForTikTok(start, timeZone) ?? start;
    if (
      !startInstant ||
      startInstant.getTime() < now.getTime() + TIKTOK_SCHEDULE_START_MARGIN_MS
    ) {
      issues.push(
        issue(
          "schedule-start-soon",
          "schedule_start_time",
          tikTokScheduleStartTooSoonMessage(formattedStart, timeZone),
        ),
      );
    }
  }

  const campaignBudget = draft.budgetSchedule.budgetAmount;
  const campaignFloor = tikTokAdGroupBudgetFloor({
    budgetMode: draft.budgetSchedule.budgetMode,
    startAt: start,
    endAt: end,
    currency: draft.accountSetup.currency,
  });
  const currencyLabel =
    (draft.accountSetup.currency ?? "").trim().toUpperCase() || "unknown";
  if (campaignBudget == null) {
    issues.push(issue("budget", "budget", "Budget is required"));
  } else if (!campaignFloor.ok) {
    issues.push(
      issue("budget-minimum", campaignFloor.error.field, campaignFloor.error.message),
    );
  } else if (campaignFloor.value != null && campaignBudget < campaignFloor.value) {
    issues.push(
      issue(
        "budget-minimum",
        "budget",
        `TikTok requires a minimum ${currencyLabel} ${draft.budgetSchedule.budgetMode.toLowerCase()} budget of ${campaignFloor.value} (TikTok's constraint, not ours)`,
      ),
    );
  }

  const adGroups = suggestTikTokAdGroups(draft);
  if (adGroups.length === 0) {
    issues.push(issue("ad-groups", "adGroups", "At least one ad group is required"));
  }

  for (const adGroup of adGroups) {
    if (isBlankTikTokAdGroupName(adGroup.name)) {
      issues.push(
        issue(
          `adgroup-name-${adGroup.id}`,
          "adgroup_name",
          tikTokBlankAdGroupNameMessage(adGroup.id),
          { scope: "adgroup", adGroupId: adGroup.id },
        ),
      );
    }

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
          { scope: "adgroup", adGroupId: adGroup.id },
        ),
      );
    }

    const groupBudget = resolveTikTokAdGroupBudget(draft, adGroup);
    const groupFloor = tikTokAdGroupBudgetFloor({
      budgetMode: draft.budgetSchedule.budgetMode,
      startAt: start,
      endAt: end,
      currency: draft.accountSetup.currency,
    });
    if (groupBudget == null) {
      issues.push(
        issue(
          `adgroup-budget-${adGroup.id}`,
          "budget",
          `Ad group "${adGroup.name}" is missing a budget`,
          { scope: "adgroup", adGroupId: adGroup.id },
        ),
      );
    } else if (!groupFloor.ok) {
      issues.push(
        issue(
          `adgroup-budget-floor-${adGroup.id}`,
          groupFloor.error.field,
          `${adGroup.name}: ${groupFloor.error.message}`,
          {
            scope: "adgroup",
            adGroupId: adGroup.id,
            reason: groupFloor.error.message,
          },
        ),
      );
    } else if (groupFloor.value != null && groupBudget < groupFloor.value) {
      issues.push(
        issue(
          `adgroup-budget-${adGroup.id}`,
          "budget",
          `Ad group "${adGroup.name}" budget ${groupBudget} is below TikTok's ${currencyLabel} minimum of ${groupFloor.value} for ${draft.budgetSchedule.budgetMode} mode`,
          { scope: "adgroup", adGroupId: adGroup.id },
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
          {
            scope: "adgroup",
            adGroupId: adGroup.id,
            reason: groupPayload.error.message,
          },
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
            { scope: "creative", creativeId: creative.id },
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
            {
              scope: "creative",
              creativeId: creative.id,
              reason: adPayload.error.message,
            },
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
    issues.push(
      issue(
        "hashtag-unverified",
        "interest_keyword_ids",
        "Hashtag targeting is blocked: TikTok hashtag IDs have not been verified to share a namespace with interest_keyword_ids. Remove hashtags from the audience before launch.",
      ),
    );
  }

  if (tikTokBudgetFloorUnverified(draft.accountSetup.currency)) {
    const currency = draft.accountSetup.currency?.trim() || "unknown";
    warnings.push(
      issue(
        "budget-currency",
        "currency",
        `Advertiser currency is ${currency} — no TikTok minimum budget is documented for this currency, so preflight is not blocking on amount`,
      ),
    );
  }

  const collapsed = collapseTikTokLaunchPreflightIssues(issues);
  return {
    ok: collapsed.length === 0,
    issues: collapsed,
    warnings: dedupeIssues(warnings),
  };
}

export function isBlankTikTokAdGroupName(
  name: string | null | undefined,
): boolean {
  return !(name ?? "").trim();
}

export function tikTokBlankAdGroupNameMessage(adGroupId: string): string {
  return `Ad group "${adGroupId}" has an empty or whitespace-only name. Set a name before launch — TikTok rejects a blank adgroup_name.`;
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

function inferPreflightScope(id: string): TikTokPreflightScope {
  if (id.startsWith("adgroup-")) return "adgroup";
  if (id.startsWith("landing-")) return "creative";
  if (id.startsWith("ad-") && id !== "ad-groups") return "creative";
  return "campaign";
}

function issue(
  id: string,
  field: string,
  message: string,
  extras: {
    scope?: TikTokPreflightScope;
    reason?: string;
    creativeId?: string;
    adGroupId?: string;
    creativeIds?: string[];
    adGroupIds?: string[];
  } = {},
): TikTokLaunchPreflightIssue {
  const scope = extras.scope ?? inferPreflightScope(id);
  const creativeIds =
    extras.creativeIds ??
    (extras.creativeId ? [extras.creativeId] : undefined);
  const adGroupIds =
    extras.adGroupIds ?? (extras.adGroupId ? [extras.adGroupId] : undefined);
  return {
    id,
    field,
    message,
    scope,
    reason: extras.reason ?? message,
    ...(creativeIds ? { creativeIds } : {}),
    ...(adGroupIds ? { adGroupIds } : {}),
  };
}

type NormalizedPreflightIssue = TikTokLaunchPreflightIssue & {
  scope: TikTokPreflightScope;
  reason: string;
};

function normalizePreflightIssue(
  entry: TikTokLaunchPreflightIssue,
): NormalizedPreflightIssue {
  return {
    ...entry,
    scope: entry.scope ?? inferPreflightScope(entry.id),
    reason: entry.reason ?? entry.message,
  };
}

function collapseKey(entry: NormalizedPreflightIssue): string {
  return `${canonicalTikTokPreflightField(entry.field)}:${entry.reason}`;
}

function memberIds(
  group: readonly TikTokLaunchPreflightIssue[],
  key: "creativeIds" | "adGroupIds",
): string[] {
  return [
    ...new Set(group.flatMap((entry) => entry[key] ?? [])),
  ];
}

/**
 * Campaign + ad-group (or per-creative) checks often fire on the same
 * problem under aliased field names. Keep the campaign-level issue, collapse
 * leftover scoped issues that share a canonical field + reason, and carry
 * every member id on the survivor.
 */
export function collapseTikTokLaunchPreflightIssues(
  issues: readonly TikTokLaunchPreflightIssue[],
): TikTokLaunchPreflightIssue[] {
  const unique = dedupeIssues(issues).map(normalizePreflightIssue);
  const campaignKeys = new Set(
    unique.filter((entry) => entry.scope === "campaign").map(collapseKey),
  );

  const scopedGroups = {
    adgroup: new Map<string, NormalizedPreflightIssue[]>(),
    creative: new Map<string, NormalizedPreflightIssue[]>(),
  };
  for (const entry of unique) {
    if (entry.scope === "campaign") continue;
    const key = collapseKey(entry);
    if (campaignKeys.has(key)) continue;
    const groups = scopedGroups[entry.scope];
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const emitted = {
    adgroup: new Set<string>(),
    creative: new Set<string>(),
  };
  const collapsed: TikTokLaunchPreflightIssue[] = [];
  for (const entry of unique) {
    if (entry.scope === "campaign") {
      collapsed.push(entry);
      continue;
    }
    const key = collapseKey(entry);
    if (campaignKeys.has(key) || emitted[entry.scope].has(key)) continue;
    emitted[entry.scope].add(key);
    const group = scopedGroups[entry.scope].get(key) ?? [entry];
    if (group.length === 1) {
      collapsed.push(entry);
      continue;
    }
    const noun = entry.scope === "creative" ? "creatives" : "ad groups";
    const idsKey = entry.scope === "creative" ? "creativeIds" : "adGroupIds";
    collapsed.push({
      ...entry,
      id: group[0]!.id,
      field: entry.field,
      message: `${entry.reason} (${group.length} ${noun})`,
      reason: entry.reason,
      [idsKey]: memberIds(group, idsKey),
    });
  }
  return collapsed;
}

function dedupeIssues(
  issues: readonly TikTokLaunchPreflightIssue[],
): TikTokLaunchPreflightIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.field}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
