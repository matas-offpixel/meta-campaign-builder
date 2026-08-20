/**
 * lib/tiktok/write/preflight.ts
 *
 * Collects every launch blocker before any TikTok write. Returns ALL
 * problems at once so the wizard can render them the same way as Meta
 * launch preflight.
 */

import type { TikTokCampaignDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import {
  SMART_PLUS_BLOCK_MESSAGE,
  buildTikTokAdGroupPayload,
  buildTikTokAdPayload,
  buildTikTokCampaignPayload,
  mapTikTokIdentityType,
  tikTokMinimumBudget,
} from "./mapping.ts";

export interface TikTokLaunchPreflightIssue {
  id: string;
  field: string;
  message: string;
}

export interface TikTokLaunchPreflightResult {
  ok: boolean;
  issues: TikTokLaunchPreflightIssue[];
}

export function collectTikTokLaunchPreflight(
  draft: TikTokCampaignDraft,
): TikTokLaunchPreflightResult {
  const issues: TikTokLaunchPreflightIssue[] = [];

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

  const budget = draft.budgetSchedule.budgetAmount;
  const minimum = tikTokMinimumBudget(draft.budgetSchedule.budgetMode);
  if (budget == null) {
    issues.push(issue("budget", "budget", "Budget is required"));
  } else if (budget < minimum) {
    issues.push(
      issue(
        "budget-minimum",
        "budget",
        `Budget must be at least ${minimum} for ${draft.budgetSchedule.budgetMode} mode`,
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

  return { ok: issues.length === 0, issues: dedupeIssues(issues) };
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
