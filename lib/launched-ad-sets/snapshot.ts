/**
 * Launch-time audience descriptor. A snapshot, not a pointer — the
 * draft's InterestGroup will be edited later and this row must still
 * say what was launched.
 */

import { deriveCampaignPlanPhase, type CampaignPlanPhase } from "../plan/phase.ts";
import type {
  AdSetGeoLocations,
  AdSetSuggestion,
  AudienceSettings,
  InterestGroup,
} from "../types.ts";

export type DescriptorSource = "launch" | "backfill_from_launch_summary";

export type LaunchedAdSetChannel = "meta" | "tiktok" | "google";

export type AudienceDescriptor = {
  sourceType: string;
  sourceId: string;
  sourceName: string;
  ageMin: number;
  ageMax: number;
  lookalikeRange: string | null;
  geo: AdSetGeoLocations | null;
  advantagePlus: boolean;
  interestIds: string[] | null;
  suggestionId: string;
  initialDailyBudgetPence: number;
};

export function interestIdsFromGroup(group: InterestGroup | undefined): string[] {
  if (!group) return [];
  const ids: string[] = [];
  for (const interest of group.interests ?? []) {
    const id = interest.replacement?.id?.trim() || interest.id?.trim();
    if (id) ids.push(id);
  }
  return ids;
}

export function snapshotAudienceDescriptor(
  suggestion: AdSetSuggestion,
  audiences: AudienceSettings | null | undefined,
): AudienceDescriptor {
  const group =
    suggestion.sourceType === "interest_group"
      ? audiences?.interestGroups.find((item) => item.id === suggestion.sourceId)
      : undefined;
  const budget = Number(suggestion.budgetPerDay);
  return {
    sourceType: suggestion.sourceType,
    sourceId: suggestion.sourceId,
    sourceName: suggestion.sourceName,
    ageMin: suggestion.ageMin,
    ageMax: suggestion.ageMax,
    lookalikeRange: suggestion.lookalikeRange ?? null,
    geo: suggestion.geoLocations ?? null,
    advantagePlus: suggestion.advantagePlus === true,
    interestIds:
      suggestion.sourceType === "interest_group"
        ? group
          ? interestIdsFromGroup(group)
          : null
        : null,
    suggestionId: suggestion.id,
    initialDailyBudgetPence: Number.isFinite(budget) ? Math.round(budget * 100) : 0,
  };
}

/** What Meta accepted. 1870196 salvage strips Advantage+ and sends explicit ages. */
export function effectiveAdvantagePlus(
  asked: boolean,
  ageModeOverride?: "strict" | null,
): boolean {
  if (ageModeOverride === "strict") return false;
  return asked === true;
}

export function joinLaunchNotes(
  ...notes: Array<string | null | undefined>
): string | null {
  const parts = notes.map((note) => note?.trim()).filter((note): note is string => Boolean(note));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Same derivation as campaign_plans.phase / eligibility — do not invent another. */
export function phaseAtLaunchFromEvent(input: {
  launchedAt: Date;
  presaleAt: string | null;
  generalSaleAt: string | null;
  soldOutAt: string | null;
}): CampaignPlanPhase | null {
  return deriveCampaignPlanPhase({
    startDate: input.launchedAt.toISOString().slice(0, 10),
    presaleAt: input.presaleAt,
    generalSaleAt: input.generalSaleAt,
    soldOutAt: input.soldOutAt,
  });
}
