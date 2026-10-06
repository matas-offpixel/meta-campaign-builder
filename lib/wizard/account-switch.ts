import type {
  AdCreativeDraft,
  AdSetSuggestion,
  Asset,
  AudienceSettings,
  CampaignDraft,
  CustomAudienceGroup,
  PageAudienceGroup,
} from "../types.ts";
import type { MetaImportMeta, MetaImportNotCarried } from "../meta/import/types.ts";
import { withoutActPrefix } from "../meta/ad-account-id.ts";

export const CUSTOM_AUDIENCE_REMOVED_SUFFIX = " · custom audience removed";

export interface AccountSwitchImpact {
  uploadedAssets: number;
  audiences: number;
  needsConfirm: boolean;
  /** Imported rows that keep interests, geo, or a page group and lose the custom audience. */
  adSetsLosingCustomAudience: number;
  /** Imported rows whose only audience source was a custom audience. */
  adSetsDisabled: number;
}

export interface AccountSwitchOptions {
  /** Display name of the account being switched to. The act id is used when absent. */
  nextAccountName?: string;
}

function isMetaAudienceId(id: string | undefined): id is string {
  return !!id && /^\d{10,}$/.test(id);
}

function assetBelongsToAccount(asset: Asset): boolean {
  return Boolean(
    asset.assetHash || asset.videoId || asset.uploadedUrl || asset.thumbnailUrl,
  );
}

function addId(ids: Set<string>, id: string | undefined): void {
  if (isMetaAudienceId(id)) ids.add(id);
}

function audienceIdsOnDraft(draft: CampaignDraft): Set<string> {
  const ids = new Set<string>();
  for (const group of draft.audiences.pageGroups) {
    for (const id of group.customAudienceIds) addId(ids, id);
    for (const id of group.engagementAudienceIds ?? []) addId(ids, id);
    for (const id of group.lookalikeAudienceIds ?? []) addId(ids, id);
    for (const status of group.engagementAudienceStatuses ?? []) {
      addId(ids, status.id);
      addId(ids, status.lookalikeId);
    }
  }
  for (const group of draft.audiences.customAudienceGroups) {
    for (const id of group.audienceIds) addId(ids, id);
    for (const list of Object.values(group.lookalikeAudienceIdsByRange ?? {})) {
      for (const id of list) addId(ids, id);
    }
  }
  for (const id of draft.audiences.savedAudiences.audienceIds) addId(ids, id);
  for (const id of draft.audiences.offpixelCustomAudienceIds ?? []) addId(ids, id);
  for (const group of draft.audiences.selectedPagesLookalikeGroups) {
    for (const list of Object.values(group.engagementAudienceIdsByPage ?? {})) {
      for (const id of list) addId(ids, id);
    }
    for (const list of Object.values(group.lookalikeAudienceIdsByRange ?? {})) {
      for (const id of list) addId(ids, id);
    }
  }
  return ids;
}

function attachTargetCount(draft: CampaignDraft): number {
  const settings = draft.settings;
  return (
    (settings.existingMetaCampaign ? 1 : 0) +
    (settings.existingMetaCampaigns?.length ?? 0) +
    (settings.existingMetaAdSet ? 1 : 0) +
    (settings.existingMetaAdSets?.length ?? 0)
  );
}

function actLabel(id: string): string {
  const bare = withoutActPrefix(id);
  return bare ? `act_${bare}` : id.trim();
}

export function foreignAudienceLaunchLabel(accountId: string): string {
  return `⚠ from ${actLabel(accountId)} — removed on launch`;
}

export function customAudienceUnavailableSubtitle(
  sourceAccountId: string,
  nextAccountName: string,
): string {
  return `Custom audience from ${actLabel(sourceAccountId)} — not available on ${nextAccountName}`;
}

type ImportedCaRef = { id: string; name: string; groupId: string };

type ImportedRowPlan = {
  adSetId: string;
  groupId: string;
  kind: "lose" | "disable";
  interestGroupId: string | null;
  refs: ImportedCaRef[];
};

