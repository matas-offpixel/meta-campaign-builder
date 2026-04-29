"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  parseOptionalMoney,
  validateBudgetGuardrails,
} from "@/lib/tiktok-wizard/budget-schedule";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function BudgetScheduleStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const smartPlus = draft.optimisation.smartPlusEnabled;
  const warnings = validateBudgetGuardrails({
    budget: draft.budgetSchedule,
    optimisation: draft.optimisation,
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Budget & schedule</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Set daily or lifetime budget, schedule, and optional frequency cap.
          Smart+ locks this step to lifetime budget mode and automatic schedule.
        </p>
      </div>

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
        />
      </div>

      {smartPlus && (
        <p className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
          Smart+ is enabled, so budget mode is locked to lifetime and schedule
          is automatic.
        </p>
      )}

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
        />
      </div>

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
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {draft.budgetSchedule.adGroups.length} ad groups planned. Ad-group
        suggestions are generated in Step 6.
      </p>
    </div>
  );
}
