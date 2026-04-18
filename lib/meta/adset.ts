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

/**
 * London (GB) city + 40 km radius.
 *
 * Meta city key "2421178" = London, England, United Kingdom.
 * Verified via GET /search?type=adgeolocation&q=London&location_types=city&country_code=GB
 *
 * We also include `name` and `country` for deterministic resolution —
 * prevents Meta from mapping the key to the wrong city.
 */
export const GEO_LONDON_40KM: MetaGeoLocations = {
  cities: [{ key: "2421178", radius: 40, distance_unit: "kilometer" }],
};

/** UK nationwide minus a London 40 km exclusion zone. */
export const GEO_UK_EXCL_LONDON: MetaGeoLocations = {
  countries: ["GB"],
};

/** Exclusion zone for UK-excl-London (used separately in excluded_geo_locations). */
export const GEO_LONDON_40KM_EXCLUSION: MetaGeoLocations = {
  cities: [{ key: "2421178", radius: 40, distance_unit: "kilometer" }],
};

export interface MetaInterest {
  id: string;
  name?: string;
}

export interface MetaCustomAudience {
  id: string;
}

export interface MetaTargeting {
  /**
   * Strict minimum age — only sent when Advantage+ is OFF.
   * When Advantage+ is ON, age is passed as a suggestion via
   * targeting_automation.individual_setting instead.
   */
  age_min?: number;
  /**
   * Strict maximum age — only sent when Advantage+ is OFF.
   * Meta rejects values < 65 on Advantage+ ad sets.
   */
  age_max?: number;
  genders?: number[]; // 1 = male, 2 = female; omit for all
  geo_locations: MetaGeoLocations;
  excluded_geo_locations?: MetaGeoLocations;
  interests?: MetaInterest[];
  custom_audiences?: MetaCustomAudience[];
  excluded_custom_audiences?: MetaCustomAudience[];
  targeting_automation?: {
    advantage_audience: 0 | 1;
    /**
     * Age / gender *suggestions* for Advantage+ audience (advantage_audience: 1).
     * Meta uses these as guidance but can expand beyond them.
     * Do NOT combine with strict top-level age_min/age_max when this is set.
     */
    individual_setting?: {
      age_min?: number;
      age_max?: number;
    };
  };
  /**
   * Manual placement control. When present, Meta uses ONLY the listed
   * platforms / positions.  Omit entirely for automatic placements.
   *
   * Values come from `buildPlacementTargeting()` in lib/meta/placements.ts.
   *   publisher_platforms  → ["instagram"] | ["facebook"] | both
   *   instagram_positions  → ["stream","story","reels"]
   *   facebook_positions   → ["feed","reels"]
   */
  publisher_platforms?: string[];
  instagram_positions?: string[];
  facebook_positions?: string[];
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
  /**
   * Must always be set explicitly. Omitting it causes Meta to infer a default
   * strategy that can require bid_amount or bid_constraints.
   *
   * LOWEST_COST_WITHOUT_CAP — autobid, no constraints required (default for this tool).
   * LOWEST_COST_WITH_BID_CAP — requires bid_amount.
   * COST_CAP — requires bid_amount.
   * MINIMUM_ROAS — requires bid_constraints.roas_average_floor.
   */
  bid_strategy: string;
  targeting: MetaTargeting;
  /**
   * Unix timestamp. Omit entirely when no explicit start date is chosen —
   * do NOT send null or 0; Meta rejects those as "Invalid parameter".
   */
  start_time?: number;
  /**
   * Unix timestamp. Required only for lifetime_budget ad sets.
   * Omit when not set.
   */
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
  // ── Advantage+ OFF: strict age enforcement ───────────────────────────────
  // age_min / age_max at targeting root = hard limits Meta enforces.
  // advantage_audience: 0 must be explicit (Meta rejects omission).
  //
  // ── Advantage+ ON: suggested age ─────────────────────────────────────────
  // Do NOT send top-level age_min / age_max — Meta rejects values < 65 on
  // Advantage+ ad sets ("strict age_max below 65 not allowed").
  // Instead, pass the user's chosen range as individual_setting inside
  // targeting_automation; Meta treats these as audience *suggestions* and
  // may expand beyond them.
  // Resolve geo: per-ad-set override → default GB
  const rawGeo = adSet.geoLocations;
  const geoLocations: MetaGeoLocations = rawGeo
    ? { countries: rawGeo.countries, cities: rawGeo.cities, regions: rawGeo.regions }
    : { countries: ["GB"] };

