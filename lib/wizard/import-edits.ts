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
  CampaignDraft,
  CampaignObjective,
} from "../types.ts";

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

/**
 * "Generate" replaces the suggestion list. On an imported draft that list
 * holds the live campaign's ad sets, whose audience groups are also in
 * `draft.audiences` — so generation would both drop them and re-create
 * them as tiered, renamed copies. Imported rows stay exactly as they are;
 * generated rows join them only for audiences no imported row already
 * targets.
 */
export function mergeGeneratedWithImported(
  existing: readonly AdSetSuggestion[],
  generated: readonly AdSetSuggestion[],
): AdSetSuggestion[] {
  const imported = existing.filter(isImportedAdSet);
  if (imported.length === 0) return [...generated];
  const covered = new Set(imported.filter((s) => s.sourceId).map(audienceKey));
  const taken = new Set(imported.map((s) => s.id));
  const added = generated.filter(
    (s) => !(s.sourceId && covered.has(audienceKey(s))) && !taken.has(s.id),
  );
  return [...imported, ...added];
}

function bareAccount(id: string | undefined): string {
  return (id ?? "").trim().replace(/^act_/i, "");
}

/**
 * Custom audiences were checked against the source ad account at import.
 * On another account that check says nothing, and an unshared audience
 * fails at launch.
 */
export function importedAccountProblem(draft: CampaignDraft): string | null {
  const source = draft.importMeta?.sourceAdAccountId;
  if (!source) return null;
  const current = draft.settings.metaAdAccountId || draft.settings.adAccountId;
  if (!current || bareAccount(current) === bareAccount(source)) return null;
  const carried = draft.adSetSuggestions.some(
    (s) => isImportedAdSet(s) && s.sourceType === "custom_group",
  );
  if (!carried) return null;
  return `Custom audiences were checked on ${source} when this campaign was imported. This draft now uses ${current}. Switch back to ${source}, or re-import from ${current}.`;
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
