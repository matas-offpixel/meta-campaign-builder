import type { TikTokIdentity } from "../tiktok/identity.ts";
import type { TikTokLaunchPreflightIssue } from "../tiktok/write/preflight.ts";
import {
  createDefaultTikTokDraft,
  normalizeTikTokAudiences,
  type TikTokCampaignDraft,
  type TikTokPublishedIds,
} from "../types/tiktok-draft.ts";

/**
 * Fill keys added since the draft was written, using createDefaultTikTokDraft
 * defaults. Mirrors Meta `migrateDraft()` — schema evolution on load so a
 * draft never blocks on the mere absence of a field.
 */
export function migrateTikTokDraft(raw: unknown): TikTokCampaignDraft {
  const incoming =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id =
    typeof incoming.id === "string" && incoming.id.trim()
      ? incoming.id
      : "unknown";
  const defaults = createDefaultTikTokDraft(id);
  const accountSetup = asRecord(incoming.accountSetup);
  const campaignSetup = asRecord(incoming.campaignSetup);
  const optimisation = asRecord(incoming.optimisation);
  const creatives = asRecord(incoming.creatives);
  const budgetSchedule = asRecord(incoming.budgetSchedule);
  const assignments = asRecord(incoming.creativeAssignments);

  return {
    ...defaults,
    ...(incoming as Partial<TikTokCampaignDraft>),
    id,
    accountSetup: {
      ...defaults.accountSetup,
      ...accountSetup,
    },
    campaignSetup: {
      ...defaults.campaignSetup,
      ...campaignSetup,
    },
    optimisation: {
      ...defaults.optimisation,
      ...optimisation,
      guardrails: Array.isArray(optimisation.guardrails)
        ? optimisation.guardrails.filter(
            (item): item is string => typeof item === "string",
          )
        : defaults.optimisation.guardrails,
    },
    audiences: normalizeTikTokAudiences(
      incoming.audiences as TikTokCampaignDraft["audiences"],
    ),
    creatives: {
      items: Array.isArray(creatives.items)
        ? creatives.items
            .map(normalizeTikTokCreativeItem)
            .filter((item): item is TikTokCampaignDraft["creatives"]["items"][number] =>
              item != null,
            )
        : defaults.creatives.items,
    },
    budgetSchedule: {
      ...defaults.budgetSchedule,
      ...budgetSchedule,
      adGroups: Array.isArray(budgetSchedule.adGroups)
        ? budgetSchedule.adGroups
            .map(normalizeTikTokAdGroup)
            .filter(
              (
                group,
              ): group is TikTokCampaignDraft["budgetSchedule"]["adGroups"][number] =>
                group != null,
            )
        : defaults.budgetSchedule.adGroups,
    },
    creativeAssignments: {
      byAdGroupId:
        assignments.byAdGroupId &&
        typeof assignments.byAdGroupId === "object" &&
        !Array.isArray(assignments.byAdGroupId)
          ? (assignments.byAdGroupId as Record<string, string[]>)
          : defaults.creativeAssignments.byAdGroupId,
    },
    publishedIds: normalizePublishedIds(incoming.publishedIds),
  };
}

/**
 * Production drafts that launched before launchedAt existed omit the key
 * entirely. Fill `launchedAt: null` without dropping the TikTok ids.
 */
