/**
 * lib/meta/campaign.ts
 *
 * Pure-logic helpers for campaign creation:
 *   - Objective mapping  (internal → Meta API enum)
 *   - Payload validation (catches bad input before hitting the API)
 *   - Shared request/response types
 *
 * No API calls here — import createMetaCampaign from lib/meta/client.ts.
 */

import type { BudgetLevel, BudgetType, CampaignObjective } from "@/lib/types";

// ─── Objective mapping ────────────────────────────────────────────────────────
//
// Meta's Marketing API uses the OUTCOME_* naming scheme introduced in v13.0.
// These are the correct values for campaigns created through the API today.
// Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/
//
// Internal           Meta objective
// ─────────────────────────────────────────────────────
// purchase           →  OUTCOME_SALES      (conversions, catalog sales)
// initiate_checkout  →  OUTCOME_SALES      (same Meta objective; event differs)
// registration       →  OUTCOME_SALES      (same Meta objective; event differs)
// traffic            →  OUTCOME_TRAFFIC    (link clicks, landing page views)
// awareness          →  OUTCOME_AWARENESS  (reach, brand awareness)
// engagement         →  OUTCOME_ENGAGEMENT (post engagement, video views)
//
// registration used to map to OUTCOME_LEADS. A Meta campaign objective is
// immutable, so a signup campaign could not be duplicated in Ads Manager
// into a purchase campaign. Under OUTCOME_SALES the ad set carries the
// conversion event. Live check 2026-09-30 on act_968594768066330: paused
// campaign 120250186568200453 + ad set 120250186568390453 came back
// objective OUTCOME_SALES, optimization_goal OFFSITE_CONVERSIONS,
// destination_type WEBSITE, promoted_object.custom_event_type
// COMPLETE_REGISTRATION (pixel 361462699910737). Both objects were deleted
// after the read-back.
//
// initiate_checkout and registration are not distinct Meta objectives. The
// differentiator is promoted_object.custom_event_type on the ad set
// (INITIATED_CHECKOUT, confirmed 2026-09-10 — INITIATE_CHECKOUT is rejected;
// COMPLETE_REGISTRATION, confirmed 2026-09-30).

export const OBJECTIVE_MAP: Record<CampaignObjective, string> = {
  purchase: "OUTCOME_SALES",
  initiate_checkout: "OUTCOME_SALES",
  registration: "OUTCOME_SALES",
  traffic: "OUTCOME_TRAFFIC",
  awareness: "OUTCOME_AWARENESS",
  engagement: "OUTCOME_ENGAGEMENT",
} as const;

export function mapObjectiveToMeta(objective: CampaignObjective): string {
  const mapped = OBJECTIVE_MAP[objective];
  if (!mapped) {
    // Should never happen with a well-typed objective, but guard defensively
    console.warn(`[Meta] Unknown internal objective "${objective}", defaulting to OUTCOME_SALES`);
    return "OUTCOME_SALES";
  }
  return mapped;
}

/**
 * Meta Marketing API `promoted_object.custom_event_type` for InitiateCheckout.
 * Confirmed 2026-09-10: `INITIATE_CHECKOUT` is rejected (code 100); the
 * accepted enum is `INITIATED_CHECKOUT`. Pixel event name stays InitiateCheckout.
 */
export const META_INITIATE_CHECKOUT_EVENT = "INITIATED_CHECKOUT";

export interface MetaCampaignPayload {
  name: string;
  objective: string;
  buying_type: "AUCTION";
  status: "ACTIVE" | "PAUSED";
  /**
   * ABO marker. Omitted on CBO: the paused probes that created a campaign
   * budget (`lib/meta/__fixtures__/budget-probes/zz-budget-probe.json`)
   * did not send this field.
   */
  is_adset_budget_sharing_enabled?: false;
  special_ad_categories: [];
  /** Minor units. CBO daily only. */
  daily_budget?: number;
  /** Minor units. CBO lifetime only. */
  lifetime_budget?: number;
  /** Required on a campaign that holds the budget. Probe b and probe c. */
  bid_strategy?: "LOWEST_COST_WITHOUT_CAP";
}

