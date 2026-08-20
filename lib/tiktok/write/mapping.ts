/**
 * lib/tiktok/write/mapping.ts
 *
 * Maps our TikTok draft enums onto Marketing API v1.3 /adgroup/create/ and
 * /ad/create/ field names. Enum spellings are taken from the official
 * Ad Groups → Create and Ads → Create docs (business-api.tiktok.com/portal/docs
 * ids 1739499616346114 and 1739953377508354) plus the published SDK models
 * (`AdgroupCreateBody`, `AdcreateCreatives`).
 *
 * Do not invent a TikTok enum here. If the draft has no value for a required
 * API field, return a named missing-field error instead of a default.
 */

import type { BodyValue } from "../client.ts";
import {
  isTikTokIdentityType,
  type TikTokIdentityType,
  TIKTOK_IDENTITY_TYPES,
} from "../identity.ts";
import type {
  TikTokAdGroupDraft,
  TikTokBidStrategy,
  TikTokCampaignDraft,
  TikTokCreativeDraft,
  TikTokObjective,
  TikTokOptimisationGoal,
} from "../../types/tiktok-draft.ts";

export interface MappingError {
  field: string;
  message: string;
}

export type MappingResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MappingError };

/** Official v1.3 `age_groups` buckets (Create ad groups). */
export const TIKTOK_AGE_GROUPS = [
  "AGE_13_17",
  "AGE_18_24",
  "AGE_25_34",
  "AGE_35_44",
  "AGE_45_54",
  "AGE_55_100",
] as const;

export type TikTokAgeGroup = (typeof TIKTOK_AGE_GROUPS)[number];

const AGE_GROUP_RANGES: Array<{ id: TikTokAgeGroup; min: number; max: number }> =
  [
    { id: "AGE_13_17", min: 13, max: 17 },
    { id: "AGE_18_24", min: 18, max: 24 },
    { id: "AGE_25_34", min: 25, max: 34 },
    { id: "AGE_35_44", min: 35, max: 44 },
    { id: "AGE_45_54", min: 45, max: 54 },
    { id: "AGE_55_100", min: 55, max: 100 },
  ];

/**
 * Official v1.3 `gender` (Create ad groups): GENDER_MALE / GENDER_FEMALE /
 * GENDER_UNLIMITED. There is no GENDER_UNKNOWN — our UNKNOWN and mixed
 * selections map to GENDER_UNLIMITED.
 */
export type TikTokGender =
  | "GENDER_MALE"
  | "GENDER_FEMALE"
  | "GENDER_UNLIMITED";

/**
 * GeoNames IDs that TikTok `/tool/region/` returns for the country codes the
 * wizard actually offers (`components/tiktok-wizard/steps/audiences.tsx`).
 * TikTok `location_ids` are these numeric IDs, not ISO codes.
 */
export const TIKTOK_LOCATION_IDS_BY_CODE: Record<string, string> = {
  GB: "2635167",
  IE: "2963597",
  US: "6252001",
  BR: "3469034",
  DE: "2921044",
  FR: "3017382",
  ES: "2510769",
};

/**
 * Official v1.3 campaign `objective_type` values. Documented enum includes
 * TRAFFIC, WEB_CONVERSIONS, VIDEO_VIEWS, REACH, ENGAGEMENT, APP_PROMOTION,
 * LEAD_GENERATION, PRODUCT_SALES. Our draft `CONVERSIONS` is
 * `WEB_CONVERSIONS`. `AWARENESS` is not a TikTok campaign objective — we
 * refuse it rather than silently rewrite to REACH.
 *
 * The launcher only writes TRAFFIC and WEB_CONVERSIONS. Other documented
 * values still map 1:1 so preflight can name them as "not supported yet"
 * instead of inventing a different enum.
 */
export const TIKTOK_OBJECTIVE_TYPE: Record<
  Exclude<TikTokObjective, "AWARENESS" | "CONVERSIONS"> | "WEB_CONVERSIONS",
  string
> = {
  TRAFFIC: "TRAFFIC",
  WEB_CONVERSIONS: "WEB_CONVERSIONS",
  VIDEO_VIEWS: "VIDEO_VIEWS",
  REACH: "REACH",
  ENGAGEMENT: "ENGAGEMENT",
};

