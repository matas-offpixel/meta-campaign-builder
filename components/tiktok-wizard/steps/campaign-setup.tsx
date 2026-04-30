"use client";

import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import {
  defaultOptimisationGoalForObjective,
  ensureTikTokCampaignNamePrefix,
  stripLockedEventCodePrefix,
  TIKTOK_BID_STRATEGIES,
  TIKTOK_BID_STRATEGY_LABELS,
  TIKTOK_OBJECTIVE_LABELS,
  TIKTOK_OBJECTIVES,
  TIKTOK_OPTIMISATION_GOAL_LABELS,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
  validOptimisationGoalForObjective,
} from "@/lib/tiktok-wizard/campaign-setup";
import type {
  TikTokBidStrategy,
  TikTokCampaignDraft,
  TikTokObjective,
  TikTokOptimisationGoal,
} from "@/lib/types/tiktok-draft";

export function CampaignSetupStep({
  draft,
  onSave,
  context,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  context?: TikTokWizardContext;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const eventCode = draft.campaignSetup.eventCode;
  const lockedPrefix = eventCode ? `[${eventCode}] ` : "";
  const editableName = stripLockedEventCodePrefix(
    eventCode,
    draft.campaignSetup.campaignName,
  );
  const objective = draft.campaignSetup.objective ?? "TRAFFIC";
  const goalOptions = useMemo(
    () => TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE[objective],
    [objective],
  );
  const optimisationGoal =
    draft.campaignSetup.optimisationGoal &&
    validOptimisationGoalForObjective(objective, draft.campaignSetup.optimisationGoal)
      ? draft.campaignSetup.optimisationGoal
      : defaultOptimisationGoalForObjective(objective);
  const invalidObjectiveGoal = Boolean(
    draft.campaignSetup.objective &&
      draft.campaignSetup.optimisationGoal &&
      !validOptimisationGoalForObjective(
        draft.campaignSetup.objective,
        draft.campaignSetup.optimisationGoal,
      ),
  );

  async function persist(campaignSetup: Partial<TikTokCampaignDraft["campaignSetup"]>) {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        campaignSetup: {
          ...draft.campaignSetup,
          ...campaignSetup,
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save campaign setup");
    } finally {
      setSaving(false);
    }
  }

  async function saveName(value: string) {
    await persist({
      campaignName: ensureTikTokCampaignNamePrefix(eventCode, value),
      eventCode,
    });
  }

  async function saveObjective(nextObjective: TikTokObjective) {
    const nextGoal =
      validOptimisationGoalForObjective(
        nextObjective,
        draft.campaignSetup.optimisationGoal,
      )
        ? draft.campaignSetup.optimisationGoal
        : defaultOptimisationGoalForObjective(nextObjective);
    await persist({
      objective: nextObjective,
      optimisationGoal: nextGoal,
    });
  }

  async function saveGoal(nextGoal: TikTokOptimisationGoal) {
    await persist({
      objective,
      optimisationGoal: nextGoal,
    });
  }

  async function saveBidStrategy(nextBidStrategy: TikTokBidStrategy) {
    await persist({ bidStrategy: nextBidStrategy });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Campaign setup</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Set the TikTok campaign name, objective, optimisation goal, and bid
          strategy. Lead generation and app install objectives are deferred.
        </p>
      </div>

      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="tiktok-campaign-name" className="text-sm font-medium text-foreground">
          Campaign name
        </label>
        <div className="flex rounded-md border border-border-strong bg-background focus-within:border-primary focus-within:ring-1 focus-within:ring-ring">
          {lockedPrefix && (
            <span className="inline-flex items-center border-r border-border px-3 text-sm font-medium text-muted-foreground">
              {lockedPrefix}
            </span>
          )}
          <input
            id="tiktok-campaign-name"
            className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-40"
            value={editableName}
            onChange={(event) => void saveName(event.target.value)}
            placeholder="Campaign name"
            disabled={saving}
          />
        </div>
        {!eventCode && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Set an event_code on the event row before creating a campaign.
            {context?.eventEditPath ? (
              <>
                {" "}
                <a className="underline" href={context.eventEditPath}>
                  Open event editor
                </a>
                .
              </>
            ) : null}
          </p>
        )}
        {invalidObjectiveGoal && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            The saved objective and optimisation goal are invalid together.
            Choose a valid optimisation goal for this objective.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-objective"
          label="Objective"
          value={objective}
          onChange={(event) => void saveObjective(event.target.value as TikTokObjective)}
          disabled={saving}
          options={TIKTOK_OBJECTIVES.map((value) => ({
            value,
            label: TIKTOK_OBJECTIVE_LABELS[value],
          }))}
        />
        <Select
          id="tiktok-optimisation-goal"
          label="Optimisation goal"
          value={optimisationGoal}
          onChange={(event) => void saveGoal(event.target.value as TikTokOptimisationGoal)}
          disabled={saving}
          options={goalOptions.map((value) => ({
            value,
            label: TIKTOK_OPTIMISATION_GOAL_LABELS[value],
          }))}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-bid-strategy"
          label="Bid strategy"
          value={
            draft.optimisation.smartPlusEnabled
              ? "SMART_PLUS"
              : (draft.campaignSetup.bidStrategy ?? "")
          }
          onChange={(event) => void saveBidStrategy(event.target.value as TikTokBidStrategy)}
          disabled={saving || draft.optimisation.smartPlusEnabled}
          placeholder="Select bid strategy"
          options={TIKTOK_BID_STRATEGIES.map((value) => ({
            value,
            label: TIKTOK_BID_STRATEGY_LABELS[value],
          }))}
        />
        <Input
          id="tiktok-smart-plus-note"
          label="Smart+ linkage"
          value={
            draft.optimisation.smartPlusEnabled
              ? "Smart+ is enabled in Step 2. Bid strategy will lock there."
              : "Smart+ can be selected here or toggled in Step 2."
          }
          readOnly
        />
      </div>
    </div>
  );
}
