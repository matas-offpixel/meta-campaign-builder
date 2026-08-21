"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import {
  defaultOptimisationGoalForObjective,
  ensureTikTokCampaignNamePrefix,
  stripLockedEventCodePrefix,
  TIKTOK_BID_STRATEGIES,
  TIKTOK_BID_STRATEGY_LABELS,
  isRetiredTikTokObjective,
  TIKTOK_OBJECTIVE_LABELS,
  TIKTOK_OBJECTIVES,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
  tikTokOptimisationGoalLabel,
  validOptimisationGoalForObjective,
} from "@/lib/tiktok-wizard/campaign-setup";
import {
  applyTikTokCampaignSetupPatch,
  createDebouncedCallback,
} from "@/lib/tiktok-wizard/debounced-text-save";
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
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const mountedRef = useRef(true);
  const [nameDraft, setNameDraft] = useState(() =>
    stripLockedEventCodePrefix(
      draft.campaignSetup.eventCode,
      draft.campaignSetup.campaignName,
    ),
  );
  const nameDraftRef = useRef(nameDraft);
  nameDraftRef.current = nameDraft;

  useEffect(() => {
    setNameDraft(
      stripLockedEventCodePrefix(
        draft.campaignSetup.eventCode,
        draft.campaignSetup.campaignName,
      ),
    );
    // Reconcile only when the draft identity changes — remote echoes must
    // not fight the in-progress name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.id]);

  const eventCode = draft.campaignSetup.eventCode;
  const lockedPrefix = eventCode ? `[${eventCode}] ` : "";
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
    if (mountedRef.current) {
      setSaving(true);
      setSaveError(null);
    }
    const next = applyTikTokCampaignSetupPatch(draftRef.current, campaignSetup);
    draftRef.current = next;
    try {
      await onSave({ campaignSetup: next.campaignSetup });
    } catch (err) {
      if (mountedRef.current) {
        setSaveError(err instanceof Error ? err.message : "Failed to save campaign setup");
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  async function saveNameNow() {
    const latest = draftRef.current.campaignSetup;
    await persist({
      campaignName: ensureTikTokCampaignNamePrefix(
        latest.eventCode,
        nameDraftRef.current,
      ),
      eventCode: latest.eventCode,
    });
  }

  const nameSave = useRef(createDebouncedCallback(() => void saveNameNow()));
  useEffect(() => {
    mountedRef.current = true;
    const current = nameSave.current;
    return () => {
      mountedRef.current = false;
      current.flush();
    };
  }, []);

  function onNameChange(value: string) {
    setNameDraft(value);
    nameSave.current.schedule();
  }

  async function saveObjective(nextObjective: TikTokObjective) {
    const latest = draftRef.current.campaignSetup;
    const nextGoal =
      validOptimisationGoalForObjective(nextObjective, latest.optimisationGoal)
        ? latest.optimisationGoal
        : defaultOptimisationGoalForObjective(nextObjective);
    await persist({
      objective: nextObjective,
      optimisationGoal: nextGoal,
    });
  }

  async function saveGoal(nextGoal: TikTokOptimisationGoal) {
    await persist({
      objective: draftRef.current.campaignSetup.objective ?? objective,
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
          strategy. TikTok retired Conversions from Ads Manager — website
          registration now runs under Lead generation. Instant Form is not
          yet supported.
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
            value={nameDraft}
            onChange={(event) => onNameChange(event.target.value)}
            onBlur={() => nameSave.current.flush()}
            placeholder="Campaign name"
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
            label: tikTokOptimisationGoalLabel(value, objective),
          }))}
        />
      </div>

      {isRetiredTikTokObjective(draft.campaignSetup.objective) && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Conversions is retired in TikTok Ads Manager. Website registration
          now runs as an optimization location under Lead generation. Existing
          drafts still load and launch, but new campaigns should use Lead
          generation. This draft was not changed.
        </p>
      )}

      {draft.campaignSetup.objective === "LEAD_GENERATION" && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-foreground">Optimization location</p>
          <p className="mt-1 text-muted-foreground">
            Website — uses the TikTok pixel and optimisation event from Step 1.
            TikTok Instant Form is a second location in Ads Manager and is not
            yet supported here.
          </p>
        </div>
      )}

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
