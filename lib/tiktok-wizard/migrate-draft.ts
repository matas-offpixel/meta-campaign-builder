import type { TikTokIdentity } from "../tiktok/identity.ts";
import type { TikTokLaunchPreflightIssue } from "../tiktok/write/preflight.ts";
import { resolveTikTokSalesDestination } from "./campaign-setup.ts";
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
  const mergedCampaignSetup = {
    ...defaults.campaignSetup,
    ...campaignSetup,
    salesDestination: resolveTikTokSalesDestination(
      campaignSetup.salesDestination ?? defaults.campaignSetup.salesDestination,
    ),
  };
  const mergedOptimisation = {
    ...defaults.optimisation,
    ...optimisation,
  };

  return {
    ...defaults,
    ...(incoming as Partial<TikTokCampaignDraft>),
    id,
    accountSetup: {
      ...defaults.accountSetup,
      ...accountSetup,
    },
    campaignSetup: mergedCampaignSetup,
    optimisation: {
      ...mergedOptimisation,
      guardrails: Array.isArray(optimisation.guardrails)
        ? optimisation.guardrails.filter(
            (item): item is string => typeof item === "string",
          )
        : defaults.optimisation.guardrails,
      targetCostPerResult: resolveMigratedTargetCostPerResult(
        optimisation,
        mergedCampaignSetup,
      ),
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
    importMeta: normalizeImportMeta(incoming.importMeta),
  };
}

function normalizeImportMeta(
  raw: unknown,
): TikTokCampaignDraft["importMeta"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as NonNullable<TikTokCampaignDraft["importMeta"]>;
  const kind = record.sourceKind;
  if (
    kind !== "manual" &&
    kind !== "smart_plus" &&
    kind !== "legacy_smart_plus"
  ) {
    return null;
  }
  return {
    sourceCampaignId:
      typeof record.sourceCampaignId === "string" ? record.sourceCampaignId : "",
    sourceCampaignName:
      typeof record.sourceCampaignName === "string"
        ? record.sourceCampaignName
        : "",
    sourceKind: kind,
    dropped: Array.isArray(record.dropped)
      ? record.dropped.filter(
          (item): item is { field: string; sourceValue: unknown } =>
            Boolean(item && typeof item === "object" && typeof item.field === "string"),
        )
      : [],
    sourceEnhancements: normalizeImportEnhancements(record.sourceEnhancements),
    creativeCounts: normalizeImportCreativeCounts(record.creativeCounts),
    notCarried: Array.isArray(record.notCarried)
      ? record.notCarried.filter(
          (item): item is NonNullable<
            TikTokCampaignDraft["importMeta"]
          >["notCarried"][number] =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof item.name === "string" &&
                typeof item.reason === "string",
            ),
        )
      : [],
    ...(typeof record.adGroupsCarried === "number" &&
    Number.isFinite(record.adGroupsCarried)
      ? { adGroupsCarried: record.adGroupsCarried }
      : {}),
  };
}

/**
 * Drafts saved before the on/off/absent split (#944) recorded only "how
 * many were `=== true`". Everything else was either present-false or
 * absent and that draft cannot say which — so it is reported as
 * *absent*, the weaker claim. Draft c8bca9ff, the live Ironworks import,
 * was in fact absent on all 45.
 */
function normalizeImportEnhancements(
  raw: unknown,
): NonNullable<TikTokCampaignDraft["importMeta"]>["sourceEnhancements"] {
  const record = (raw ?? {}) as Record<string, unknown>;
  const isAcoOn = asOptionalNumber(record.isAcoOn) ?? 0;
  const isAcoTotal = asOptionalNumber(record.isAcoTotal) ?? 0;
  const authorizedOn = asOptionalNumber(record.creativeAuthorizedOn) ?? 0;
  const authorizedTotal = asOptionalNumber(record.creativeAuthorizedTotal) ?? 0;
  const legacy = !("isAcoAbsent" in record);
  return {
    isAcoOn,
    isAcoOff: legacy ? 0 : asOptionalNumber(record.isAcoOff) ?? 0,
    isAcoAbsent: legacy
      ? Math.max(0, isAcoTotal - isAcoOn)
      : asOptionalNumber(record.isAcoAbsent) ?? 0,
    isAcoTotal,
    creativeAuthorizedOn: authorizedOn,
    creativeAuthorizedOff: legacy
      ? 0
      : asOptionalNumber(record.creativeAuthorizedOff) ?? 0,
    creativeAuthorizedAbsent: legacy
      ? Math.max(0, authorizedTotal - authorizedOn)
      : asOptionalNumber(record.creativeAuthorizedAbsent) ?? 0,
    creativeAuthorizedTotal: authorizedTotal,
  };
}

/**
 * `{chosen, tiktokAdded}` counted the same 45 creatives twice and cannot
 * be translated into carried/not-carried. An old draft loses the line
 * rather than showing a number that never meant this.
 */
function normalizeImportCreativeCounts(
  raw: unknown,
): NonNullable<TikTokCampaignDraft["importMeta"]>["creativeCounts"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!("unique" in record) || !("unticked" in record)) return null;
  return {
    sourceRows: asOptionalNumber(record.sourceRows) ?? 0,
    unique: asOptionalNumber(record.unique) ?? 0,
    carried: asOptionalNumber(record.carried) ?? 0,
    unticked: asOptionalNumber(record.unticked) ?? 0,
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
  const candidates = draft.creatives.items.filter((creative) => {
    if (issue.creativeIds?.includes(creative.id)) return true;
    return (
      issue.id.includes(creative.id) || issue.message.includes(creative.name)
    );
  });
  if (candidates.length === 0) return false;
  return candidates.every((creative) => {
    if (!creative.videoId?.trim() || creative.coverImageId?.trim()) return false;
    return Boolean(creative.thumbnailUrl?.trim() || creative.videoId);
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
    // Older drafts snapshotted schedule onto each ad group. Writes ignore
    // these leftover fields; keep them so load does not reject the row.
    startAt: typeof group.startAt === "string" ? group.startAt : null,
    endAt: typeof group.endAt === "string" ? group.endAt : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Persisted COST_CAP + CONVERT/VALUE drafts stored the figure on
 * benchmarkCpc (Target CPC) before targetCostPerResult existed.
 * Copy it once so preflight does not force a re-type.
 */
function resolveMigratedTargetCostPerResult(
  optimisation: Record<string, unknown>,
  campaignSetup: Record<string, unknown>,
): number | null {
  if ("targetCostPerResult" in optimisation)
    return asOptionalNumber(optimisation.targetCostPerResult);
  const bidStrategy =
    optimisation.bidStrategy ?? campaignSetup.bidStrategy;
  const goal = campaignSetup.optimisationGoal;
  if (
    bidStrategy === "COST_CAP" &&
    (goal === "CONVERSION" || goal === "VALUE")
  ) {
    return (
      asOptionalNumber(optimisation.benchmarkCpc) ??
      asOptionalNumber(optimisation.benchmarkCpv) ??
      asOptionalNumber(optimisation.benchmarkCpm)
    );
  }
  return null;
}