export interface CampaignBudgetInput {
  level: BudgetLevel;
  type: BudgetType;
  /** Major units (£). Converted to minor units on the wire. */
  amountMajor: number;
}

/**
 * Campaign-level Graph payload. Purchase, initiate_checkout, and
 * registration are identical here (`OUTCOME_SALES`); the event lives on
 * the ad set's promoted_object.
 *
 * Ad set level (the default, including every existing daily draft) sends
 * no budget key and `is_adset_budget_sharing_enabled: false`.
 *
 * Campaign level sends `daily_budget` or `lifetime_budget` plus
 * `bid_strategy: LOWEST_COST_WITHOUT_CAP`, and omits
 * `is_adset_budget_sharing_enabled`. Campaign `stop_time` is read-only on
 * v21.0 (probe c: the POST is accepted and the field is absent on
 * readback). The end date that Meta keeps is the ad set `end_time`, which
 * then reads back as the campaign `stop_time`.
 */
export function buildCampaignPayload(input: {
  name: string;
  objective: CampaignObjective;
  status?: "ACTIVE" | "PAUSED";
  budget?: CampaignBudgetInput;
}): MetaCampaignPayload {
  const base = {
    name: input.name,
    objective: mapObjectiveToMeta(input.objective),
    buying_type: "AUCTION" as const,
    status: input.status ?? "ACTIVE",
    special_ad_categories: [] as [],
  };
  const budget = input.budget;
  if (!budget || budget.level !== "campaign") {
    return { ...base, is_adset_budget_sharing_enabled: false };
  }
  const minor = Math.round(budget.amountMajor * 100);
  if (budget.type === "lifetime") {
    return {
      ...base,
      lifetime_budget: minor,
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    };
  }
  return {
    ...base,
    daily_budget: minor,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
  };
}

/**
 * Reverse of {@link mapObjectiveToMeta}: classify a raw Meta campaign
 * objective into one of our internal `CampaignObjective` values.
 *
 * Used by the "Add to existing campaign" picker so we can mark live Meta
 * campaigns as compatible (mappable) or incompatible (objective we don't
 * support — e.g. legacy objectives like APP_INSTALLS, MESSAGES, or
 * conversion-style objectives we haven't wired up).
 *
 * `OUTCOME_SALES` maps to three internals. `COMPLETE_REGISTRATION` is
 * `registration`. The confirmed InitiateCheckout enum is
 * `initiate_checkout`. Otherwise default to `purchase` — campaign listings
 * do not include `promoted_object` (that field lives on ad sets), so a live
 * sales campaign without an event type must stay `purchase`.
 *
 * `OUTCOME_LEADS` / `LEAD_GENERATION` stay `registration`. Campaigns
 * launched before this mapping change keep that objective forever.
 *
 * Returns `undefined` when the objective is not one we recognise.
 */
export function mapMetaObjectiveToInternal(
  rawMetaObjective: string | undefined | null,
  customEventType?: string | null,
): CampaignObjective | undefined {
  if (!rawMetaObjective) return undefined;
  const v = rawMetaObjective.trim().toUpperCase();
  const event = customEventType?.trim().toUpperCase() ?? "";

  // Do not walk OBJECTIVE_MAP: purchase and initiate_checkout share
  // OUTCOME_SALES, and Object.entries order would silently pick one.
  if (
    v === "OUTCOME_SALES" ||
    v === "CONVERSIONS" ||
    v === "PRODUCT_CATALOG_SALES" ||
    v === "STORE_VISITS"
  ) {
    if (event === "COMPLETE_REGISTRATION") return "registration";
    if (event === META_INITIATE_CHECKOUT_EVENT) return "initiate_checkout";
    return "purchase";
  }
  if (v === "OUTCOME_LEADS" || v === "LEAD_GENERATION") return "registration";
  if (v === "OUTCOME_TRAFFIC" || v === "LINK_CLICKS" || v === "TRAFFIC") {
    return "traffic";
  }
  if (v === "OUTCOME_AWARENESS" || v === "REACH" || v === "BRAND_AWARENESS") {
    return "awareness";
  }
  if (
    v === "OUTCOME_ENGAGEMENT" ||
    v === "POST_ENGAGEMENT" ||
    v === "PAGE_LIKES" ||
    v === "EVENT_RESPONSES" ||
    v === "VIDEO_VIEWS"
  ) {
    return "engagement";
  }
  return undefined;
}