function recoveredInterestGroupId(draft: CampaignDraft, adSet: AdSetSuggestion): string | null {
  const ids = new Set<string>();
  const flexible = draft.importMeta?.flexibleSpec?.[adSet.id];
  if (flexible?.state === "present") {
    for (const id of flexible.interestIds) ids.add(id);
  }
  for (const row of draft.importMeta?.dropped ?? []) {
    if (row.field !== "interests" || row.adSetId !== adSet.id || !Array.isArray(row.value)) continue;
    for (const id of row.value) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  if (ids.size === 0) return null;
  const groupId = `interests:${[...ids].sort().join(",")}`;
  return draft.audiences.interestGroups.some((group) => group.id === groupId) ? groupId : null;
}

function adSetHasGeo(adSet: AdSetSuggestion): boolean {
  if ((adSet.locationGroupIds?.length ?? 0) > 0 || adSet.locationGroupId) return true;
  const geo = adSet.geoLocations;
  if (!geo) return false;
  const excluded = geo.excluded_geo_locations;
  return Boolean(
    geo.countries?.length ||
      geo.cities?.length ||
      geo.regions?.length ||
      geo.country_groups?.length ||
      excluded?.countries?.length ||
      excluded?.cities?.length ||
      excluded?.regions?.length ||
      excluded?.country_groups?.length,
  );
}

function refsForImportedAdSet(draft: CampaignDraft, adSet: AdSetSuggestion): ImportedCaRef[] {
  if (!adSet.importedFromAdSetId) return [];
  if (adSet.sourceType !== "custom_group" && adSet.sourceType !== "custom_group_lookalike") return [];
  const group = draft.audiences.customAudienceGroups.find((row) => row.id === adSet.sourceId);
  if (!group) return [];
  const foreign = group.foreignAccountById ?? {};
  const ids =
    adSet.sourceType === "custom_group_lookalike"
      ? (group.lookalikeAudienceIdsByRange?.[adSet.lookalikeRange ?? ""] ?? [])
      : group.audienceIds;
  return ids
    .filter((id) => id && !foreign[id])
    .map((id) => ({
      id,
      name: group.audienceNames?.[id]?.trim() || id,
      groupId: group.id,
    }));
}

function classifyImportedCustomAudiences(draft: CampaignDraft): ImportedRowPlan[] {
  if (!draft.importMeta?.sourceAdAccountId?.trim()) return [];
  const plans: ImportedRowPlan[] = [];
  for (const adSet of draft.adSetSuggestions) {
    const refs = refsForImportedAdSet(draft, adSet);
    if (refs.length === 0) continue;
    const interestGroupId = recoveredInterestGroupId(draft, adSet);
    const keep =
      Boolean(interestGroupId) ||
      adSetHasGeo(adSet) ||
      adSet.sourceType === "page_group";
    plans.push({
      adSetId: adSet.id,
      groupId: refs[0]!.groupId,
      kind: keep ? "lose" : "disable",
      interestGroupId,
      refs,
    });
  }
  return plans;
}

function withRemovedSuffix(sourceName: string): string {
  return sourceName.includes(CUSTOM_AUDIENCE_REMOVED_SUFFIX)
    ? sourceName
    : `${sourceName}${CUSTOM_AUDIENCE_REMOVED_SUFFIX}`;
}

export function accountSwitchImpact(draft: CampaignDraft): AccountSwitchImpact {
  let uploadedAssets = 0;
  for (const creative of draft.creatives) {
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        if (assetBelongsToAccount(asset)) uploadedAssets += 1;
      }
    }
  }
  const audiences = audienceIdsOnDraft(draft).size;
  const plans = classifyImportedCustomAudiences(draft);
  const adSetsLosingCustomAudience = plans.filter((plan) => plan.kind === "lose").length;
  const adSetsDisabled = plans.filter((plan) => plan.kind === "disable").length;
  return {
    uploadedAssets,
    audiences,
    adSetsLosingCustomAudience,
    adSetsDisabled,
    needsConfirm:
      uploadedAssets > 0 ||
      audiences > 0 ||
      attachTargetCount(draft) > 0 ||
      adSetsLosingCustomAudience + adSetsDisabled > 0,
  };
}