export const TIKTOK_LAUNCHER_OBJECTIVES: TikTokObjective[] = [
  "TRAFFIC",
  "CONVERSIONS",
];

export const TIKTOK_LAUNCHER_UNSUPPORTED_OBJECTIVES: TikTokObjective[] = [
  "VIDEO_VIEWS",
  "REACH",
  "AWARENESS",
  "ENGAGEMENT",
];

/**
 * Official v1.3 `optimization_goal` values (Create ad groups).
 * Our CONVERSION → CONVERT; LANDING_PAGE_VIEW → TRAFFIC_LANDING_PAGE_VIEW;
 * VIEW_6_SECOND → ENGAGED_VIEW (6-second engaged view).
 */
const OPTIMIZATION_GOAL_MAP: Record<TikTokOptimisationGoal, string> = {
  CLICK: "CLICK",
  LANDING_PAGE_VIEW: "TRAFFIC_LANDING_PAGE_VIEW",
  CONVERSION: "CONVERT",
  VALUE: "VALUE",
  VIDEO_VIEW: "VIDEO_VIEW",
  VIEW_6_SECOND: "ENGAGED_VIEW",
  REACH: "REACH",
  SHOW: "SHOW",
  ENGAGEMENT: "ENGAGEMENT",
};

/**
 * Official v1.3 `billing_event` values required on /adgroup/create/.
 * Derived from the mapped optimization goal — the draft has no billing field.
 */
const BILLING_EVENT_BY_GOAL: Record<string, string> = {
  CLICK: "CPC",
  TRAFFIC_LANDING_PAGE_VIEW: "CPC",
  CONVERT: "OCPM",
  VALUE: "OCPM",
  VIDEO_VIEW: "CPV",
  ENGAGED_VIEW: "CPV",
  REACH: "CPM",
  SHOW: "CPM",
  ENGAGEMENT: "OCPM",
};

/**
 * Documented TikTok ad-group daily floor (Ads Manager + Create ad group).
 * Applied in the advertiser's own currency units. We only treat this number
 * as verified when `/advertiser/info/` reports GBP; otherwise preflight
 * warns rather than silently assuming a sterling floor.
 *
 * Lifetime (`BUDGET_MODE_TOTAL`) is not a flat 20: TikTok's documented
 * rule is daily minimum × scheduled days. We fail if the schedule cannot
 * produce a day count instead of falling back to 20.
 */
export const TIKTOK_MIN_DAILY_BUDGET = 20;

export const SMART_PLUS_BLOCK_MESSAGE =
  "Smart+ campaigns generate their own creative — turn it off to launch with your own assets only";

export function mapTikTokAgeGroups(
  ageMin: number,
  ageMax: number,
): MappingResult<TikTokAgeGroup[]> {
  if (!Number.isFinite(ageMin) || !Number.isFinite(ageMax)) {
    return missing("age_groups", "ageMin and ageMax must be numbers");
  }
  if (ageMin > ageMax) {
    return missing("age_groups", "ageMin must be less than or equal to ageMax");
  }
  const groups = AGE_GROUP_RANGES.filter(
    (bucket) => ageMin <= bucket.max && ageMax >= bucket.min,
  ).map((bucket) => bucket.id);
  if (groups.length === 0) {
    return missing(
      "age_groups",
      `No TikTok age_groups overlap the range ${ageMin}–${ageMax}`,
    );
  }
  return ok(groups);
}

export function mapTikTokGender(
  genders: Array<"MALE" | "FEMALE" | "UNKNOWN">,
): MappingResult<TikTokGender> {
  const unique = new Set(genders);
  if (unique.size === 0) return ok("GENDER_UNLIMITED");
  if (unique.size === 1 && unique.has("MALE")) return ok("GENDER_MALE");
  if (unique.size === 1 && unique.has("FEMALE")) return ok("GENDER_FEMALE");
  return ok("GENDER_UNLIMITED");
}

