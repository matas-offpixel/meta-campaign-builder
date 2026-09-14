/**
 * CAPTURED 2026-09-15 — `/adgroup/get/` accepted `fields` names,
 * advertiser 7639802149165301776 (Ironworks), operator session.
 *
 * Source: the **error body**, not a success response. `POST
 * /api/tiktok/campaigns/import` on campaign 1874233177915634 returned
 *
 *   fields.32: one or more value of the param is not acceptable,
 *   correct is ['location_ids', 'product_set_id', …]
 *
 * `ADGROUP_GET_FIELDS[32]` was `"connection_type"`. TikTok rejects the
 * whole request for one bad name, so the manual import path had never
 * succeeded against the real API — and a hand-written fixture cannot
 * reject a field name, which is why CI was green through #944.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT
 * - It proves which names TikTok *accepts* in `fields`. It says nothing
 *   about what a success body *returns*.
 * - `ACCEPTED` is PARTIAL. The live body listed 152 names; the operator
 *   note transcribed the two that survived the error-string truncation
 *   plus the ones read off the body by eye. The remaining ~133 have not
 *   reached this worktree. The raw capture route added in this PR
 *   records error bodies verbatim precisely so the full list can replace
 *   this one in the capture round.
 * - `REJECTED` is exhaustive for what we have driven: TikTok reports one
 *   offending index per request, so a second bad name would not have
 *   been seen.
 */

/** Names TikTok's 2026-09-15 error body listed as acceptable. PARTIAL — see header. */
export const TIKTOK_ADGROUP_GET_ACCEPTED_FIELDS: readonly string[] = [
  // Verbatim from the error string before it was truncated.
  "location_ids",
  "product_set_id",
  // Read off the same body by the operator.
  "network_types",
  "carrier_ids",
  "isp_ids",
  "operating_systems",
  "min_android_version",
  "min_ios_version",
  "device_model_ids",
  "excluded_audience_ids",
  "saved_audience_id",
  "placements",
  "placement_type",
  "smart_audience_enabled",
  "smart_interest_behavior_enabled",
  "targeting_expansion",
  "creative_material_mode",
  "campaign_automation_type",
  "is_smart_performance_campaign",
];

/** Rejected live at `fields.32`. Not a TikTok field; it was guessed in #944. */
export const TIKTOK_ADGROUP_GET_REJECTED_FIELDS: readonly string[] = [
  "connection_type",
];

/**
 * Names `ADGROUP_GET_FIELDS` sends that are not in the partial accepted
 * list above. They are *presumed* accepted: TikTok reported index 32,
 * and a bad name at a lower index would have been reported instead — so
 * indices 0–31 are adjudicated by omission, not by transcription.
 *
 * Every entry here is a debt the capture round pays off. The test in
 * `__tests__/import.test.ts` fails if this list and the accepted list do
 * not together cover `ADGROUP_GET_FIELDS` exactly, so a new field name
 * cannot be added without landing in one of them.
 */
export const TIKTOK_ADGROUP_GET_FIELDS_PENDING_CAPTURE: readonly string[] = [
  "adgroup_id",
  "adgroup_name",
  "campaign_id",
  "budget",
  "budget_mode",
  "optimization_goal",
  "optimization_event",
  "bid_type",
  "conversion_bid_price",
  "bid_price",
  "pixel_id",
  "age_groups",
  "gender",
  "languages",
  "interest_category_ids",
  "interest_keyword_ids",
  "purchase_intention_keyword_ids",
  "audience_ids",
  "actions",
  "schedule_start_time",
  "schedule_end_time",
  "schedule_type",
  "pacing",
];