  const targeting: MetaTargeting = adSet.advantagePlus
    ? {
        geo_locations: geoLocations,
        targeting_automation: {
          advantage_audience: 1,
          individual_setting: {
            age_min: adSet.ageMin,
            age_max: adSet.ageMax,
          },
        },
      }
    : {
        age_min: adSet.ageMin,
        age_max: adSet.ageMax,
        geo_locations: geoLocations,
        targeting_automation: { advantage_audience: 0 },
      };

  // Handle excluded_geo_locations (e.g. UK excl London)
  if (rawGeo?.excluded_geo_locations) {
    targeting.excluded_geo_locations = rawGeo.excluded_geo_locations;
  }

  switch (adSet.sourceType) {
    case "interest_group": {
      const group = audiences.interestGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        // Belt-and-braces filter:
        //  1. Must look like a real Meta id (covers synthetic / hint-derived ids).
        //  2. targetabilityStatus, when present, must be "valid". Anything tagged
        //     unresolved/discovery_only/deprecated has already been logged and
        //     surfaced by the launch-campaign preflight pass; this is the second
        //     line of defence in case those code paths are ever bypassed.
        const realInterests = group.interests
          .filter((i) => isRealMetaId(i.id))
          .filter((i) => i.targetabilityStatus === undefined || i.targetabilityStatus === "valid")
          .map((i) => ({ id: i.id, name: i.name }));
        if (realInterests.length > 0) {
          targeting.interests = realInterests;
          console.log(`[buildMetaTargeting] interest_group "${group.name}": ` +
            `${realInterests.length} interests → ${realInterests.map(i => `${i.name}(${i.id})`).join(", ")}`);
        } else {
          const dropped = group.interests.length - realInterests.length;
          console.warn(`[buildMetaTargeting] interest_group "${group.name}": ` +
            `all ${dropped} interests had non-Meta IDs and were dropped — ad set will use broad targeting`);
        }
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
      const group = audiences.pageGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        // Merge user-selected custom audiences + auto-generated engagement audiences
        const userIds = group.customAudienceIds.filter(isRealMetaId);
        const engagementIds = (group.engagementAudienceIds ?? []).filter(isRealMetaId);
        const allIds = Array.from(new Set([...userIds, ...engagementIds]));

        if (allIds.length > 0) {
          targeting.custom_audiences = allIds.map((id) => ({ id }));
          console.log(`[buildMetaTargeting] page_group "${group.name}": ` +
            `custom_audiences → ${allIds.join(", ")} (${userIds.length} user-selected, ${engagementIds.length} engagement)`);
        } else {
          console.log(`[buildMetaTargeting] page_group "${group.name}": ` +
            `no custom audience IDs attached — ad set will use broad targeting only`);
        }
      }
      break;
    }

    case "lookalike_group": {
      const group = audiences.pageGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const lalIds = (group.lookalikeAudienceIds ?? []).filter(isRealMetaId);
        if (lalIds.length > 0) {
          targeting.custom_audiences = lalIds.map((id) => ({ id }));
          console.log(`[buildMetaTargeting] lookalike_group "${group.name}": ` +
            `custom_audiences → ${lalIds.join(", ")}`);
        } else {
          // No lookalike IDs means creation failed — caller should have
          // skipped this ad set, but throw defensively to prevent phantom ad sets.
          throw new Error(
            `Cannot build targeting for lookalike_group "${group.name}": ` +
            `no lookalike audience IDs available (audience creation likely failed)`,
          );
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

    case "selected_pages_lookalike": {
      // Lookalike audiences created from the user's own Facebook pages.
      const splalGroups = audiences.selectedPagesLookalikeGroups ?? [];
      const group = splalGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const rangeKey = adSet.lookalikeRange ?? "";
        const lalIds = (group.lookalikeAudienceIdsByRange?.[rangeKey] ?? []).filter(isRealMetaId);
        if (lalIds.length > 0) {
          targeting.custom_audiences = lalIds.map((id) => ({ id }));
          console.log(
            `[buildMetaTargeting] selected_pages_lookalike "${group.name}" (${rangeKey}): ` +
            `custom_audiences → ${lalIds.join(", ")}`,
          );
        } else {
          throw new Error(
            `Cannot build targeting for selected_pages_lookalike "${group.name}" (${rangeKey}): ` +
            `no lookalike audience IDs available — creation likely failed or timed out`,
          );
        }
      }
      break;
    }

    case "custom_group_lookalike": {
      // Lookalike audiences created from pre-existing custom audiences in the ad account.
      // IDs stored in CustomAudienceGroup.lookalikeAudienceIdsByRange[range].
      const group = audiences.customAudienceGroups.find((g) => g.id === adSet.sourceId);
      if (group) {
        const rangeKey = adSet.lookalikeRange ?? "";
        const lalIds = (group.lookalikeAudienceIdsByRange?.[rangeKey] ?? []).filter(isRealMetaId);
        if (lalIds.length > 0) {
          targeting.custom_audiences = lalIds.map((id) => ({ id }));
          console.log(
            `[buildMetaTargeting] custom_group_lookalike "${group.name}" (${rangeKey}): ` +
            `custom_audiences → ${lalIds.join(", ")}`,
          );
        } else {
          throw new Error(
            `Cannot build targeting for custom_group_lookalike "${group.name}" (${rangeKey}): ` +
            `no lookalike audience IDs available — creation likely failed or timed out`,
          );
        }
      }
      break;
    }
  }

