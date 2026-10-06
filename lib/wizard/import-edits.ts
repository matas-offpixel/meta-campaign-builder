/**
 * Edits an operator makes to a draft read from a live Meta campaign:
 * add audiences, change the objective, change the URLs. The draft is a
 * new campaign at launch; nothing here reads or writes the source.
 */

import { buildPromotedObject, resolveOptimisationGoal } from "../meta/adset.ts";
import { geoHasNoIncludedArea, resolveAdSetGeoLocations } from "../meta/location-targeting.ts";
import type {
  AdCreativeDraft,
  AdSetSuggestion,
  AudienceSettings,
  CampaignDraft,
  CampaignObjective,
  LookalikeRange,
} from "../types.ts";
import { isCustomAudienceUnavailableSubtitle } from "./account-switch.ts";

export const IMPORTED_AD_SET_BADGE = "imported";

export function importedAdSetTitle(sourceAdSetId: string): string {
  return `Read from live ad set ${sourceAdSetId}. Launch creates it as a new ad set.`;
}

export const IMPORT_OBJECTIVE_NEW_CAMPAIGN_NOTICE =
  "Launching creates a new campaign. The source campaign keeps running and keeps spending — pause it in Ads Manager if this replaces it.";

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  registration: "Registration",
  purchase: "Purchase",
  initiate_checkout: "Initiate checkout",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

export function isImportedAdSet(adSet: AdSetSuggestion): boolean {
  return Boolean(adSet.importedFromAdSetId);
}

/**
 * An imported row that resolves to a place and an age range. Broad and
 * Advantage+ ad sets carry nothing else, and Meta delivers them as they are.
 */
export function importedAdSetCarriesTargeting(
  adSet: AdSetSuggestion,
  draft: Pick<CampaignDraft, "budgetSchedule">,
): boolean {
  if (!isImportedAdSet(adSet)) return false;
  if (!Number.isFinite(adSet.ageMin) || !Number.isFinite(adSet.ageMax)) return false;
  const geo = resolveAdSetGeoLocations(
    adSet,
    draft.budgetSchedule.locationGroups,
    draft.budgetSchedule.excludedLocations,
  );
  return geo != null && !geoHasNoIncludedArea(geo);
}

/** The imported ad sets are the audience definition, as live ad sets are in attach mode. */
export function importedAdSetsDefineAudience(
  draft: Pick<CampaignDraft, "adSetSuggestions" | "budgetSchedule">,
): boolean {
  return draft.adSetSuggestions.some((adSet) => importedAdSetCarriesTargeting(adSet, draft));
}

function audienceKey(adSet: AdSetSuggestion): string {
  return `${adSet.sourceType}:${adSet.sourceId}`;
}

export const AUDIENCE_REMOVED_SUBTITLE = "audience removed";

function rangeStillSelected(
  ranges: readonly LookalikeRange[] | undefined,
  range: LookalikeRange | undefined,
): boolean {
  if (!range) return true;
  return (ranges ?? []).includes(range);
}

/**
 * The same group lookup `buildMetaTargeting` uses. A blank row has no
 * audience. A lookalike row also requires its percentage range, when the
 * row records one, to still be selected on that group.
 */
export function adSetSourceExists(
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
): boolean {
  switch (adSet.sourceType) {
    case "blank":
      return true;
    case "page_group":
      return audiences.pageGroups.some((group) => group.id === adSet.sourceId);
    case "lookalike_group": {
      const group = audiences.pageGroups.find((row) => row.id === adSet.sourceId);
      return Boolean(group) && rangeStillSelected(group?.lookalikeRanges, adSet.lookalikeRange);
    }
    case "custom_group":
      return audiences.customAudienceGroups.some((group) => group.id === adSet.sourceId);
    case "custom_group_lookalike": {
      const group = audiences.customAudienceGroups.find((row) => row.id === adSet.sourceId);
      return Boolean(group) && rangeStillSelected(group?.lookalikeRanges, adSet.lookalikeRange);
    }
    case "interest_group":
      return audiences.interestGroups.some((group) => group.id === adSet.sourceId);
    case "saved_audience":
      return audiences.savedAudiences.audienceIds.includes(adSet.sourceId);
    case "selected_pages_lookalike": {
      const group = (audiences.selectedPagesLookalikeGroups ?? []).find((row) => row.id === adSet.sourceId);
      return Boolean(group) && rangeStillSelected(group?.lookalikeRanges, adSet.lookalikeRange);
    }
    default:
      return false;
  }
}