export function mapTikTokLocationIds(
  locationCodes: string[],
): MappingResult<string[]> {
  if (locationCodes.length === 0) {
    return missing("location_ids", "At least one location is required");
  }
  const ids: string[] = [];
  for (const code of locationCodes) {
    const mapped = TIKTOK_LOCATION_IDS_BY_CODE[code];
    if (mapped) {
      ids.push(mapped);
      continue;
    }
    // /search/region/ returns TikTok location_ids (numeric GeoNames IDs).
    if (/^\d+$/.test(code)) {
      ids.push(code);
      continue;
    }
    return missing(
      "location_ids",
      `No TikTok location_id mapping for location code ${code}`,
    );
  }
  return ok(uniqueIds(ids));
}

export function canonicalTikTokLocationId(code: string): string | null {
  if (TIKTOK_LOCATION_IDS_BY_CODE[code]) return TIKTOK_LOCATION_IDS_BY_CODE[code];
  if (/^\d+$/.test(code)) return code;
  return null;
}

export function tikTokLocationAlreadySelected(
  locationCodes: string[],
  candidate: string,
): boolean {
  const canon = canonicalTikTokLocationId(candidate);
  if (!canon) return locationCodes.includes(candidate);
  return locationCodes.some((code) => canonicalTikTokLocationId(code) === canon);
}

export function mapTikTokObjectiveType(
  objective: TikTokObjective | null,
): MappingResult<string> {
  if (!objective) return missing("objective_type", "Campaign objective is required");
  if (objective === "AWARENESS") {
    return missing(
      "objective_type",
      "TikTok has no AWARENESS objective_type — use REACH",
    );
  }
  if (objective === "CONVERSIONS") return ok("WEB_CONVERSIONS");
  return ok(objective);
}

export function mapTikTokOptimizationGoal(
  goal: TikTokOptimisationGoal | null,
): MappingResult<string> {
  if (!goal) return missing("optimization_goal", "Optimisation goal is required");
  return ok(OPTIMIZATION_GOAL_MAP[goal]);
}

export function mapTikTokBillingEvent(
  goal: TikTokOptimisationGoal | null,
): MappingResult<string> {
  const mapped = mapTikTokOptimizationGoal(goal);
  if (!mapped.ok) return mapped;
  const billing = BILLING_EVENT_BY_GOAL[mapped.value];
  if (!billing) {
    return missing(
      "billing_event",
      `No TikTok billing_event for optimization_goal ${mapped.value}`,
    );
  }
  return ok(billing);
}

export function mapTikTokPacing(
  pacing: "STANDARD" | "ACCELERATED",
  bidType: "BID_TYPE_NO_BID" | "BID_TYPE_CUSTOM",
): MappingResult<"PACING_MODE_SMOOTH" | "PACING_MODE_FAST"> {
  if (bidType === "BID_TYPE_NO_BID") {
    if (pacing === "ACCELERATED") {
      return missing(
        "pacing",
        "TikTok only allows PACING_MODE_SMOOTH when bid_type is BID_TYPE_NO_BID",
      );
    }
    return ok("PACING_MODE_SMOOTH");
  }
  return ok(pacing === "ACCELERATED" ? "PACING_MODE_FAST" : "PACING_MODE_SMOOTH");
}

export function mapTikTokBidType(
  bidStrategy: TikTokBidStrategy | null,
): MappingResult<"BID_TYPE_NO_BID" | "BID_TYPE_CUSTOM"> {
  if (!bidStrategy || bidStrategy === "LOWEST_COST") return ok("BID_TYPE_NO_BID");
  if (bidStrategy === "COST_CAP") return ok("BID_TYPE_CUSTOM");
  return missing(
    "bid_type",
    "SMART_PLUS is not a TikTok bid_type on this launcher",
  );
}

export function mapTikTokBudgetMode(
  budgetMode: "DAILY" | "LIFETIME",
): "BUDGET_MODE_DAY" | "BUDGET_MODE_TOTAL" {
  return budgetMode === "LIFETIME" ? "BUDGET_MODE_TOTAL" : "BUDGET_MODE_DAY";
}

export function mapTikTokScheduleType(
  startAt: string | null,
  endAt: string | null,
): MappingResult<"SCHEDULE_START_END" | "SCHEDULE_FROM_NOW"> {
  if (!startAt) return missing("schedule_type", "Schedule start is required");
  if (endAt) return ok("SCHEDULE_START_END");
  return ok("SCHEDULE_FROM_NOW");
}