export function accountSwitchConfirmCopy(
  impact: AccountSwitchImpact,
  oldAccountName: string,
  newAccountName: string,
): string {
  const assets =
    impact.uploadedAssets === 1
      ? "1 uploaded asset"
      : `${impact.uploadedAssets} uploaded assets`;
  const audiences =
    impact.audiences === 1 ? "1 audience" : `${impact.audiences} audiences`;
  const base =
    `Switching ad account removes ${assets} and ${audiences} that belong to ${oldAccountName}. ` +
    `They must be re-uploaded / rebuilt on ${newAccountName}.`;
  const parts: string[] = [];
  if (impact.adSetsLosingCustomAudience > 0) {
    const count = impact.adSetsLosingCustomAudience;
    parts.push(
      count === 1 ? "1 ad set loses a custom audience" : `${count} ad sets lose a custom audience`,
    );
  }
  if (impact.adSetsDisabled > 0) {
    const count = impact.adSetsDisabled;
    parts.push(count === 1 ? "1 ad set disabled" : `${count} ad sets disabled`);
  }
  return parts.length > 0 ? `${base} ${parts.join(", ")}.` : base;
}

function clearAsset(asset: Asset): Asset {
  const keepRegistry = Boolean(asset.registryAssetId);
  return {
    ...asset,
    uploadedUrl: undefined,
    thumbnailUrl: undefined,
    assetHash: undefined,
    videoId: undefined,
    uploadStatus: keepRegistry ? asset.uploadStatus : "pending",
    error: undefined,
  };
}

function clearCreative(creative: AdCreativeDraft): AdCreativeDraft {
  return {
    ...creative,
    assetVariations: creative.assetVariations.map((variation) => ({
      ...variation,
      assets: variation.assets.map(clearAsset),
    })),
  };
}

function clearPageGroup(group: PageAudienceGroup): PageAudienceGroup {
  return {
    ...group,
    customAudienceIds: [],
    engagementAudienceIds: undefined,
    engagementAudiencesByType: undefined,
    engagementAudienceStatuses: [],
    lookalikeAudienceIds: undefined,
  };
}

function clearAudiences(audiences: AudienceSettings): AudienceSettings {
  return {
    ...audiences,
    pageGroups: audiences.pageGroups.map(clearPageGroup),
    customAudienceGroups: [],
    savedAudiences: { audienceIds: [] },
    selectedPagesLookalikeGroups: [],
    offpixelCustomAudienceIds: [],
  };
}

function withAccount(draft: CampaignDraft, nextAdAccountId: string): CampaignDraft {
  return {
    ...draft,
    settings: {
      ...draft.settings,
      adAccountId: nextAdAccountId,
      metaAdAccountId: nextAdAccountId,
      pixelId: undefined,
      metaPixelId: undefined,
    },
  };
}

/**
 * Draft-only. Nothing is deleted on Meta.
 * Cancel returns the same object. A draft with nothing account-scoped still
 * switches the account and clears the pixel, and leaves creatives and
 * audiences untouched.
 */
function markForeignGroups(
  groups: readonly CustomAudienceGroup[],
  plans: readonly ImportedRowPlan[],
  sourceAccountId: string,
): CustomAudienceGroup[] {
  const byGroup = new Map<string, ImportedCaRef[]>();
  for (const plan of plans) {
    const list = byGroup.get(plan.groupId) ?? [];
    list.push(...plan.refs);
    byGroup.set(plan.groupId, list);
  }
  const source = actLabel(sourceAccountId);
  return groups.map((group) => {
    const refs = byGroup.get(group.id);
    if (!refs?.length) return group;
    const foreignAccountById = { ...group.foreignAccountById };
    for (const ref of refs) foreignAccountById[ref.id] = source;
    return { ...group, foreignAccountById };
  });
}

