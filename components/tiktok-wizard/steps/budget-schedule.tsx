"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface, useIsDrawer } from "@/components/steps/step-surface";
import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { loadTikTokBenchmarkRows } from "@/lib/plan/launch-reads";
import { tikTokBenchmarkCost } from "@/lib/plan/benchmarks";
import { formatGbp } from "@/lib/plan/mml-budget";
import { tikTokCampaignBudgetIssue } from "@/lib/tiktok/write/mapping";
import { createClient } from "@/lib/supabase/client";
import {
  parseOptionalMoney,
  suggestFreshTikTokSchedule,
  tikTokResultLabel,
  validateBudgetGuardrails,
} from "@/lib/tiktok-wizard/budget-schedule";
import { suggestTikTokAdGroups } from "@/lib/tiktok-wizard/review";
import { tikTokAdvertiserClockLabel } from "@/lib/plan/tiktok-early";
import { TikTokInheritedStepNote } from "@/components/tiktok-wizard/inherited-step-note";
import {
  isTikTokAdsOnlyLaunchMode,
  tikTokInheritedStepNote,
  tikTokLaunchModeOf,
} from "@/lib/tiktok-wizard/launch-mode";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function BudgetScheduleStep(props: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  surface?: StepSurface;
}) {
  const mode = tikTokLaunchModeOf(props.draft);
  const note = tikTokInheritedStepNote(props.draft, "budget");
  if (note && isTikTokAdsOnlyLaunchMode(mode)) return <TikTokInheritedStepNote note={note} />;
  if (note) {
    return (
      <div className="space-y-4">
        <TikTokInheritedStepNote note={note} />
        <BudgetScheduleStepBody {...props} />
      </div>
    );
  }
  return <BudgetScheduleStepBody {...props} />;
}

