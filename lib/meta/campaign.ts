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

import type { CampaignObjective } from "@/lib/types";

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
// registration       →  OUTCOME_LEADS      (lead gen, event registration)
// traffic            →  OUTCOME_TRAFFIC    (link clicks, landing page views)
// awareness          →  OUTCOME_AWARENESS  (reach, brand awareness)
// engagement         →  OUTCOME_ENGAGEMENT (post engagement, video views)
//
// initiate_checkout is not a distinct Meta objective. The differentiator is
// promoted_object.custom_event_type on the ad set (INITIATED_CHECKOUT, confirmed
// 2026-09-10 via POST /act_…/adsets — INITIATE_CHECKOUT is rejected).

export const OBJECTIVE_MAP: Record<CampaignObjective, string> = {
  purchase: "OUTCOME_SALES",
  initiate_checkout: "OUTCOME_SALES",
  registration: "OUTCOME_LEADS",
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
  is_adset_budget_sharing_enabled: false;
  special_ad_categories: [];
}

/**
 * Campaign-level Graph payload. Purchase and initiate_checkout are identical
 * here (`OUTCOME_SALES`); the event lives on the ad set's promoted_object.
 */
export function buildCampaignPayload(input: {
  name: string;
  objective: CampaignObjective;
  status?: "ACTIVE" | "PAUSED";
}): MetaCampaignPayload {
  return {
    name: input.name,
    objective: mapObjectiveToMeta(input.objective),
    buying_type: "AUCTION",
    status: input.status ?? "ACTIVE",
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
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
 * `OUTCOME_SALES` maps to two internals. When `customEventType` is the
 * confirmed InitiateCheckout enum, return `initiate_checkout`. Otherwise
 * default to `purchase` — campaign listings do not include
 * `promoted_object` (that field lives on ad sets), so a live sales
 * campaign without an event type must not silently become
 * `initiate_checkout`.
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
