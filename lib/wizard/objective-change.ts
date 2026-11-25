/**
 * lib/wizard/objective-change.ts
 *
 * The Campaign step's objective change (components/steps/campaign-setup.tsx
 * handleObjectiveChange), as a pure function so the MCP's set_draft_objective
 * makes exactly the same change:
 *
 *   - the optimisation goal becomes the new objective's first goal
 *     (OPTIMISATION_GOALS_BY_OBJECTIVE);
 *   - the campaign name follows only while it is still the suggested
 *     "[CODE] Objective" name (a hand-edited name is kept);
 *   - stored optimisation rules are stamped with the objective they were
 *     written for (never regenerated: the Optimisation step offers that).
 *
 * The promoted event follows on its own: launch derives it from the
 * objective and goal (lib/meta/adset.ts buildPromotedObject).
 *
 * Relative imports only (node:test).
 */
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "../mock-data.ts";
import { inferRulesObjectiveFromRules } from "../optimisation-rules.ts";
import type { CampaignObjective, CampaignSettings, OptimisationStrategySettings } from "../types.ts";

export const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  purchase: "Purchase",
  initiate_checkout: "Initiate checkout",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

/** "[CODE] Objective", or "" with no code. */
export function suggestCampaignName(code: string, objective: CampaignObjective): string {
  if (!code) return "";
  return `[${code}] ${OBJECTIVE_LABELS[objective]}`;
}

/** The settings patch the objective cards make. */
export function objectiveChangePatch(settings: CampaignSettings, objective: CampaignObjective): Partial<CampaignSettings> {
  const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[objective];
  const newGoal = goals[0]?.value ?? settings.optimisationGoal;
  const patch: Partial<CampaignSettings> = { objective, optimisationGoal: newGoal };
  if (settings.campaignCode && settings.campaignName === suggestCampaignName(settings.campaignCode, settings.objective)) {
    patch.campaignName = suggestCampaignName(settings.campaignCode, objective);
  }
  return patch;
}

/**
 * The rules' objective stamp the change records, or null when nothing
 * changes (already stamped, or the rules don't say which objective).
 */
export function stampRulesObjective(strategy: OptimisationStrategySettings | null | undefined): OptimisationStrategySettings | null {
  if (!strategy || strategy.rulesObjective != null) return null;
  const writtenFor = inferRulesObjectiveFromRules(strategy.rules);
  return writtenFor ? { ...strategy, rulesObjective: writtenFor } : null;
}