function BudgetScheduleStepBody({
  draft,
  onSave,
  surface = "wizard",
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  surface?: StepSurface;
}) {
  const [budgetDraft, setBudgetDraft] = useState(
    draft.budgetSchedule.budgetAmount == null
      ? ""
      : String(draft.budgetSchedule.budgetAmount),
  );
  const [frequencyCapDraft, setFrequencyCapDraft] = useState(
    draft.budgetSchedule.frequencyCap == null
      ? ""
      : String(draft.budgetSchedule.frequencyCap),
  );
  const [targetDraft, setTargetDraft] = useState(
    draft.optimisation.targetCostPerResult == null
      ? ""
      : String(draft.optimisation.targetCostPerResult),
  );
  const [benchmarkHint, setBenchmarkHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshedSchedule = useRef(false);
  const smartPlus = draft.optimisation.smartPlusEnabled;
  const plannedAdGroups = suggestTikTokAdGroups(draft);
  const warnings = validateBudgetGuardrails({
    budget: draft.budgetSchedule,
    optimisation: draft.optimisation,
  });
  const budgetInvalid =
    draft.budgetSchedule.budgetAmount != null &&
    draft.budgetSchedule.budgetAmount <= 0;
  const campaignBudgetIssue = tikTokCampaignBudgetIssue({
    budgetAmount: draft.budgetSchedule.budgetAmount,
    budgetMode: draft.budgetSchedule.budgetMode,
    startAt: draft.budgetSchedule.scheduleStartAt,
    endAt: draft.budgetSchedule.scheduleEndAt,
    currency: draft.accountSetup.currency,
  });
  const scheduleInvalid = Boolean(
    !smartPlus &&
      draft.budgetSchedule.scheduleStartAt &&
      draft.budgetSchedule.scheduleEndAt &&
      draft.budgetSchedule.scheduleEndAt <= draft.budgetSchedule.scheduleStartAt,
  );

  async function persist(
    patch: Partial<TikTokCampaignDraft["budgetSchedule"]>,
  ) {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        budgetSchedule: {
          ...draft.budgetSchedule,
          ...patch,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget schedule");
    } finally {
      setSaving(false);
    }
  }

  async function saveBudgetAmount(raw: string) {
    try {
      const amount = parseOptionalMoney(raw);
      if (amount != null && amount <= 0) {
        setError("Set a budget greater than £0.");
        return;
      }
      await persist({
        budgetAmount: amount,
        lifetimeBudget:
          draft.budgetSchedule.budgetMode === "LIFETIME" ? amount : null,
        dailyBudget: draft.budgetSchedule.budgetMode === "DAILY" ? amount : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid budget.");
    }
  }

  async function saveTargetCost(raw: string) {
    try {
      const amount = parseOptionalMoney(raw);
      const bidStrategy = amount != null && amount > 0 ? "COST_CAP" : "LOWEST_COST";
      setSaving(true);
      setError(null);
      await onSave({
        optimisation: {
          ...draft.optimisation,
          targetCostPerResult: amount != null && amount > 0 ? amount : null,
          bidStrategy,
        },
        campaignSetup: { ...draft.campaignSetup, bidStrategy },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid target cost.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!draft.clientId) return;
    let cancelled = false;
    const unit =
      tikTokResultLabel({
        objective: draft.campaignSetup.objective,
        optimisationEvent: draft.accountSetup.optimisationEvent,
      }) === "purchase"
        ? "purchase"
        : tikTokResultLabel({
              objective: draft.campaignSetup.objective,
              optimisationEvent: draft.accountSetup.optimisationEvent,
            }) === "click"
          ? "click"
          : null;
    void loadTikTokBenchmarkRows(createClient(), draft.clientId!).then((rows) => {
      if (cancelled) return;
      const cost = tikTokBenchmarkCost(rows, { clientId: draft.clientId!, unit });
      setBenchmarkHint(cost == null ? null : `Usual TikTok cost per result ${formatGbp(cost)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.accountSetup.optimisationEvent, draft.campaignSetup.objective, draft.clientId]);

  async function saveFrequencyCap(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      await persist({ frequencyCap: null });
      return;
    }
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || value < 1) {
      setError("Frequency cap must be a positive whole number.");
      return;
    }
    await persist({ frequencyCap: value });
  }

  useEffect(() => {
    if (refreshedSchedule.current || smartPlus) return;
    const next = suggestFreshTikTokSchedule(
      draft.budgetSchedule,
      new Date(),
      draft.accountSetup.timezone,
    );
    refreshedSchedule.current = true;
    if (!next) return;
    void onSave({
      budgetSchedule: {
        ...draft.budgetSchedule,
        ...next,
      },
    });
  }, [draft.accountSetup.timezone, draft.budgetSchedule, onSave, smartPlus]);

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-6">
      

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-budget-mode"
          label="Budget mode"
          value={smartPlus ? "LIFETIME" : draft.budgetSchedule.budgetMode}
          disabled={saving || smartPlus}
          onChange={(event) => {
            const mode = event.target.value as "DAILY" | "LIFETIME";
            void persist({
              budgetMode: mode,
              lifetimeBudget: mode === "LIFETIME" ? draft.budgetSchedule.budgetAmount : null,
              dailyBudget: mode === "DAILY" ? draft.budgetSchedule.budgetAmount : null,
            });
          }}
          options={[
            { value: "DAILY", label: "Daily" },
            { value: "LIFETIME", label: "Lifetime" },
          ]}
        />
        <Input
          id="tiktok-budget-amount"
          label="Budget amount (£)"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={budgetDraft}
          disabled={saving}
          onChange={(event) => setBudgetDraft(event.target.value)}
          onBlur={() => void saveBudgetAmount(budgetDraft)}
          placeholder="1,000"
          error={
            budgetInvalid
              ? "Set a budget greater than £0"
              : campaignBudgetIssue ?? undefined
          }
        />
      </div>
      <Datum className="text-xs text-muted-foreground">
        Leave the campaign budget blank for no campaign minimum. A campaign budget must be at least £50/day. Each ad group must be at least £20/day.
      </Datum>
      <div className="max-w-sm space-y-1">
        <Input
          id="tiktok-target-cost"
          label="Target cost per result (£)"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={targetDraft}
          disabled={saving || smartPlus}
          placeholder="Lowest cost"
          onChange={(event) => setTargetDraft(event.target.value)}
          onBlur={() => void saveTargetCost(targetDraft)}
        />
        {benchmarkHint ? (
          <Datum className="text-xs text-muted-foreground">{benchmarkHint}</Datum>
        ) : null}
      </div>

      

      <div className="grid gap-4 md:grid-cols-2">
        <Input
          id="tiktok-schedule-start"
          label="Schedule start"
          type="datetime-local"
          value={draft.budgetSchedule.scheduleStartAt ?? ""}
          disabled={saving || smartPlus}
          onChange={(event) =>
            void persist({ scheduleStartAt: event.target.value || null })
          }
          error={scheduleInvalid ? "Schedule end must be after start" : undefined}
        />
        <Input
          id="tiktok-schedule-end"
          label="Schedule end"
          type="datetime-local"
          value={draft.budgetSchedule.scheduleEndAt ?? ""}
          disabled={saving || smartPlus}
          onChange={(event) =>
            void persist({ scheduleEndAt: event.target.value || null })
          }
          error={scheduleInvalid ? "Schedule end must be after start" : undefined}
        />
      </div>
      {draft.accountSetup.timezone ? (
        <Datum className="text-xs text-muted-foreground">
          {tikTokAdvertiserClockLabel(draft.accountSetup.timezone)}
        </Datum>
      ) : null}

      <Input
        id="tiktok-frequency-cap"
        label="Frequency cap"
        type="text"
        inputMode="numeric"
        value={frequencyCapDraft}
        disabled={saving}
        onChange={(event) => setFrequencyCapDraft(event.target.value)}
        onBlur={() => void saveFrequencyCap(frequencyCapDraft)}
        placeholder="Optional impressions per period"
      />

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {warnings.map((warning) => (
            <Datum key={warning}>{warning}</Datum>
          ))}
        </div>
      )}

      
    </div>
      </StepSurfaceProvider>
  );
}