const SALES_FAMILY = new Set([
  "OUTCOME_SALES",
  "CONVERSIONS",
  "PRODUCT_CATALOG_SALES",
  "STORE_VISITS",
]);

/** Purchase wins a tie so a split campaign does not become a signup import. */
const SALES_TIE_BREAK: CampaignObjective[] = [
  "purchase",
  "initiate_checkout",
  "registration",
];

/**
 * Importer objective for one live campaign. Sales-family objectives are
 * decided by the ad sets' `promoted_object.custom_event_type`: the most
 * common event wins, empty events do not vote, and a tie falls through to
 * purchase. `minorityEvents` are the losing event enums, for `dropped[]`.
 * `OUTCOME_LEADS` ignores the events and stays `registration`.
 */
export function importedObjectiveFromAdSetEvents(
  rawObjective: string | null | undefined,
  events: Array<string | null | undefined>,
): { objective: CampaignObjective | undefined; minorityEvents: string[] } {
  const base = mapMetaObjectiveToInternal(rawObjective);
  if (!base) return { objective: undefined, minorityEvents: [] };
  const family = (rawObjective ?? "").trim().toUpperCase();
  if (!SALES_FAMILY.has(family)) return { objective: base, minorityEvents: [] };

  const counts = new Map<CampaignObjective, { count: number; event: string }>();
  for (const raw of events) {
    const event = raw?.trim().toUpperCase() ?? "";
    if (!event) continue;
    const voted = mapMetaObjectiveToInternal(family, event);
    if (!voted) continue;
    const prev = counts.get(voted);
    if (prev) prev.count += 1;
    else counts.set(voted, { count: 1, event });
  }
  if (counts.size === 0) return { objective: "purchase", minorityEvents: [] };

  const ranked = [...counts.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count;
    return SALES_TIE_BREAK.indexOf(a[0]) - SALES_TIE_BREAK.indexOf(b[0]);
  });
  return {
    objective: ranked[0][0],
    minorityEvents: ranked.slice(1).map(([, row]) => row.event),
  };
}

// ─── Request / response types ─────────────────────────────────────────────────

export interface CreateCampaignRequest {
  /** Real Meta ad account ID, e.g. "act_1234567890" */
  metaAdAccountId: string;
  name: string;
  objective: CampaignObjective;
  /** Explicitly passed at launch — wizard default ACTIVE; plan fan-out passes PAUSED */
  status?: "ACTIVE" | "PAUSED";
}

export interface CreateCampaignResult {
  metaCampaignId: string;
  name: string;
  status: string;
}

// ─── Payload validation ───────────────────────────────────────────────────────

export function validateCampaignPayload(payload: Partial<CreateCampaignRequest>): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  if (!payload.metaAdAccountId?.trim()) {
    errors.metaAdAccountId = "Ad account ID is required (e.g. act_1234567890)";
  } else if (!payload.metaAdAccountId.startsWith("act_")) {
    errors.metaAdAccountId = 'Ad account ID must start with "act_"';
  }

  if (!payload.name?.trim()) {
    errors.name = "Campaign name is required";
  } else if (payload.name.trim().length > 400) {
    // Meta's name limit is 400 characters
    errors.name = "Campaign name must be 400 characters or fewer";
  }

  if (!payload.objective) {
    errors.objective = "Objective is required";
  } else if (!(payload.objective in OBJECTIVE_MAP)) {
    errors.objective = `Unknown objective: ${payload.objective}`;
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}
