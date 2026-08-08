import type { CampaignObjective, OptimisationGoal } from "@/lib/types";

/**
 * Source of truth for whether Meta's Advantage+ Audience
 * (`targeting.targeting_automation.advantage_audience: 1`) can be requested
 * for a given campaign objective / optimisation goal combo.
 *
 * Meta rejects the flag outright at ad-set-create time (code 100, subcode
 * 1870196 — "The targeting automation type passed is invalid") for
 * objective/goal combos it doesn't support. Historically the app only found
 * out about this reactively, via `isInvalidTargetingAutomationError` in
 * `lib/meta/error-classify.ts` stripping the flag and retrying inside the
 * salvage ladder (`lib/audiences/adset-create-with-salvage.ts`). That salvage
 * still succeeds, but it silently produces an ad set identical to a
 * strict-mode sibling — confusing for an operator who duplicated an ad set
 * specifically to A/B Advantage+ vs strict targeting.
 *
 * Reproducer (task #116 → this fix, task #126): East End Dubs Newcastle
 * signup v2 (draft `1c8381cb-d4b3-4a72-a7bc-a56d0e139b28`) — "Similar Pages"
 * and "Similar Pages (copy)" both published strict with no delivery
 * difference, because the campaign objective silently rejected Advantage+ on
 * the copy.
 *
 * Per Meta docs (API v23.0):
 *   - Supported: OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_SALES,
 *     OUTCOME_APP_PROMOTION (this app has no app-promotion objective yet).
 *   - NOT supported: OUTCOME_AWARENESS (any optimisation goal), and
 *     OUTCOME_LEADS with a LEAD_GENERATION-style optimisation goal — this
 *     app's `"registration"` objective (→ `OUTCOME_LEADS`, see
 *     `OBJECTIVE_MAP` in `lib/meta/campaign.ts`) always resolves to that
 *     shape today (both of its valid goals, `conversions` and
 *     `complete_registration`, map to `OFFSITE_CONVERSIONS` — see
 *     `OPTIMISATION_GOAL_MAP` in `lib/meta/adset.ts` — which Meta treats the
 *     same way for Advantage+ eligibility under `OUTCOME_LEADS`).
 *
 * Keyed by objective first (not a flat allow-list) so a future
 * objective/goal combo that Meta supports on some goals but not others can
 * be modelled precisely without touching call sites.
 */
const UNSUPPORTED_GOALS_BY_OBJECTIVE: Partial<
  Record<CampaignObjective, ReadonlySet<OptimisationGoal> | "all">
> = {
  awareness: "all",
  registration: "all",
};

export function isAdvantageAudienceSupportedForObjective(
  objective: CampaignObjective,
  optimisationGoal: OptimisationGoal,
): boolean {
  const rule = UNSUPPORTED_GOALS_BY_OBJECTIVE[objective];
  if (rule === "all") return false;
  if (rule && rule.has(optimisationGoal)) return false;
  return true;
}

const OBJECTIVE_DISPLAY_NAMES: Record<CampaignObjective, string> = {
  purchase: "Purchase",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

/** Human-readable label for the objective, for UI copy (tooltips, warnings). */
export function objectiveDisplayName(objective: CampaignObjective): string {
  return OBJECTIVE_DISPLAY_NAMES[objective] ?? objective;
}

/**
 * Launch-time preflight message (task #126, FIX 4) for an ad set that has
 * `advantagePlus: true` on an objective Meta will reject it for. Used by
 * `launch-campaign/route.ts` to fail fast — before ever calling
 * `createMetaAdSet` — instead of letting the ad set create fail with
 * subcode 1870196 and get silently "fixed" by the salvage ladder's 1870196
 * handler (`lib/audiences/adset-create-with-salvage.ts`), which still
 * succeeds but produces an ad set indistinguishable from a strict-mode
 * sibling with no warning to the operator.
 */
export function advantageAudienceObjectiveMismatchMessage(
  adSetName: string,
  objective: CampaignObjective,
): string {
  return (
    `"${adSetName}" has Advantage+ Audience enabled, but Meta doesn't support Advantage+ Audience for ` +
    `${objectiveDisplayName(objective)} campaigns (Meta error subcode 1870196). Turn off Advantage+ Audience for ` +
    `this ad set in Step 5 — Budget & Schedule (or duplicate it and keep the duplicate strict) before launching.`
  );
}
