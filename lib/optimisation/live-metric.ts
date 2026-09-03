/**
 * lib/optimisation/live-metric.ts
 *
 * Resolves a single "live metric" reading (task #120 PR A) from a raw Meta
 * ad-set insights row for whichever `RuleMetric` is PRIMARY for the
 * campaign's objective — see `OBJECTIVE_METRIC_PRIORITY` in
 * `lib/optimisation-rules.ts`, the same mapping Step 6 uses to decide which
 * rule set is "primary" in the UI.
 *
 * Pure — no Meta/Supabase imports, safe to unit-test with plain fixtures.
 */

import type { CampaignObjective, RuleMetric } from "@/lib/types";
import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import type { LiveMetricReading } from "./evaluate.ts";
import type { RuleTimeWindow } from "@/lib/types";

/** Shape of one row from `insights-fetch.ts` — see that module for the Graph parsing. */
export interface AdSetInsightMetrics {
  impressions: number;
  cpc: number | null;
  cpm: number | null;
  ctr: number | null;
  /** Meta's `cost_per_action_type`, keyed by `action_type`, already cost-per-conversion (not raw counts). */
  costPerActionType: Record<string, number>;
  /**
   * Raw action counts from Meta's `actions` field (distinct from
   * `cost_per_action_type`). Used to enforce the minimum-evidence threshold
   * before acting on a conversion rate — a rate from 1–4 conversions is noise.
   * Keys match `action_type` exactly as returned by the Graph API.
   */
  /**
   * Optional — absent means resultCount will be null (evidence check skipped).
   * Backwards-compatible with code that constructs AdSetInsightMetrics directly.
   */
  actionCountByType?: Record<string, number>;
}

/**
 * Candidate `action_type` strings Meta may use for a given conversion-based
 * `RuleMetric`, ordered most-specific-first. Mirrors the equivalent lists in
 * `lib/dashboard/glasgow-adset-rollup-fetch.ts` (REG_ACTION_TYPES /
 * PURCHASE_ACTION_TYPES) — kept as a separate, smaller list here since this
 * module only needs the PRIMARY metric per objective, not the full
 * multi-action reporting taxonomy that module resolves.
 */
const ACTION_TYPE_CANDIDATES: Partial<Record<RuleMetric, string[]>> = {
  cpr: [
    "offsite_conversion.fb_pixel_complete_registration",
    "onsite_conversion.complete_registration",
    "complete_registration",
  ],
  lpv_cost: ["landing_page_view"],
  cpa: ["offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase", "purchase"],
};

/** Direct top-level insight fields — no action_type lookup needed. */
const DIRECT_FIELD: Partial<Record<RuleMetric, keyof AdSetInsightMetrics>> = {
  cpc: "cpc",
  cpm: "cpm",
  ctr: "ctr",
};

/**
 * Resolve the campaign objective's primary metric from a raw insights row.
 * Returns `null` when the metric can't be resolved (e.g. a conversion-based
 * metric with no matching `cost_per_action_type` entry — no conversions in
 * the window yet, most likely a genuinely new ad set) so the caller can skip
 * that ad set with an honest "no metric data" reason instead of treating a
 * missing value as a 0 (which would look like a suspiciously great CPR).
 *
 * `roas` (the purchase objective's SECONDARY metric) is deliberately absent
 * from both lookup maps — PR A only evaluates primary metrics (see
 * `lib/optimisation/evaluate.ts` module doc comment).
 */
export function resolvePrimaryLiveMetric(
  objective: CampaignObjective,
  insight: AdSetInsightMetrics,
  window: RuleTimeWindow,
): LiveMetricReading | null {
  const metric = OBJECTIVE_METRIC_PRIORITY[objective].primary;

  const directField = DIRECT_FIELD[metric];
  if (directField) {
    const value = insight[directField];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    // Direct-field metrics (cpm, cpc, ctr) have no countable event — resultCount is null.
    return { name: metric, value, window, resultCount: null };
  }

  const candidates = ACTION_TYPE_CANDIDATES[metric] ?? [];
  for (const actionType of candidates) {
    const value = insight.costPerActionType[actionType];
    if (typeof value === "number" && Number.isFinite(value)) {
      // Resolve the raw count from `actionCountByType` using the same candidate list.
      // The count comes from Meta's `actions` field; the rate from `cost_per_action_type`.
      // null when actionCountByType is absent (e.g. old callers) — evidence check skipped.
      const resultCount = insight.actionCountByType?.[actionType] ?? null;
      return { name: metric, value, window, resultCount };
    }
  }
  return null;
}

/**
 * Maps a rule's `RuleTimeWindow` to Meta's `date_preset` query param.
 *
 * `"24h"` → `"yesterday"` (not `"last_1d"` — Meta rejects that; incident
 * 2026-08-18, task #120 shadow cron silent failure). A complete prior day
 * avoids partial-day noise that `"today"` would introduce on early-morning
 * ticks.
 */
export function windowToDatePreset(
  window: RuleTimeWindow,
): "yesterday" | "last_3d" | "last_7d" {
  switch (window) {
    case "24h":
      return "yesterday";
    case "3d":
      return "last_3d";
    case "7d":
      return "last_7d";
  }
}