  return targeting;
}

// ─── Targeting validation ─────────────────────────────────────────────────────

/**
 * Returns true if the targeting spec contains at least one meaningful audience
 * signal beyond pure geo + age/gender.
 *
 * Broad targeting (no custom audiences and no interests) is NOT acceptable —
 * it would result in untargeted ad spend across the entire country.
 *
 * Saved audiences and lookalike audiences both land in custom_audiences so they
 * are covered by the first check.
 */
export function hasAudienceTargeting(targeting: MetaTargeting): boolean {
  if ((targeting.custom_audiences?.length ?? 0) > 0) return true;
  if ((targeting.interests?.length ?? 0) > 0) return true;
  return false;
}

/**
 * Returns a human-readable reason WHY targeting is empty for an ad set,
 * so failure messages are actionable rather than generic.
 */
export function buildEmptyTargetingReason(
  adSet: AdSetSuggestion,
  audiences: AudienceSettings,
): string {
  switch (adSet.sourceType) {
    case "page_group": {
      const group = audiences.pageGroups.find((g) => g.id === adSet.sourceId);
      if (!group) return "page group not found in draft";
      const hasUserAudiences = (group.customAudienceIds ?? []).some((id) => /^\d{10,}$/.test(id));
      const hasEngagementAudiences = (group.engagementAudienceIds ?? []).some((id) => /^\d{10,}$/.test(id));
      if ((!group.engagementTypes || group.engagementTypes.length === 0) && !hasUserAudiences)
        return "no engagement types selected and no custom audiences selected — " +
               "select at least one engagement type or add a custom audience";
      if (!hasEngagementAudiences && !hasUserAudiences)
        return "all engagement audience creation failed and no custom audiences were manually selected";
      return "no valid custom audience IDs (all IDs failed real-ID validation)";
    }
    case "interest_group": {
      const group = audiences.interestGroups.find((g) => g.id === adSet.sourceId);
      if (!group) return "interest group not found in draft";
      const total = group.interests.length;
      const realCount = group.interests.filter((i) => /^\d{10,}$/.test(i.id)).length;
      if (total === 0) return "interest group is empty — no interests added";
      if (realCount === 0)
        return `all ${total} interest(s) have non-Meta IDs or were removed by preflight sanitisation`;
      return `${realCount} of ${total} interests have valid IDs but targeting still resolved empty`;
    }
    case "custom_group": {
      const group = audiences.customAudienceGroups.find((g) => g.id === adSet.sourceId);
      if (!group) return "custom audience group not found in draft";
      return `all ${group.audienceIds.length} custom audience ID(s) failed real-ID validation`;
    }
    case "saved_audience":
      return `saved audience ID "${adSet.sourceId}" is not a real Meta numeric ID`;
    default:
      return "no audience targeting sources configured";
  }
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

// ─── Objective / goal compatibility ──────────────────────────────────────────

/**
 * Valid internal optimisation goals per campaign objective.
 *
 * A campaign created as OUTCOME_TRAFFIC only accepts ad sets whose
 * optimization_goal is compatible with that objective. Sending
 * OFFSITE_CONVERSIONS under OUTCOME_TRAFFIC (a common stale-draft mistake)
 * triggers Meta error code 100 "Invalid parameter" on every ad set.
 */
const VALID_GOALS_BY_OBJECTIVE: Record<CampaignObjective, OptimisationGoal[]> = {
  traffic:      ["landing_page_views", "link_clicks", "reach", "impressions"],
  purchase:     ["conversions", "value"],
  registration: ["conversions", "complete_registration"],
  awareness:    ["reach", "impressions", "video_views"],
  engagement:   ["post_engagement", "video_views"],
};

const DEFAULT_GOAL_BY_OBJECTIVE: Record<CampaignObjective, OptimisationGoal> = {
  traffic:      "landing_page_views",
  purchase:     "conversions",
  registration: "conversions",
  awareness:    "reach",
  engagement:   "post_engagement",
};

/**
 * Return the effective optimisation goal, correcting any incompatibility
 * between the stored draft value and the campaign objective.
 *
 * ROOT CAUSE GUARD: The CampaignSetup step resets optimisationGoal when the
 * user changes objective, but only while that React component is mounted. A
 * draft loaded from Supabase / localStorage may carry a stale value such as
 * objective: "traffic" + optimisationGoal: "conversions". Sending
 * optimization_goal: "OFFSITE_CONVERSIONS" under OUTCOME_TRAFFIC causes Meta
 * to reject every ad set with "Invalid parameter" (code 100).
 */
export function resolveOptimisationGoal(
  goal: OptimisationGoal,
  objective: CampaignObjective,
): OptimisationGoal {
  const valid = VALID_GOALS_BY_OBJECTIVE[objective] ?? [];
  if (!valid.includes(goal)) {
    const fallback = DEFAULT_GOAL_BY_OBJECTIVE[objective] ?? "landing_page_views";
    console.warn(
      `[resolveOptimisationGoal] goal "${goal}" is incompatible with objective ` +
      `"${objective}" — correcting to "${fallback}".`,
    );
    return fallback;
  }
  return goal;
}

// ─── Bid strategy mapping ─────────────────────────────────────────────────────

/**
 * Returns the correct bid strategy for a given optimisation goal.
 *
 * We always use LOWEST_COST_WITHOUT_CAP for this tool's launch flow.
 * It requires no bid_amount, bid_constraints, or ROAS floor — just a daily
 * budget. The field MUST be present; omitting it causes Meta to infer a
 * strategy that may require constraints (code 100 "Invalid parameter").
 */
export function mapBidStrategy(_goal: OptimisationGoal): string {
  return "LOWEST_COST_WITHOUT_CAP";
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
  // Resolve the effective goal BEFORE mapping — corrects stale draft values
  // that are incompatible with the campaign objective (see resolveOptimisationGoal).
  const effectiveGoal = resolveOptimisationGoal(optimisationGoal, objective);

  // daily_budget must be in the smallest currency unit (pence / cents).
  // budgetPerDay is stored in the major currency unit (£/€/$), so multiply by 100.
  // Math.round prevents floating-point noise (e.g. £2.50 → 250, not 249.99999).
  const dailyBudgetMinorUnits = Math.round(adSet.budgetPerDay * 100);

  const payload: MetaAdSetPayload = {
    name: adSet.name,
    campaign_id: campaignId,
    daily_budget: dailyBudgetMinorUnits,
    billing_event: mapBillingEvent(effectiveGoal),
    optimization_goal: mapOptimisationGoal(effectiveGoal),
    // Always explicit — omitting causes Meta to pick a default that may require
    // bid_amount or bid_constraints, resulting in code 100 "Invalid parameter".
    bid_strategy: mapBidStrategy(effectiveGoal),
    targeting: buildMetaTargeting(adSet, audiences),
    status: "PAUSED",
    // start_time and end_time are added below only when explicitly set —
    // sending null / 0 is rejected by Meta as "Invalid parameter".
  };

  if (budgetSchedule.startDate) {
    payload.start_time = toUnixTs(budgetSchedule.startDate);
  }

  if (budgetSchedule.endDate) {
    payload.end_time = toUnixTs(budgetSchedule.endDate);
  }

  const promotedObject = buildPromotedObject(effectiveGoal, objective, pixelId);
  if (promotedObject) payload.promoted_object = promotedObject;

  if (optimisationGoal !== effectiveGoal) {
    console.warn(
      `[buildAdSetPayload] "${adSet.name}" — draft had optimisationGoal="${optimisationGoal}", ` +
      `corrected to "${effectiveGoal}" for objective="${objective}"`,
    );
  }

  const ageMode = adSet.advantagePlus ? "suggested (Advantage+)" : "strict";
  console.log(
    `[buildAdSetPayload] "${adSet.name}"`,
    `\n  objective: ${objective}`,
    `\n  optimisationGoal (draft): ${optimisationGoal} → (effective): ${effectiveGoal}`,
    `\n  optimization_goal: ${payload.optimization_goal}`,
    `\n  billing_event:     ${payload.billing_event}`,
    `\n  bid_strategy:      ${payload.bid_strategy}`,
    `\n  daily_budget:      ${payload.daily_budget} minor units (= ${adSet.budgetPerDay} major)`,
    `\n  age mode:          ${ageMode} (${adSet.ageMin}–${adSet.ageMax})`,
    `\n  location:          ${adSet.locationLabel ?? "default GB"}`,
    `\n  Full payload: ${JSON.stringify(payload, null, 2)}`,
  );

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

// ─── Deprecated Interest Replacement ──────────────────────────────────────────

export interface InterestReplacement {
  deprecatedId: string;
  deprecatedName: string;
  alternativeId: string | null;
  alternativeName: string | null;
}

/**
 * Extract deprecated interest replacement info from a Meta API error.
 * Meta may include deprecated/alternative info in error_data, error_user_msg,
 * or the main error message in various formats.
 */
export function extractDeprecatedReplacements(
  rawErrorData?: Record<string, unknown>,
  errorMessage?: string,
): InterestReplacement[] {
  const replacements: InterestReplacement[] = [];
  if (!rawErrorData && !errorMessage) return replacements;

  const addUnique = (r: InterestReplacement) => {
    if (!replacements.some((x) => x.deprecatedId === r.deprecatedId)) {
      replacements.push(r);
    }
  };

  // 1. Structured error_data (preferred)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorData = rawErrorData?.error_data as any;
  if (errorData) {
    const items = Array.isArray(errorData) ? errorData : [errorData];
    for (const item of items) {
      if (item.deprecated_interest_id) {
        addUnique({
          deprecatedId: String(item.deprecated_interest_id),
          deprecatedName: String(item.deprecated_interest_name ?? ""),
          alternativeId: item.alternative_interest_id ? String(item.alternative_interest_id) : null,
          alternativeName: item.alternative_interest_name ? String(item.alternative_interest_name) : null,
        });
      }
    }
  }

  // 2. Parse all available text fields for patterns
  const texts = [
    errorMessage,
    rawErrorData?.message as string,
    rawErrorData?.error_user_msg as string,
    rawErrorData?.error_user_title as string,
  ].filter(Boolean).join(" ");

  // Pattern: "Interest ID 12345 (Foo) is deprecated. Use 67890 (Bar) instead."
  const p1 = /(?:interest|targeting)\s+(?:ID\s+)?(\d+)\s*\(([^)]+)\)\s*(?:is\s+)?deprecated[^.]*?(?:(?:use|replace\s+with|alternative)\s+(?:ID\s+)?(\d+)\s*\(([^)]+)\))?/gi;
  let m;
  while ((m = p1.exec(texts)) !== null) {
    addUnique({
      deprecatedId: m[1],
      deprecatedName: m[2] ?? "",
      alternativeId: m[3] ?? null,
      alternativeName: m[4] ?? null,
    });
  }

  // Pattern: "'Foo' (ID: 12345) is no longer available" or "no longer valid"
  const p2 = /['"]([^'"]+)['"]\s*\((?:ID:\s*)?(\d+)\)\s*(?:is\s+)?(?:no longer (?:available|valid)|deprecated|removed)/gi;
  while ((m = p2.exec(texts)) !== null) {
    addUnique({
      deprecatedId: m[2],
      deprecatedName: m[1] ?? "",
      alternativeId: null,
      alternativeName: null,
    });
  }

  // Pattern: "Invalid interest ID: 12345" or "interest 12345 is invalid"
  const p3 = /(?:invalid\s+interest\s+(?:ID:?\s*)?|interest\s+)(\d{5,})\b/gi;
  while ((m = p3.exec(texts)) !== null) {
    addUnique({
      deprecatedId: m[1],
      deprecatedName: "",
      alternativeId: null,
      alternativeName: null,
    });
  }

  return replacements;
}