/**
 * The row's audience is gone, or account switch disabled it because the
 * custom audience cannot move. Both render the same subtitle and are not sent.
 */
export function adSetAudienceRemoved(
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
): boolean {
  if (adSet.sourceType === "blank") return false;
  if (!adSetSourceExists(adSet, audiences)) return true;
  return isCustomAudienceUnavailableSubtitle(adSet.sourceName);
}

export function adSetsSkippedForMissingAudience(
  adSets: readonly AdSetSuggestion[],
  audiences: AudienceSettings,
): AdSetSuggestion[] {
  return adSets.filter((adSet) => adSetAudienceRemoved(adSet, audiences));
}

export function skippedAudienceReviewLine(count: number): string {
  const noun = count === 1 ? "ad set" : "ad sets";
  return `${count} ${noun} skipped — audience no longer on draft`;
}

export function generateRemovedNotice(count: number): string {
  const noun = count === 1 ? "ad set" : "ad sets";
  return `Generate removed ${count} ${noun} whose audiences are no longer on this draft.`;
}

/**
 * Generate makes the suggestion list match the audiences on the draft.
 * A row whose source group is gone is dropped, imported or not. A row whose
 * group is still there is kept as it is. A group with no row gets one
 * generated row. Blank rows stay.
 */
export function mergeGeneratedWithImported(
  existing: readonly AdSetSuggestion[],
  generated: readonly AdSetSuggestion[],
  audiences: AudienceSettings,
): { suggestions: AdSetSuggestion[]; removed: number } {
  const kept = existing.filter((adSet) => adSetSourceExists(adSet, audiences));
  const covered = new Set(kept.filter((adSet) => adSet.sourceId).map(audienceKey));
  const taken = new Set(kept.map((adSet) => adSet.id));
  const added = generated.filter(
    (adSet) => !(adSet.sourceId && covered.has(audienceKey(adSet))) && !taken.has(adSet.id),
  );
  return { suggestions: [...kept, ...added], removed: existing.length - kept.length };
}

/**
 * Changing the ad account never blocks. Imported custom audiences are
 * converted in `commitAccountSwitch`; this stays so older callers compile.
 */
export function importedAccountProblem(_draft: CampaignDraft): string | null {
  return null;
}

const PIXEL_PROBE = "pixel";

/**
 * The launch builds `promoted_object` from the objective, goal and pixel.
 * With no pixel it silently omits it, which Meta rejects or optimises for
 * nothing. This names that case. It proves a pixel is configured, not that
 * the pixel has fired the event.
 */
export function objectivePixelProblem(draft: CampaignDraft): string | null {
  const objective = draft.settings.objective;
  if (!objective) return null;
  const goal = resolveOptimisationGoal(draft.settings.optimisationGoal, objective);
  const needsEvent = buildPromotedObject(goal, objective, PIXEL_PROBE) !== undefined;
  if (!needsEvent) return null;
  const pixel = draft.settings.metaPixelId || draft.settings.pixelId || undefined;
  if (buildPromotedObject(goal, objective, pixel)) return null;
  return `${OBJECTIVE_LABELS[objective]} optimises for a pixel conversion event: no pixel configured for this ad account.`;
}

export function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Patch every creative's `destinationUrl`, imported rows included. */
export function setEveryCreativeDestinationUrl(
  creatives: readonly AdCreativeDraft[],
  url: string,
): AdCreativeDraft[] {
  const next = url.trim();
  return creatives.map((creative) =>
    creative.destinationUrl === next ? creative : { ...creative, destinationUrl: next },
  );
}

export function setEveryCreativeUrlLine(count: number): string {
  return `Set every creative (${count})`;
}