/**
 * TikTok schedule fields want `YYYY-MM-DD HH:MM:SS`, not ISO-8601.
 */
export function formatTikTokScheduleTime(
  value: string | null,
): MappingResult<string> {
  if (!value) return missing("schedule_start_time", "Schedule time is required");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return missing("schedule_start_time", `Invalid schedule time: ${value}`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return ok(
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  );
}

export function mapTikTokIdentityType(
  identityType: TikTokCampaignDraft["accountSetup"]["identityType"] | string | null,
): MappingResult<TikTokIdentityType> {
  if (!identityType) {
    return missing("identity_type", "Identity type is required");
  }
  if (isTikTokIdentityType(identityType)) return ok(identityType);
  return missing(
    "identity_type",
    `Identity type must be one of ${TIKTOK_IDENTITY_TYPES.join(", ")} — "${identityType}" is not a TikTok identity_type`,
  );
}

export function mapTikTokPromotionType(
  objective: TikTokObjective | null,
): MappingResult<"WEBSITE"> {
  if (!objective) {
    return missing("promotion_type", "Campaign objective is required");
  }
  if (objective === "TRAFFIC" || objective === "CONVERSIONS") {
    return ok("WEBSITE");
  }
  return missing(
    "promotion_type",
    `${objective} is not supported by the launcher yet`,
  );
}

export function resolveTikTokAdGroupBudget(
  draft: TikTokCampaignDraft,
  adGroup: TikTokAdGroupDraft,
): number | null {
  return adGroup.budget ?? draft.budgetSchedule.budgetAmount;
}

export function tikTokScheduledDays(
  startAt: string | null,
  endAt: string | null,
): number | null {
  if (!startAt || !endAt) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

/**
 * Ad-group budget floor. Daily = 20. Lifetime = 20 × scheduled days
 * (TikTok documented lifetime minimum). Missing lifetime schedule → error.
 */
export function tikTokAdGroupBudgetFloor(input: {
  budgetMode: "DAILY" | "LIFETIME";
  startAt: string | null;
  endAt: string | null;
}): MappingResult<number> {
  if (input.budgetMode === "DAILY") return ok(TIKTOK_MIN_DAILY_BUDGET);
  const days = tikTokScheduledDays(input.startAt, input.endAt);
  if (days == null) {
    return missing(
      "budget",
      "Lifetime budget floor is 20 × scheduled days; set a schedule end so the minimum can be calculated",
    );
  }
  return ok(TIKTOK_MIN_DAILY_BUDGET * days);
}

export function tikTokMinimumBudget(
  budgetMode: "DAILY" | "LIFETIME",
  startAt: string | null = null,
  endAt: string | null = null,
): MappingResult<number> {
  return tikTokAdGroupBudgetFloor({ budgetMode, startAt, endAt });
}

export function tikTokBudgetFloorUnverified(
  currency: string | null | undefined,
): boolean {
  return (currency ?? "").toUpperCase() !== "GBP";
}

export function buildTikTokAdGroupPayload(input: {
  advertiserId: string;
  campaignId: string;
  draft: TikTokCampaignDraft;
  adGroup: TikTokAdGroupDraft;
}): MappingResult<Record<string, BodyValue>> {
  const { draft, adGroup } = input;
  const bidStrategy =
    draft.optimisation.bidStrategy ?? draft.campaignSetup.bidStrategy;
  const bidType = mapTikTokBidType(bidStrategy);
  if (!bidType.ok) return bidType;
  const pacing = mapTikTokPacing(draft.optimisation.pacing, bidType.value);
  if (!pacing.ok) return pacing;
  const goal = mapTikTokOptimizationGoal(draft.campaignSetup.optimisationGoal);
  if (!goal.ok) return goal;
  const billing = mapTikTokBillingEvent(draft.campaignSetup.optimisationGoal);
  if (!billing.ok) return billing;
  const locations = mapTikTokLocationIds(draft.audiences.locationCodes);
  if (!locations.ok) return locations;
  const ages = mapTikTokAgeGroups(draft.audiences.ageMin, draft.audiences.ageMax);
  if (!ages.ok) return ages;
  const gender = mapTikTokGender(draft.audiences.genders);
  if (!gender.ok) return gender;

  const startAt =
    adGroup.startAt ?? draft.budgetSchedule.scheduleStartAt;
  const endAt = adGroup.endAt ?? draft.budgetSchedule.scheduleEndAt;
  const scheduleType = mapTikTokScheduleType(startAt, endAt);
  if (!scheduleType.ok) return scheduleType;
  const startTime = formatTikTokScheduleTime(startAt);
  if (!startTime.ok) return startTime;
  let endTime: string | undefined;
  if (scheduleType.value === "SCHEDULE_START_END") {
    const formattedEnd = formatTikTokScheduleTime(endAt);
    if (!formattedEnd.ok) {
      return {
        ok: false,
        error: { field: "schedule_end_time", message: formattedEnd.error.message },
      };
    }
    endTime = formattedEnd.value;
  }

  const promotion = mapTikTokPromotionType(draft.campaignSetup.objective);
  if (!promotion.ok) return promotion;

  const budget = resolveTikTokAdGroupBudget(draft, adGroup);
  if (budget == null) return missing("budget", "Ad group budget is required");
  const floor = tikTokAdGroupBudgetFloor({
    budgetMode: draft.budgetSchedule.budgetMode,
    startAt,
    endAt,
  });
  if (!floor.ok) return floor;
  if (budget < floor.value) {
    return missing(
      "budget",
      `Ad group "${adGroup.name}" budget ${budget} is below the ${floor.value} floor for ${draft.budgetSchedule.budgetMode} mode`,
    );
  }

  const payload: Record<string, BodyValue> = {
    advertiser_id: input.advertiserId,
    campaign_id: input.campaignId,
    adgroup_name: adGroup.name,
    budget,
    budget_mode: mapTikTokBudgetMode(draft.budgetSchedule.budgetMode),
    schedule_type: scheduleType.value,
    schedule_start_time: startTime.value,
    optimization_goal: goal.value,
    billing_event: billing.value,
    bid_type: bidType.value,
    pacing: pacing.value,
    location_ids: locations.value,
    age_groups: ages.value,
    gender: gender.value,
    placement_type: "PLACEMENT_TYPE_NORMAL",
    placements: ["PLACEMENT_TIKTOK"],
    promotion_type: promotion.value,
    operation_status: "DISABLE",
  };

  if (endTime) payload.schedule_end_time = endTime;
  if (draft.audiences.languages.length > 0) {
    payload.languages = draft.audiences.languages;
  }
  const targeting = targetingIdsForAdGroup(draft, adGroup);
  if (targeting.interestCategoryIds.length > 0) {
    payload.interest_category_ids = targeting.interestCategoryIds;
  }
  if (targeting.interestKeywordIds.length > 0) {
    payload.interest_keyword_ids = targeting.interestKeywordIds;
  }
  if (targeting.purchaseIntentionKeywordIds.length > 0) {
    payload.purchase_intention_keyword_ids =
      targeting.purchaseIntentionKeywordIds;
  }
  if (targeting.behaviourCategoryIds.length > 0) {
    payload.actions = [
      { action_category_ids: targeting.behaviourCategoryIds },
    ];
  }
  const audienceIds = [
    ...draft.audiences.customAudienceIds,
    ...draft.audiences.lookalikeAudienceIds,
  ];
  if (audienceIds.length > 0) payload.audience_ids = audienceIds;

  const conversionsFields = applyTikTokConversionFields(draft, goal.value);
  if (!conversionsFields.ok) return conversionsFields;
  Object.assign(payload, conversionsFields.value);

  if (
    (goal.value === "REACH" || goal.value === "SHOW") &&
    draft.budgetSchedule.frequencyCap == null
  ) {
    return missing(
      "frequency",
      "REACH/SHOW requires a frequency cap (frequency + frequency_schedule)",
    );
  }
  if (draft.budgetSchedule.frequencyCap != null) {
    payload.frequency = draft.budgetSchedule.frequencyCap;
    // Official Create-ad-group pair: frequency (count) + frequency_schedule
    // (period in days). The draft only stores the count; 7 is TikTok's
    // documented 7-day window used with frequency caps.
    payload.frequency_schedule = 7;
  }

  if (bidType.value === "BID_TYPE_CUSTOM") {
    const bidPrice = resolveBidPrice(draft);
    if (bidPrice == null) {
      return missing(
        "bid_price",
        "COST_CAP requires a bid price (benchmark CPC / CPV / CPM)",
      );
    }
    if (goal.value === "CONVERT" || goal.value === "VALUE") {
      payload.conversion_bid_price = bidPrice;
    } else {
      payload.bid_price = bidPrice;
    }
  }

  return ok(payload);
}

export function buildTikTokAdPayload(input: {
  advertiserId: string;
  adGroupId: string;
  draft: TikTokCampaignDraft;
  creative: TikTokCreativeDraft;
}): MappingResult<Record<string, BodyValue>> {
  const identityType = mapTikTokIdentityType(input.draft.accountSetup.identityType);
  if (!identityType.ok) return identityType;
  if (!input.draft.accountSetup.identityId) {
    return missing("identity_id", "Identity id is required");
  }
  if (!input.creative.videoId) {
    return missing("video_id", `Creative ${input.creative.name} is missing a videoId`);
  }
  if (!input.creative.landingPageUrl) {
    return missing(
      "landing_page_url",
      `Creative ${input.creative.name} is missing a landing page URL`,
    );
  }

  const creative: Record<string, BodyValue> = {
    ad_name: input.creative.name,
    ad_format: "SINGLE_VIDEO",
    video_id: input.creative.videoId,
    ad_text: input.creative.adText,
    display_name: input.creative.displayName,
    landing_page_url: input.creative.landingPageUrl,
    identity_id: input.draft.accountSetup.identityId,
    identity_type: identityType.value,
    creative_authorized: false,
  };
  if (input.creative.cta) creative.call_to_action = input.creative.cta;
  if (input.creative.mode === "SPARK_AD" && input.creative.sparkPostId) {
    creative.tiktok_item_id = input.creative.sparkPostId;
  }
  if (input.creative.musicId) creative.music_id = input.creative.musicId;

  return ok({
    advertiser_id: input.advertiserId,
    adgroup_id: input.adGroupId,
    operation_status: "DISABLE",
    is_aco: false,
    creatives: [creative],
  });
}

export function buildTikTokCampaignPayload(input: {
  advertiserId: string;
  draft: TikTokCampaignDraft;
}): MappingResult<Record<string, BodyValue>> {
  const objective = mapTikTokObjectiveType(input.draft.campaignSetup.objective);
  if (!objective.ok) return objective;
  if (!input.draft.campaignSetup.campaignName.trim()) {
    return missing("campaign_name", "Campaign name is required");
  }
  const payload: Record<string, BodyValue> = {
    advertiser_id: input.advertiserId,
    campaign_name: input.draft.campaignSetup.campaignName,
    objective_type: objective.value,
    budget_mode: mapTikTokBudgetMode(input.draft.budgetSchedule.budgetMode),
    operation_status: "DISABLE",
  };
  if (input.draft.budgetSchedule.budgetAmount != null) {
    payload.budget = input.draft.budgetSchedule.budgetAmount;
  }
  return ok(payload);
}

/**
 * `pixel_id` is only valid on CONVERT/VALUE. Official docs also require
 * `optimization_event` whenever `pixel_id` is set. Values come from the
 * pixel's `/pixel/list/` events — never a hardcoded enum.
 */
function applyTikTokConversionFields(
  draft: TikTokCampaignDraft,
  mappedGoal: string,
): MappingResult<Record<string, BodyValue>> {
  const pixelSupported = mappedGoal === "CONVERT" || mappedGoal === "VALUE";
  const fields: Record<string, BodyValue> = {};

  if (draft.campaignSetup.objective === "CONVERSIONS") {
    if (!draft.accountSetup.pixelId) {
      return missing("pixel_id", "CONVERSIONS requires a TikTok pixel");
    }
    if (!draft.accountSetup.optimisationEvent) {
      return missing(
        "optimization_event",
        "CONVERSIONS requires an optimisation event from the selected pixel",
      );
    }
    if (!pixelSupported) {
      return missing(
        "optimization_goal",
        "CONVERSIONS requires optimization_goal CONVERT or VALUE",
      );
    }
    fields.pixel_id = draft.accountSetup.pixelId;
    fields.optimization_event = draft.accountSetup.optimisationEvent;
    return ok(fields);
  }

  if (pixelSupported && draft.accountSetup.pixelId) {
    if (!draft.accountSetup.optimisationEvent) {
      return missing(
        "optimization_event",
        "optimization_event is required when pixel_id is set",
      );
    }
    fields.pixel_id = draft.accountSetup.pixelId;
    fields.optimization_event = draft.accountSetup.optimisationEvent;
  }
  return ok(fields);
}

function targetingIdsForAdGroup(
  draft: TikTokCampaignDraft,
  adGroup: TikTokAdGroupDraft,
): {
  interestCategoryIds: string[];
  interestKeywordIds: string[];
  purchaseIntentionKeywordIds: string[];
  behaviourCategoryIds: string[];
} {
  const group = adGroup.interestGroupId
    ? (draft.audiences.interestGroups ?? []).find(
        (candidate) => candidate.id === adGroup.interestGroupId,
      )
    : null;
  if (group) {
    const categoryIds = uniqueIds(
      group.interestIds
        .filter((item) => item.kind !== "keyword")
        .map((item) => item.id),
    );
    const purchaseIntentionKeywordIds = uniqueIds(
      group.interestIds
        .filter(
          (item) =>
            item.kind === "keyword" &&
            item.audienceType === "PURCHASE_INTENTION",
        )
        .map((item) => item.id),
    );
    // Hashtag tool IDs are `keyword_ids` in ToolApi.md (`toolHashtagGet`).
    // AdgroupCreateBody has no hashtag_* field, so those IDs ride on
    // `interest_keyword_ids` — the only documented create field that takes
    // keyword IDs.
    const generalKeywordIds = group.interestIds
      .filter(
        (item) =>
          item.kind === "keyword" &&
          item.audienceType !== "PURCHASE_INTENTION",
      )
      .map((item) => item.id);
    const hashtagIds = group.hashtagIds.map((item) => item.id);
    if (hashtagIds.length > 0) {
      console.error(
        `[tiktok/mapping] adgroup=${adGroup.name} interest_keyword_ids merged keywords=${generalKeywordIds.length} hashtags=${hashtagIds.length} — hashtag IDs ride on interest_keyword_ids, unverified`,
      );
    }
    const interestKeywordIds = uniqueIds([...generalKeywordIds, ...hashtagIds]);
    return {
      interestCategoryIds: categoryIds,
      interestKeywordIds,
      purchaseIntentionKeywordIds,
      behaviourCategoryIds: uniqueIds(group.behaviourIds.map((item) => item.id)),
    };
  }
  return {
    interestCategoryIds: uniqueIds(draft.audiences.interestCategoryIds),
    interestKeywordIds: uniqueIds(draft.audiences.interestKeywordIds),
    purchaseIntentionKeywordIds: [],
    behaviourCategoryIds: uniqueIds(draft.audiences.behaviourCategoryIds),
  };
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function resolveBidPrice(draft: TikTokCampaignDraft): number | null {
  const goal = draft.campaignSetup.optimisationGoal;
  if (goal === "CLICK" || goal === "LANDING_PAGE_VIEW") {
    return draft.optimisation.benchmarkCpc;
  }
  if (goal === "VIDEO_VIEW" || goal === "VIEW_6_SECOND") {
    return draft.optimisation.benchmarkCpv;
  }
  if (goal === "REACH" || goal === "SHOW") {
    return draft.optimisation.benchmarkCpm;
  }
  return (
    draft.optimisation.benchmarkCpc ??
    draft.optimisation.benchmarkCpv ??
    draft.optimisation.benchmarkCpm
  );
}

function ok<T>(value: T): MappingResult<T> {
  return { ok: true, value };
}

function missing(field: string, message: string): MappingResult<never> {
  return { ok: false, error: { field, message } };
}