// ─── Known-deprecated interest overrides ──────────────────────────────────
//
// These are applied BEFORE the Meta API validation pass.
// "replaceName: null" means the interest should be removed entirely.
// "replaceName: string" means search Meta for that term and use the result.
//
const HARDCODED_DEPRECATED_INTERESTS: Array<{
  /** Normalized (parenthetical-stripped, lowercase) name to match against */
  matchName: string;
  /** Replacement search term, or null to remove entirely */
  replaceName: string | null;
}> = [
  // Deprecated genre label — replace with the canonical EDM interest
  { matchName: "hardcore (electronic dance music genre)", replaceName: "Electronic dance music" },
  // Deprecated geo-cultural interest — no sensible targeting alternative
  { matchName: "mumbai indian culture", replaceName: null },
  // Deprecated museum interests — replace with broader category
  { matchName: "museum of contemporary art, los angeles", replaceName: "Contemporary art museums" },
  { matchName: "museum of contemporary art los angeles", replaceName: "Contemporary art museums" },
  { matchName: "niterói contemporary art museum", replaceName: "Contemporary art museums" },
  { matchName: "niteroi contemporary art museum", replaceName: "Contemporary art museums" },
  // Deprecated media interest — replace with broader electronic music interest
  { matchName: "dj magazine", replaceName: "Electronic dance music" },
  // ── Fashion / editorial publications that are frequently deprecated ────────
  // METAL Magazine regularly loses its Meta interest ID; drop rather than
  // blindly replace with something irrelevant.
  { matchName: "metal magazine", replaceName: null },
  { matchName: "heavy metal (magazine)", replaceName: null },
  { matchName: "heavy metal magazine", replaceName: null },
  // These editorial interests appear in discovery results but tend to be
  // unstable; prefer the canonical magazine names below.
  { matchName: "list of fashion magazines", replaceName: "Fashion" },
  { matchName: "list of literary magazines", replaceName: null },
  // ── Music publications ─────────────────────────────────────────────────────
  { matchName: "mixmag media", replaceName: "Mixmag" },
  { matchName: "fact (uk magazine)", replaceName: "Electronic music" },
  { matchName: "fact magazine", replaceName: "Electronic music" },
  // ── Nightlife / fictional titles that match club-related searches ──────────
  // "The Sims 2: Nightlife" sometimes surfaces for nightlife-adjacent searches
  { matchName: "the sims 2: nightlife", replaceName: null },
  { matchName: "the sims 2 nightlife", replaceName: null },
  // ── Deprecated geo interests ───────────────────────────────────────────────
  { matchName: "ibiza rocks", replaceName: "Ibiza" },
  // ── Deprecated music-scene interests ──────────────────────────────────────
  { matchName: "new rave", replaceName: "Indie rock" },
  { matchName: "fidget house", replaceName: "Electronic dance music" },
  { matchName: "electroclash", replaceName: "Electronic music" },
  // ── Deprecated culture/lifestyle interests ────────────────────────────────
  // "Avant-garde" has historically been flagged as deprecated by Meta.
  // Prefer "Cultural movements" as a safe broader replacement when possible.
  { matchName: "avant-garde", replaceName: "Cultural movements" },
  { matchName: "avant garde", replaceName: "Cultural movements" },
  // ── Generic or low-signal interests that should never survive sanitisation ─
  { matchName: "music genre", replaceName: null },
  { matchName: "list of music genres", replaceName: null },
];

