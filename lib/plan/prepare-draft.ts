import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import {
  objectiveForTargetUnit,
  optimisationGoalForTargetUnit,
} from "./target-unit.ts";
import type { CampaignPlan, PlanAdapterName } from "./types.ts";
import {
  materialiseStrategy,
  resolvePreset,
  type ClientOptimisationPreset,
} from "../optimisation/presets.ts";
import type { CampaignDraft, CampaignObjective } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

export type PreparableAdapter = PlanAdapterName;

export function wizardHrefForDraft(
  adapter: PlanAdapterName,
  draftId: string,
): string | null {
  if (adapter === "meta") return `/campaign/${draftId}`;
  if (adapter === "tiktok") return `/tiktok-campaign/${draftId}`;
  if (adapter === "google") return `/google-search/${draftId}`;
  return null;
}

export function resolvePreparedDraftId(
  existingDraftId: string | null | undefined,
  createdDraftId: string,
): { draftId: string; reused: boolean } {
  if (existingDraftId) return { draftId: existingDraftId, reused: true };
  return { draftId: createdDraftId, reused: false };
}

export function buildPrefillMetaDraft(
  plan: CampaignPlan,
  clientId?: string | null,
  presets?: readonly ClientOptimisationPreset[] | null,
): CampaignDraft {
  const draft = planToMetaDraft(plan);
  if (clientId) draft.settings.clientId = clientId;
  return applyOptimisationPreset(draft, plan, clientId ?? null, presets ?? null);
}

/**
 * The objective the plan's optimisation ladder is keyed on.
 *
 * The target unit wins when there is one — `◎ £1.20 / reg` says
 * "registration" more precisely than a plan-level objective intent an
 * operator may have set before picking the unit. Falls back to
 * `objectiveIntent` otherwise.
 */
export function planLadderObjective(plan: CampaignPlan): CampaignObjective {
  const unit = plan.intent.target.unit;
  return unit ? objectiveForTargetUnit(unit) : plan.intent.objectiveIntent;
}

/**
 * Materialise the client's optimisation policy onto a fresh Meta draft.
 *
 * This is the ONE place a preset becomes a campaign's strategy: from here
 * on the draft owns its own copy, and `lib/optimisation/tick-runner.ts`
 * reads that copy exactly as it does today. Editing the preset afterwards
 * changes nothing about this draft.
 *
 * With no client id there is nothing to resolve against, so the draft keeps
 * the wizard's own default strategy and step 2 renders as it always has.
 */
export function applyOptimisationPreset(
  draft: CampaignDraft,
  plan: CampaignPlan,
  clientId: string | null,
  presets: readonly ClientOptimisationPreset[] | null,
  now: string = new Date().toISOString(),
): CampaignDraft {
  if (!clientId) return draft;

  const objective = planLadderObjective(plan);
  const { preset } = resolvePreset(clientId, objective, presets);

  draft.settings.objective = objective;
  // The unit implies the optimisation goal too — `/ reg` means
  // `complete_registration`, which is more specific than the adapter's
  // conversions/reach split. Left alone when there is no unit.
  if (plan.intent.target.unit) {
    draft.settings.optimisationGoal = optimisationGoalForTargetUnit(
      plan.intent.target.unit,
    );
  }
  draft.optimisationStrategy = materialiseStrategy(preset, {
    value: plan.intent.target.value,
    unit: plan.intent.target.unit,
    budgetAmount: plan.intent.budget.metaDaily,
    materialisedAt: now,
  });
  return draft;
}

export function buildPrefillTikTokDraft(
  plan: CampaignPlan,
  clientId?: string | null,
): TikTokCampaignDraft {
  const draft = planToTikTokDraft(plan);
  if (clientId) draft.clientId = clientId;
  return draft;
}

/**
 * Google prep is only refused when there is no Meta draft to derive from.
 * With a Meta draft the seed keywords are the Meta targeting vocabulary
 * verbatim — still not invented, just no longer empty.
 */
export const GOOGLE_PREPARE_REASON =
  "google_keywords_not_invented — build the Meta campaign first; Google seed keywords are derived from the Meta targeting vocabulary, never guessed";
