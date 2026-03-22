/**
 * lib/meta/adset.ts
 *
 * Pure-logic helpers for ad set creation:
 *   - Optimization goal mapping  (internal → Meta API enum)
 *   - Billing event mapping
 *   - Audience → Meta targeting spec conversion
 *   - Payload validation
 *
 * No API calls here — import createMetaAdSets from lib/meta/client.ts.
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/adsets/
 */

import type {
  OptimisationGoal,
  CampaignObjective,
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
} from "@/lib/types";

// ─── Optimization goal mapping ────────────────────────────────────────────────
//
// Internal goal           Meta optimization_goal
// ─────────────────────────────────────────────────────────────────────
// conversions          →  OFFSITE_CONVERSIONS
// value                →  VALUE
// complete_registration→  OFFSITE_CONVERSIONS  (+ promoted_object COMPLETE_REGISTRATION)
// landing_page_views   →  LANDING_PAGE_VIEWS
// link_clicks          →  LINK_CLICKS
// reach                →  REACH
// impressions          →  IMPRESSIONS
// post_engagement      →  POST_ENGAGEMENT
// video_views          →  THRUPLAY

export const OPTIMISATION_GOAL_MAP: Record<OptimisationGoal, string> = {
  conversions: "OFFSITE_CONVERSIONS",
  value: "VALUE",
  complete_registration: "OFFSITE_CONVERSIONS",
  landing_page_views: "LANDING_PAGE_VIEWS",
  link_clicks: "LINK_CLICKS",
  reach: "REACH",
  impressions: "IMPRESSIONS",
  post_engagement: "POST_ENGAGEMENT",
  video_views: "THRUPLAY",
} as const;

export function mapOptimisationGoal(goal: OptimisationGoal): string {
  return OPTIMISATION_GOAL_MAP[goal] ?? "IMPRESSIONS";
}

// billing_event is IMPRESSIONS for virtually all ad types.
// Meta only allows LINK_CLICKS billing for traffic campaigns with link_clicks goal.
export function mapBillingEvent(_goal: OptimisationGoal): "IMPRESSIONS" {
  return "IMPRESSIONS";
}

// ─── Meta targeting types ─────────────────────────────────────────────────────

export interface MetaGeoLocations {
  countries?: string[];
  cities?: { key: string; radius?: number; distance_unit?: "mile" | "kilometer" }[];
  regions?: { key: string }[];
}

export interface MetaInterest {
  id: string;
  name?: string;
}

export interface MetaCustomAudience {
  id: string;
}

export interface MetaTargeting {
  age_min: number;
  age_max: number;
  genders?: number[]; // 1 = male, 2 = female; omit for all
  geo_locations: MetaGeoLocations;
  interests?: MetaInterest[];
  custom_audiences?: MetaCustomAudience[];
  excluded_custom_audiences?: MetaCustomAudience[];
  targeting_automation?: { advantage_audience: 0 | 1 };
}

export interface MetaPromotedObject {
  pixel_id?: string;
  custom_event_type?: string;
  page_id?: string;
}

// ─── Ad set payload sent to Meta ─────────────────────────────────────────────

export interface MetaAdSetPayload {
  name: string;
  campaign_id: string;
  /** In the smallest currency unit (pence / cents) */
  daily_budget?: number;
  lifetime_budget?: number;
  billing_event: string;
  optimization_goal: string;
  targeting: MetaTargeting;
  /** Unix timestamp */
  start_time: number;
  /** Unix timestamp (required for lifetime budget) */
  end_time?: number;
  status: "PAUSED" | "ACTIVE";
  promoted_object?: MetaPromotedObject;
}

// ─── Route request / response types ──────────────────────────────────────────

export interface CreateAdSetsRequest {
  metaAdAccountId: string;
  metaCampaignId: string;
  optimisationGoal: OptimisationGoal;
  objective: CampaignObjective;
  pixelId?: string;
  budgetSchedule: BudgetScheduleSettings;
  audiences: AudienceSettings;
  /** Only enabled ad sets should be passed */
  adSetSuggestions: AdSetSuggestion[];
}

export interface CreateAdSetResult {
  name: string;
  metaAdSetId: string;
}