function hardcodedOverride(
  interest: { id: string; name: string },
): { action: "keep" } | { action: "replace"; searchName: string } | { action: "remove" } {
  // Match against BOTH the raw lowercase name and the normalised (parenthetical-
  // stripped) name. Matching the raw form lets us target entries like
  // "Heavy Metal (magazine)" without colliding with the "Heavy Metal" music
  // genre; the normalised pass still catches "DJ Magazine (music publication)".
  const raw = interest.name.trim().toLowerCase();
  const norm = normalizeInterestName(interest.name);
  for (const entry of HARDCODED_DEPRECATED_INTERESTS) {
    if (raw === entry.matchName || norm === entry.matchName) {
      return entry.replaceName === null
        ? { action: "remove" }
        : { action: "replace", searchName: entry.replaceName };
    }
  }
  return { action: "keep" };
}

/**
 * Pre-create sync sanitisation. Runs ONLY the hardcoded override table — no
 * network calls — and is safe to invoke as a final gate immediately before
 * `createMetaAdSet`. Replacements without a resolved Meta ID are treated as
 * removals (launch-time callers rely on the async preflight pass to resolve
 * real replacement IDs upstream; this helper's job is to strip anything that
 * survived that pass by name).
 */
export function sanitizeTargetingInterestsBeforeLaunch<
  T extends { id: string; name?: string },