function preservedCustomGroups(
  draft: CampaignDraft,
  groups: readonly CustomAudienceGroup[],
): CustomAudienceGroup[] {
  const referenced = new Set(
    draft.adSetSuggestions
      .filter(
        (adSet) =>
          adSet.importedFromAdSetId &&
          (adSet.sourceType === "custom_group" || adSet.sourceType === "custom_group_lookalike") &&
          adSet.sourceId,
      )
      .map((adSet) => adSet.sourceId),
  );
  return groups.filter(
    (group) =>
      referenced.has(group.id) ||
      Object.keys(group.foreignAccountById ?? {}).length > 0,
  );
}

function applyImportedAdSetPlans(
  adSets: readonly AdSetSuggestion[],
  plans: readonly ImportedRowPlan[],
  sourceAccountId: string,
  nextAccountName: string,
): AdSetSuggestion[] {
  const byId = new Map(plans.map((plan) => [plan.adSetId, plan]));
  return adSets.map((adSet) => {
    const plan = byId.get(adSet.id);
    if (!plan) return adSet;
    if (plan.kind === "disable") {
      return {
        ...adSet,
        enabled: false,
        sourceName: customAudienceUnavailableSubtitle(sourceAccountId, nextAccountName),
      };
    }
    const next: AdSetSuggestion = {
      ...adSet,
      sourceName: withRemovedSuffix(adSet.sourceName),
    };
    if (plan.interestGroupId) {
      next.sourceType = "interest_group";
      next.sourceId = plan.interestGroupId;
    }
    return next;
  });
}

function appendRemovedAudiences(
  meta: MetaImportMeta,
  plans: readonly ImportedRowPlan[],
): MetaImportMeta {
  const seen = new Set(meta.notCarried.map((row) => `${row.id}:${row.reason}`));
  const added: MetaImportNotCarried[] = [];
  for (const plan of plans) {
    for (const ref of plan.refs) {
      const key = `${ref.id}:custom_audience_other_account`;
      if (seen.has(key)) continue;
      seen.add(key);
      added.push({ id: ref.id, name: ref.name, reason: "custom_audience_other_account" });
    }
  }
  if (added.length === 0) return meta;
  return { ...meta, notCarried: [...meta.notCarried, ...added] };
}

export function commitAccountSwitch(
  draft: CampaignDraft,
  nextAdAccountId: string,
  decision: "confirm" | "cancel",
  options?: AccountSwitchOptions,
): CampaignDraft {
  if (decision === "cancel") return draft;
  const next = nextAdAccountId.trim();
  if (!next) return draft;
  const current = draft.settings.metaAdAccountId || draft.settings.adAccountId || "";
  if (withoutActPrefix(next) === withoutActPrefix(current)) return draft;

  const switched = withAccount(draft, next);
  if (!accountSwitchImpact(draft).needsConfirm) return switched;

  const plans = classifyImportedCustomAudiences(draft);
  const source = draft.importMeta?.sourceAdAccountId?.trim() ?? "";
  const nextName = options?.nextAccountName?.trim() || actLabel(next);
  const marked = markForeignGroups(draft.audiences.customAudienceGroups, plans, source);
  return {
    ...switched,
    settings: {
      ...switched.settings,
      existingMetaCampaign: undefined,
      existingMetaCampaigns: undefined,
      existingMetaAdSet: undefined,
      existingMetaAdSets: undefined,
    },
    creatives: draft.creatives.map(clearCreative),
    audiences: {
      ...clearAudiences(draft.audiences),
      customAudienceGroups: preservedCustomGroups(draft, marked),
    },
    adSetSuggestions: applyImportedAdSetPlans(draft.adSetSuggestions, plans, source, nextName),
    importMeta: draft.importMeta ? appendRemovedAudiences(draft.importMeta, plans) : draft.importMeta,
  };
}
