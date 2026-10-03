import type {
  AdCreativeDraft,
  Asset,
  AudienceSettings,
  CampaignDraft,
  PageAudienceGroup,
} from "../types.ts";
import { withoutActPrefix } from "../meta/ad-account-id.ts";

export interface AccountSwitchImpact {
  uploadedAssets: number;
  audiences: number;
  needsConfirm: boolean;
}

function isMetaAudienceId(id: string | undefined): id is string {
  return !!id && /^\d{10,}$/.test(id);
}

function assetBelongsToAccount(asset: Asset): boolean {
  return Boolean(
    asset.assetHash ||
      asset.videoId ||
      asset.uploadedUrl ||
      asset.thumbnailUrl ||
      asset.registryAssetId ||
      asset.uploadStatus === "uploaded",
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
  return {
    uploadedAssets,
    audiences,
    needsConfirm: uploadedAssets > 0 || audiences > 0 || attachTargetCount(draft) > 0,
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
  return (
    `Switching ad account removes ${assets} and ${audiences} that belong to ${oldAccountName}. ` +
    `They must be re-uploaded / rebuilt on ${newAccountName}.`
  );
}

function clearAsset(asset: Asset): Asset {
  return {
    ...asset,
    uploadedUrl: undefined,
    thumbnailUrl: undefined,
    assetHash: undefined,
    videoId: undefined,
    registryAssetId: undefined,
    uploadStatus: "pending",
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
export function commitAccountSwitch(
  draft: CampaignDraft,
  nextAdAccountId: string,
  decision: "confirm" | "cancel",
): CampaignDraft {
  if (decision === "cancel") return draft;
  const next = nextAdAccountId.trim();
  if (!next) return draft;
  const current = draft.settings.metaAdAccountId || draft.settings.adAccountId || "";
  if (withoutActPrefix(next) === withoutActPrefix(current)) return draft;

  const switched = withAccount(draft, next);
  if (!accountSwitchImpact(draft).needsConfirm) return switched;
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
    audiences: clearAudiences(draft.audiences),
  };
}
