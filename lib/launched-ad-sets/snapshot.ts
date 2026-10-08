/**
 * Launch-time audience descriptor. A snapshot, not a pointer — the
 * draft's InterestGroup will be edited later and this row must still
 * say what was launched.
 */

import { deriveCampaignPlanPhase, type CampaignPlanPhase } from "../plan/phase.ts";
import { mapMetaObjectiveToInternal, SALES_FAMILY } from "../meta/campaign.ts";
import { resolveAdSetGeoLocations } from "../meta/location-targeting.ts";
import type {
  AdSetGeoLocations,
  AdSetSuggestion,
  AudienceSettings,
  CampaignObjective,
  InterestGroup,
  LocationSelection,
  LocationTargetingGroup,
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

/**
 * Write `resolveAdSetGeoLocations` onto the suggestion at launch. The
 * four-rule precedence is unchanged — this is a snapshot of its output, so
 * a later picker edit cannot rewrite `launched_ad_sets.geo`.
 */
export function stampLaunchGeo(
  suggestion: AdSetSuggestion,
  locationGroups: LocationTargetingGroup[] | undefined,
  excludedLocations?: LocationSelection[],
): AdSetSuggestion {
  return {
    ...suggestion,
    geoLocations: resolveAdSetGeoLocations(suggestion, locationGroups, excludedLocations),
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

const ON_SALE_OBJECTIVES: ReadonlySet<string> = new Set<CampaignObjective>([
  "purchase",
  "initiate_checkout",
  "traffic",
  "awareness",
  "engagement",
]);

/**
 * launched_ad_sets.phase_at_launch. Matas, 2026-10-08: "this should be
 * automatically known from the objective of a campaign. If it's a
 * complete reg then it's a presale phase, if it's traffic / purchase
 * conversion / awareness then it's an on sale phase."
 *
 * 'registration' (Complete Registration) → 'presale'; purchase,
 * initiate_checkout, traffic, awareness, engagement → 'on_sale'; a
 * missing or unknown objective → null, never a guess. The event calendar
 * does not enter: a registration ad set launched after general sale is
 * still presale.
 */
export function phaseAtLaunchFromObjective(
  objective: CampaignObjective | string | null | undefined,
): CampaignPlanPhase | null {
  const o = (objective ?? "").trim().toLowerCase();
  if (o === "registration") return "presale";
  if (ON_SALE_OBJECTIVES.has(o)) return "on_sale";
  return null;
}

const META_CONVERSION_GOALS: ReadonlySet<string> = new Set(["OFFSITE_CONVERSIONS", "VALUE"]);

/**
 * True when `phaseFromMetaObjective` cannot decide without the ad set's
 * promoted event: a sales-family conversion ad set. Every other ad set
 * is staged from objective and goal alone, so its promoted_object is
 * never read.
 */
export function metaObjectiveNeedsPromotedEvent(
  campaignObjective: string | null | undefined,
  optimizationGoal: string | null | undefined,
): boolean {
  const objective = (campaignObjective ?? "").trim().toUpperCase();
  const goal = (optimizationGoal ?? "").trim().toUpperCase();
  return SALES_FAMILY.has(objective) && (!goal || META_CONVERSION_GOALS.has(goal));
}

/**
 * The same rule as `phaseAtLaunchFromObjective`, for an ad set the app
 * did not launch, from what Meta reports on ad_daily_insights (migration
 * 187): the campaign objective, the ad set's optimization_goal and its
 * promoted_object.custom_event_type.
 *
 * - COMPLETE_REGISTRATION promoted event → presale.
 * - Leads → presale: a LEAD promoted event, a LEAD_GENERATION goal, or an
 *   OUTCOME_LEADS / LEAD_GENERATION objective. In practice leads campaigns
 *   are sign-up campaigns (Parable's DONDIABLO runs on leads). This is a
 *   reading of Matas's rule, not part of it; overrule here.
 * - Every other objective `mapMetaObjectiveToInternal` knows → on_sale:
 *   OUTCOME_SALES / CONVERSIONS with PURCHASE, INITIATED_CHECKOUT or
 *   another event, OUTCOME_TRAFFIC / LINK_CLICKS, OUTCOME_AWARENESS /
 *   REACH / BRAND_AWARENESS, OUTCOME_ENGAGEMENT / POST_ENGAGEMENT /
 *   VIDEO_VIEWS.
 * - Null, never a guess: an unknown objective, or a sales-family
 *   conversion ad set whose promoted event is not known yet. Under
 *   OUTCOME_SALES, OFFSITE_CONVERSIONS is the goal for Complete
 *   Registration and Purchase alike (probe, 2026-10-08).
 */
export function phaseFromMetaObjective(input: {
  campaignObjective: string | null | undefined;
  optimizationGoal: string | null | undefined;
  promotedEvent: string | null | undefined;
}): CampaignPlanPhase | null {
  const objective = (input.campaignObjective ?? "").trim().toUpperCase();
  const goal = (input.optimizationGoal ?? "").trim().toUpperCase();
  const event = (input.promotedEvent ?? "").trim().toUpperCase();
  if (event === "COMPLETE_REGISTRATION" || event === "LEAD" || goal === "LEAD_GENERATION") return "presale";
  if (!objective) return null;
  if (!event && metaObjectiveNeedsPromotedEvent(objective, goal)) return null;
  return phaseAtLaunchFromObjective(mapMetaObjectiveToInternal(objective, event || null) ?? null);
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
