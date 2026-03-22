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
// purchase        →  OUTCOME_SALES      (conversions, catalog sales)
// registration    →  OUTCOME_LEADS      (lead gen, event registration)
// traffic         →  OUTCOME_TRAFFIC    (link clicks, landing page views)
// awareness       →  OUTCOME_AWARENESS  (reach, brand awareness)
// engagement      →  OUTCOME_ENGAGEMENT (post engagement, video views)

export const OBJECTIVE_MAP: Record<CampaignObjective, string> = {
  purchase: "OUTCOME_SALES",
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

// ─── Request / response types ─────────────────────────────────────────────────

export interface CreateCampaignRequest {
  /** Real Meta ad account ID, e.g. "act_1234567890" */
  metaAdAccountId: string;
  name: string;
  objective: CampaignObjective;
  /** Defaults to PAUSED — campaigns are never created live automatically */
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