export interface CreateAdSetsResult {
  created: CreateAdSetResult[];
  failed: { name: string; error: string }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the string looks like a real Meta numeric ID (10+ digits).
 * Mock IDs like "int1", "ca2" will return false so they're safely skipped.
 */
function isRealMetaId(id: string): boolean {
  return /^\d{10,}$/.test(id);
}

/**
 * Convert a YYYY-MM-DD date string to a Unix timestamp (seconds).
 * Treats the date as midnight UTC — timezone awareness is a Phase 5 TODO.
 */
function toUnixTs(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
}

// ─── Targeting builder ────────────────────────────────────────────────────────

/**
 * Build the Meta targeting spec for a single ad set suggestion.
 *
 * Audience resolution:
 *   sourceType = "interest_group"  → look up interestGroups by sourceId, map interests
 *   sourceType = "custom_group"    → look up customAudienceGroups by sourceId, map audiences
 *   sourceType = "page_group"      → look up pageGroups by sourceId, map customAudienceIds
 *   sourceType = "saved_audience"  → no additional targeting (saved audience ID is applied
 *                                    via custom_audiences when a real Meta ID exists)
 *
 * Geo-location note:
 *   AdSetSuggestion and BudgetScheduleSettings do not yet carry a location field.
 *   Defaulting to { countries: ["GB"] } until location targeting is wired in Phase 5.
 *
 * Interest / custom-audience IDs:
 *   Mock IDs ("int1", "ca2") are filtered out. Only real numeric Meta IDs (10+ digits)
 *   are included. Until real IDs are fetched via the Meta /search API, the ad set
 *   will be created with broad targeting only.
 */
export function buildMetaTargeting(
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
): MetaTargeting {
  const targeting: MetaTargeting = {
    age_min: adSet.ageMin,
    age_max: adSet.ageMax,
    // Default to all genders — the wizard does not yet collect gender targeting
    genders: [1, 2],
    // TODO Phase 5: wire location from AdSetSuggestion or BudgetScheduleSettings
    geo_locations: { countries: ["GB"] },
  };

  if (adSet.advantagePlus) {
    targeting.targeting_automation = { advantage_audience: 1 };
  }

  switch (adSet.sourceType) {
    case "interest_group": {
      const group = audiences.interestGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const realInterests = group.interests
          .filter((i) => isRealMetaId(i.id))
          .map((i) => ({ id: i.id, name: i.name }));
        if (realInterests.length > 0) targeting.interests = realInterests;
      }
      break;
    }

    case "custom_group": {
      const group = audiences.customAudienceGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const realIds = group.audienceIds.filter(isRealMetaId);
        if (realIds.length > 0) {
          targeting.custom_audiences = realIds.map((id) => ({ id }));
        }
      }
      break;
    }

    case "page_group": {
      // Page groups may carry additional custom audience IDs for warm targeting
      const group = audiences.pageGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const realIds = group.customAudienceIds.filter(isRealMetaId);
        if (realIds.length > 0) {
          targeting.custom_audiences = realIds.map((id) => ({ id }));
        }
      }
      break;
    }

    case "saved_audience": {
      // The saved audience ID itself is used as a custom audience when real
      const realId = isRealMetaId(adSet.sourceId) ? adSet.sourceId : null;
      if (realId) targeting.custom_audiences = [{ id: realId }];
      break;
    }
  }

  return targeting;
}

// ─── Promoted object builder ──────────────────────────────────────────────────

/**
 * OFFSITE_CONVERSIONS and VALUE goals require a promoted_object with a pixel.
 * Maps the internal objective to the Meta custom_event_type.
 */
export function buildPromotedObject(
  goal: OptimisationGoal,
  objective: CampaignObjective,
  pixelId?: string,
): MetaPromotedObject | undefined {
  if (!pixelId) return undefined;

  const needsConversionEvent =
    goal === "conversions" || goal === "value" || goal === "complete_registration";

  if (!needsConversionEvent) return undefined;

  const eventTypeMap: Partial<Record<CampaignObjective, string>> = {
    purchase: "PURCHASE",
    registration: "COMPLETE_REGISTRATION",
  };

  return {
    pixel_id: pixelId,
    custom_event_type: eventTypeMap[objective] ?? "PURCHASE",
  };
}

// ─── Full payload builder ─────────────────────────────────────────────────────

export function buildAdSetPayload(
  adSet: AdSetSuggestion,
  campaignId: string,
  audiences: AudienceSettings,
  budgetSchedule: BudgetScheduleSettings,
  optimisationGoal: OptimisationGoal,
  objective: CampaignObjective,
  pixelId?: string,
): MetaAdSetPayload {
  const dailyBudgetCents = Math.round(adSet.budgetPerDay * 100);

  const payload: MetaAdSetPayload = {
    name: adSet.name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetCents,
    billing_event: mapBillingEvent(optimisationGoal),
    optimization_goal: mapOptimisationGoal(optimisationGoal),
    targeting: buildMetaTargeting(adSet, audiences),
    start_time: budgetSchedule.startDate
      ? toUnixTs(budgetSchedule.startDate)
      : Math.floor(Date.now() / 1000) + 60, // default: 1 minute from now
    status: "PAUSED",
  };

  if (budgetSchedule.endDate) {
    payload.end_time = toUnixTs(budgetSchedule.endDate);
  }

  const promotedObject = buildPromotedObject(optimisationGoal, objective, pixelId);
  if (promotedObject) payload.promoted_object = promotedObject;

  return payload;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateAdSetPayloads(adSets: AdSetSuggestion[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (adSets.length === 0) {
    errors.push("No enabled ad sets to create");
  }

  adSets.forEach((s, i) => {
    const label = s.name || `Ad Set #${i + 1}`;
    if (!s.name?.trim()) errors.push(`${label}: name is required`);
    if (!s.budgetPerDay || s.budgetPerDay <= 0) {
      errors.push(`${label}: daily budget must be greater than 0`);
    }
    if (s.ageMin >= s.ageMax) {
      errors.push(`${label}: age_min (${s.ageMin}) must be less than age_max (${s.ageMax})`);
    }
  });

  return { isValid: errors.length === 0, errors };
}