export function normalizePublishedIds(raw: unknown): TikTokPublishedIds | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    !("campaignId" in record) &&
    !("adgroupIds" in record) &&
    !("adIds" in record) &&
    !("launchedAt" in record)
  ) {
    return null;
  }
  return {
    campaignId: typeof record.campaignId === "string" ? record.campaignId : "",
    adgroupIds: asStringArray(record.adgroupIds),
    adIds: asStringArray(record.adIds),
    launchedAt: typeof record.launchedAt === "string" ? record.launchedAt : null,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function tikTokIdentityBcIdMissing(
  draft: TikTokCampaignDraft,
): boolean {
  return (
    draft.accountSetup.identityType === "BC_AUTH_TT" &&
    Boolean(draft.accountSetup.identityId?.trim()) &&
    !draft.accountSetup.identityBcId?.trim()
  );
}

/** Server launch can hydrate when advertiser + identity + BC_AUTH_TT are present. */
export function tikTokIdentityBcIdIsServerResolvable(
  draft: TikTokCampaignDraft,
): boolean {
  return (
    tikTokIdentityBcIdMissing(draft) &&
    Boolean(draft.accountSetup.advertiserId?.trim())
  );
}

export function applyIdentityBcIdFromIdentities(
  draft: TikTokCampaignDraft,
  identities: TikTokIdentity[],
): boolean {
  if (!tikTokIdentityBcIdMissing(draft)) return false;
  const match = identities.find(
    (identity) => identity.identity_id === draft.accountSetup.identityId,
  );
  const bcId = match?.identity_bc_id?.trim();
  if (!bcId) return false;
  draft.accountSetup.identityBcId = bcId;
  return true;
}

export async function resolveTikTokDraftIdentityBcIdOnLoad(input: {
  draft: TikTokCampaignDraft;
  fetchIdentities: () => Promise<TikTokIdentity[]>;
  persist?: (draft: TikTokCampaignDraft) => Promise<void>;
}): Promise<"resolved" | "unresolved" | "unchanged"> {
  if (!tikTokIdentityBcIdMissing(input.draft)) return "unchanged";
  let identities: TikTokIdentity[];
  try {
    identities = await input.fetchIdentities();
  } catch {
    return "unresolved";
  }
  const applied = applyIdentityBcIdFromIdentities(input.draft, identities);
  if (!applied) return "unresolved";
  if (input.persist) {
    try {
      await input.persist(input.draft);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tiktok/draft] persist identityBcId draft=${input.draft.id} failed: ${message}`,
      );
    }
  }
  return "resolved";
}

export type TikTokIdentityBcIdResolution =
  | "idle"
  | "pending"
  | "unresolved";

/**
 * Client Review must not hard-block on identity_bc_id when the server can
 * still resolve it at launch. After a failed load-time lookup, keep the
 * blocker — that is the unresolvable case.
 */
export function filterClientResolvableTikTokPreflightIssues(
  issues: TikTokLaunchPreflightIssue[],
  draft: TikTokCampaignDraft,
  resolution: TikTokIdentityBcIdResolution,
): TikTokLaunchPreflightIssue[] {
  return issues.filter((issue) => {
    if (issue.field === "image_ids" || issue.id.startsWith("cover-image-")) {
      return !tikTokCoverImageIsServerResolvable(draft, issue);
    }
    if (issue.id !== "identity-bc-id" && issue.field !== "identity_bc_id") {
      return true;
    }
    if (resolution === "unresolved") return true;
    return !tikTokIdentityBcIdIsServerResolvable(draft);
  });
}

function tikTokCoverImageIsServerResolvable(
  draft: TikTokCampaignDraft,
  issue: TikTokLaunchPreflightIssue,
): boolean {
  return draft.creatives.items.some((creative) => {
    if (!creative.videoId?.trim() || creative.coverImageId?.trim()) return false;
    const matches =
      issue.id.includes(creative.id) || issue.message.includes(creative.name);
    return matches && Boolean(creative.thumbnailUrl?.trim() || creative.videoId);
  });
}

function normalizeTikTokCreativeItem(
  raw: unknown,
): TikTokCampaignDraft["creatives"]["items"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as TikTokCampaignDraft["creatives"]["items"][number];
  if (!item.id) return null;
  return {
    ...item,
    coverImageId:
      typeof item.coverImageId === "string" ? item.coverImageId : null,
  };
}

function normalizeTikTokAdGroup(
  raw: unknown,
): TikTokCampaignDraft["budgetSchedule"]["adGroups"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const group = raw as TikTokCampaignDraft["budgetSchedule"]["adGroups"][number];
  return {
    ...group,
    name: typeof group.name === "string" ? group.name : "",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
