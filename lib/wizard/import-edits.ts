/**
 * Edits an operator makes to a draft read from a live Meta campaign:
 * add audiences, change the objective, change the URLs. The draft is a
 * new campaign at launch; nothing here reads or writes the source.
 */

import { buildPromotedObject, resolveOptimisationGoal } from "../meta/adset.ts";
import { shortLocationLabel } from "./adset-suggestions.ts";
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

export const AUDIENCE_REMOVED_SUBTITLE = "audience removed";

/**
 * Imported rows stay as they are when the operator adds an audience on
 * the Audiences step. That step writes `draft.audiences` and never touches
 * Step 5. Generate is the only action that rebuilds the ad set list, and
 * it replaces every row — imported, blank, and operator-edited.
 */

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

export function generateRebuiltNotice(nextCount: number, previousCount: number): string {
  const noun = nextCount === 1 ? "ad set" : "ad sets";
  return `Generate rebuilt ${nextCount} ${noun} from the current audiences. Undo to restore the previous ${previousCount}.`;
}

export function generateReplaceImportedConfirm(importedCount: number): string {
  const noun = importedCount === 1 ? "ad set" : "ad sets";
  return `Generate replaces the ${importedCount} imported ${noun} with rows built from the current audiences. Undo is available for 5 seconds.`;
}

/** The first Generate on a draft that still has imported rows asks once. */
export function generateNeedsImportedConfirm(
  adSets: readonly AdSetSuggestion[],
  confirmed: boolean | undefined,
): boolean {
  if (confirmed) return false;
  return adSets.some((adSet) => Boolean(adSet.importedFromAdSetId));
}

/** Daily figures from `generateSuggestions` become the lifetime share. */
export function withLifetimeAdSetBudgets(rows: readonly AdSetSuggestion[]): AdSetSuggestion[] {
  return rows.map((row) => ({ ...row, budgetLifetime: row.budgetPerDay, budgetPerDay: 0 }));
}

const RANGE_LABELS: Record<LookalikeRange, string> = {
  "0-1%": "1%",
  "1-2%": "2%",
  "2-3%": "3%",
};

const LOOKALIKE_RANGES: readonly LookalikeRange[] = ["0-1%", "1-2%", "2-3%"];

function lookalikeRangeOf(adSet: AdSetSuggestion): LookalikeRange | undefined {
  if (adSet.lookalikeRange) return adSet.lookalikeRange;
  if (
    adSet.sourceType !== "lookalike_group" &&
    adSet.sourceType !== "custom_group_lookalike" &&
    adSet.sourceType !== "selected_pages_lookalike"
  ) {
    return undefined;
  }
  return LOOKALIKE_RANGES.find((range) => adSet.id.includes(`_${range}`));
}

/**
 * The group's current name, plus the lookalike percentage when this row
 * is one range of that group. Null when the row has no group (blank) or
 * the group is gone.
 */
function currentGroupLabel(
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
): { name: string; detail: string } | null {
  const range = lookalikeRangeOf(adSet);
  const pct = range ? RANGE_LABELS[range] : "";
  switch (adSet.sourceType) {
    case "page_group": {
      const group = audiences.pageGroups.find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Page Group";
      return { name, detail: `${name} (${group.pageIds.length} pages)` };
    }
    case "lookalike_group": {
      const group = audiences.pageGroups.find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Page Group";
      return {
        name: pct ? `${name} — ${pct} Lookalike` : name,
        detail: pct ? `${name} ${pct} Lookalike` : name,
      };
    }
    case "custom_group": {
      const group = audiences.customAudienceGroups.find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Custom Audiences";
      return { name, detail: `${name} (${group.audienceIds.length} audiences)` };
    }
    case "custom_group_lookalike": {
      const group = audiences.customAudienceGroups.find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Custom Audiences";
      return {
        name: pct ? `${name} — ${pct} Lookalike` : name,
        detail: pct ? `${name} ${pct} Lookalike` : name,
      };
    }
    case "interest_group": {
      const group = audiences.interestGroups.find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Interest Group";
      return { name, detail: `${name} (${group.interests.length} interests)` };
    }
    case "selected_pages_lookalike": {
      const group = (audiences.selectedPagesLookalikeGroups ?? []).find((row) => row.id === adSet.sourceId);
      if (!group) return null;
      const name = group.name || "Selected Pages";
      return {
        name: pct ? `${name} — ${pct} Lookalike` : name,
        detail: pct ? `${name} (${group.selectedPageIds.length} pages, ${pct})` : name,
      };
    }
    default:
      return null;
  }
}

function withTierSuffix(name: string, adSet: AdSetSuggestion): string {
  if (adSet.locationTier === "primary") return `${name} — Primary`;
  if (adSet.locationTier === "secondary") return `${name} — Secondary`;
  return name;
}

/**
 * The name Step 5 shows and the name launch sends. An operator-typed
 * name, including a city the operator chose by splitting or picking one
 * location, stays the stored name. Any other row uses the source group's
 * current name. A stored name that is only that group name plus a
 * location suffix keeps the suffix on the current group name. The stored
 * `name` is not rewritten here.
 */
export function adSetDisplayName(adSet: AdSetSuggestion, audiences: AudienceSettings): string {
  if (adSet.nameSource === "operator") return adSet.name;
  const group = currentGroupLabel(adSet, audiences);
  if (!group) return adSet.name;
  const city = adSet.locationLabel ? shortLocationLabel(adSet.locationLabel) : null;
  if (city && !adSet.locationTier && adSet.name.endsWith(` — ${city}`)) {
    return `${group.name} — ${city}`;
  }
  return withTierSuffix(group.name, adSet);
}

/** The muted line under the name. A missing audience stays "audience removed". */
export function adSetDisplaySubtitle(adSet: AdSetSuggestion, audiences: AudienceSettings): string {
  if (adSetAudienceRemoved(adSet, audiences)) return AUDIENCE_REMOVED_SUBTITLE;
  return currentGroupLabel(adSet, audiences)?.detail ?? adSet.sourceName;
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