>(
  interests: T[],
): {
  cleaned: T[];
  removed: Array<{ id: string; name: string; reason: string }>;
  replaced: Array<{ deprecated: string; replacementSearchName: string }>;
} {
  const cleaned: T[] = [];
  const removed: Array<{ id: string; name: string; reason: string }> = [];
  const replaced: Array<{ deprecated: string; replacementSearchName: string }> = [];
  const seenIds = new Set<string>();
  for (const interest of interests) {
    const name = interest.name ?? "";
    const ov = hardcodedOverride({ id: interest.id, name });
    if (ov.action === "remove") {
      removed.push({
        id: interest.id,
        name,
        reason: "Hardcoded pre-launch removal — deprecated, no sensible replacement",
      });
      continue;
    }
    if (ov.action === "replace") {
      // We can't resolve the replacement ID synchronously here; if preflight
      // hasn't already swapped this out, drop it rather than let Meta reject
      // the whole ad set at create time.
      removed.push({
        id: interest.id,
        name,
        reason: `Hardcoded pre-launch removal — replacement "${ov.searchName}" not resolved before create`,
      });
      replaced.push({ deprecated: name, replacementSearchName: ov.searchName });
      continue;
    }
    if (seenIds.has(interest.id)) continue;
    seenIds.add(interest.id);
    cleaned.push(interest);
  }
  return { cleaned, removed, replaced };
}

// ── Interest name normalization & fuzzy matching ──────────────────────────────

/**
 * Normalize an interest name for fuzzy matching:
 * - Strip trailing parenthetical suffixes:
 *   "Balenciaga (fashion brand)" → "Balenciaga"
 *   "Hardcore (electronic dance music genre)" → "Hardcore"
 * - Strip trailing bracket suffixes:
 *   "Foo [category]" → "Foo"
 * - Collapse whitespace, trim, lowercase
 */
function normalizeInterestName(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Fuzzy match: returns true when two interest names refer to the same entity.
 * Handles the common case where Meta appends "(fashion brand)", "(music)",
 * "(visual art)", etc. to the canonical interest name.
 *
 * Rules (applied after normalization):
 *  1. Exact match
 *  2. One contains the other (covers suffix/prefix differences)
 */
function interestNamesMatch(storedName: string, candidateName: string): boolean {
  const a = normalizeInterestName(storedName);
  const b = normalizeInterestName(candidateName);
  if (a === b) return true;
  if (a.length >= 3 && (b.includes(a) || a.includes(b))) return true;
  return false;
}

// Module-level resolution cache — persists within a single serverless invocation
// so the same interest name is not searched twice in one launch run.
const _interestResolutionCache = new Map<
  string,
  { id: string; name: string } | null
>();

/**
 * Pre-launch validation: check each interest ID against Meta's targeting
 * validation endpoint. Returns only interests that are still valid, plus
 * a list of removed ones for logging.
 *
 * Hardcoded overrides are applied first, then API-based validation runs on
 * the remainder. The returned `valid` list is what must be sent to Meta.
 *
 * Key improvements over the naive version:
 *  • Search query is normalized (parentheticals stripped) so Meta returns
 *    better candidates. e.g. "Balenciaga (fashion brand)" → query "Balenciaga"
 *  • Matching is fuzzy: accepts candidates where normalized names overlap,
 *    not just exact string equality.
 *  • Module-level cache prevents re-searching the same name within one launch.
 */
export async function sanitiseInterests(
  interests: { id: string; name: string }[],
): Promise<{
  valid: { id: string; name: string }[];
  removed: { id: string; name: string; reason: string }[];
}> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || interests.length === 0) {
    return { valid: interests, removed: [] };
  }

  const apiVersion = process.env.META_API_VERSION ?? "v21.0";
  const valid: { id: string; name: string }[] = [];
  const removed: { id: string; name: string; reason: string }[] = [];

  /**
   * Search Meta with a NORMALIZED query; return all candidates (up to 50).
   * Uses the module-level cache so the same name is only fetched once per run.
   */
  async function searchMetaNormalized(
    originalName: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const query = normalizeInterestName(originalName) || originalName.trim();
    const cacheKey = query;

    if (_interestResolutionCache.has(cacheKey)) {
      const cached = _interestResolutionCache.get(cacheKey);
      if (cached == null) return [];
      return [cached]; // single best match stored
    }

    try {
      const url = new URL(`https://graph.facebook.com/${apiVersion}/search`);
      url.searchParams.set("access_token", token!);
      url.searchParams.set("type", "adinterest");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "50");

      console.log(
        `[sanitiseInterests] search — original="${originalName}"` +
        ` normalized="${query}"`,
      );

      const res = await fetch(url.toString(), { cache: "no-store" });
      const json = (await res.json()) as {
        data?: Array<{ id: string; name: string }>;
      };
      const candidates = json.data ?? [];

      console.log(
        `[sanitiseInterests] candidates for "${query}": ` +
        candidates.slice(0, 8).map((c) => `${c.name}(${c.id})`).join(", ") +
        (candidates.length > 8 ? ` +${candidates.length - 8} more` : ""),
      );

      // Cache the best candidate (first result) for future lookups
      _interestResolutionCache.set(cacheKey, candidates[0] ?? null);
      return candidates;
    } catch (err) {
      console.warn(`[sanitiseInterests] search error for "${query}":`, err);
      return [];
    }
  }

  // ── Step 1: Apply hardcoded overrides before hitting the API ─────────────

  const toValidate: { id: string; name: string }[] = [];

  for (const interest of interests) {
    const override = hardcodedOverride(interest);

    if (override.action === "remove") {
      console.log(`[sanitiseInterests] HARDCODED remove "${interest.name}" (${interest.id})`);
      removed.push({
        id: interest.id,
        name: interest.name,
        reason: "Hardcoded removal — deprecated, no sensible replacement",
      });
      continue;
    }

    if (override.action === "replace") {
      console.log(
        `[sanitiseInterests] HARDCODED replace "${interest.name}" → search for "${override.searchName}"`,
      );
      const candidates = await searchMetaNormalized(override.searchName);
      const found = candidates[0] ?? null;
      if (found) {
        console.log(
          `[sanitiseInterests] HARDCODED resolved "${override.searchName}" → "${found.name}" (${found.id})`,
        );
        valid.push({ id: found.id, name: found.name });
        removed.push({
          id: interest.id,
          name: interest.name,
          reason: `Hardcoded replacement: ${found.name} (${found.id})`,
        });
      } else {
        console.log(
          `[sanitiseInterests] HARDCODED "${override.searchName}" not found — removing "${interest.name}"`,
        );
        removed.push({
          id: interest.id,
          name: interest.name,
          reason: `Hardcoded removal — replacement "${override.searchName}" not found`,
        });
      }
      continue;
    }

    toValidate.push(interest);
  }

  // ── Step 2: API-based validation with normalized query + fuzzy matching ───

  for (const interest of toValidate) {
    try {
      const candidates = await searchMetaNormalized(interest.name);

      // 2a. Exact ID match — interest is still valid, keep as-is
      if (candidates.some((c) => c.id === interest.id)) {
        console.log(
          `[sanitiseInterests] ✓ "${interest.name}" (${interest.id}) — ID confirmed`,
        );
        valid.push(interest);
        continue;
      }

      // 2b. Fuzzy name match — ID may have changed but entity is the same
      const fuzzyMatch = candidates.find((c) =>
        interestNamesMatch(interest.name, c.name),
      );
      if (fuzzyMatch) {
        if (fuzzyMatch.id !== interest.id) {
          console.log(
            `[sanitiseInterests] ↔ "${interest.name}" (${interest.id})` +
            ` → fuzzy match → "${fuzzyMatch.name}" (${fuzzyMatch.id})`,
          );
          valid.push({ id: fuzzyMatch.id, name: fuzzyMatch.name });
          removed.push({
            id: interest.id,
            name: interest.name,
            reason: `Replaced with ${fuzzyMatch.name} (${fuzzyMatch.id})`,
          });
        } else {
          // Same ID found via fuzzy path (shouldn't normally happen but be safe)
          valid.push(interest);
        }
        continue;
      }

      // 2c. No match — interest is genuinely not found in Meta's database
      console.log(
        `[sanitiseInterests] ✗ "${interest.name}" (${interest.id}) — not found` +
        ` after normalizing query to "${normalizeInterestName(interest.name)}"` +
        ` — removing`,
      );
      removed.push({
        id: interest.id,
        name: interest.name,
        reason: "Not found in Meta interest search",
      });
    } catch (err) {
      // Network error — keep the interest and let Meta reject it if invalid
      console.warn(`[sanitiseInterests] Could not validate "${interest.name}":`, err);
      valid.push(interest);
    }
  }

  return { valid, removed };
}

/**
 * Apply interest replacements to an ad set payload's targeting spec.
 * Returns a new payload with deprecated interests swapped for alternatives (or removed).
 */
export function applyInterestReplacements(
  payload: MetaAdSetPayload,
  replacements: InterestReplacement[],
): MetaAdSetPayload {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targeting = { ...payload.targeting } as any;
  const interests: { id: string; name: string }[] = targeting.interests ?? [];
  if (interests.length === 0) return payload;

  const depMap = new Map(replacements.map((r) => [r.deprecatedId, r]));
  const newInterests: { id: string; name: string }[] = [];

  for (const interest of interests) {
    const rep = depMap.get(interest.id);
    if (rep) {
      if (rep.alternativeId) {
        newInterests.push({ id: rep.alternativeId, name: rep.alternativeName ?? interest.name });
      }
      // If no alternative, the interest is just removed
    } else {
      newInterests.push(interest);
    }
  }

  targeting.interests = newInterests.length > 0 ? newInterests : undefined;
  return { ...payload, targeting };
}
