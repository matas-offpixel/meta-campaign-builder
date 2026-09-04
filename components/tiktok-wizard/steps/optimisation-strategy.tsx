"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface, useIsDrawer } from "@/components/steps/step-surface";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  TIKTOK_BID_STRATEGIES,
  TIKTOK_BID_STRATEGY_LABELS,
} from "@/lib/tiktok-wizard/campaign-setup";
import {
  applySmartPlusDefaults,
  disableSmartPlus,
  parseOptionalMoney,
  validateBudgetGuardrails,
} from "@/lib/tiktok-wizard/budget-schedule";
import type {
  TikTokBidStrategy,
  TikTokCampaignDraft,
} from "@/lib/types/tiktok-draft";

export function OptimisationStrategyStep({
  draft,
  onSave,
  surface = "wizard",
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  surface?: StepSurface;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const warnings = validateBudgetGuardrails({
    budget: draft.budgetSchedule,
    optimisation: draft.optimisation,
  });

  async function persist(patch: Partial<TikTokCampaignDraft>) {
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save optimisation");
    } finally {
      setSaving(false);
    }
  }

  async function setSmartPlus(enabled: boolean) {
    if (enabled) {
      await persist(applySmartPlusDefaults(draft));
      return;
    }
    await persist(disableSmartPlus(draft));
  }

  async function saveBidStrategy(nextBidStrategy: TikTokBidStrategy) {
    await persist({
      campaignSetup: {
        ...draft.campaignSetup,
        bidStrategy: nextBidStrategy,
      },
      optimisation: {
        ...draft.optimisation,
        bidStrategy: nextBidStrategy,
      },
    });
  }

  async function saveMoneyField(
    key:
      | "targetCostPerResult"
      | "benchmarkCpv"
      | "benchmarkCpc"
      | "benchmarkCpm"
      | "maxDailySpend"
      | "maxLifetimeSpend",
    value: string,
  ) {
    try {
      const parsed = parseOptionalMoney(value);
      await persist({
        optimisation: {
          ...draft.optimisation,
          [key]: parsed,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid amount.");
    }
  }

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-6">
      

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <label className="flex items-start gap-3 rounded-md border border-border bg-background p-4">
        <input
          type="checkbox"
          className="mt-1"
          checked={draft.optimisation.smartPlusEnabled}
          disabled={saving}
          onChange={(event) => void setSmartPlus(event.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-foreground">Smart+</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Locks Step 1 bid strategy to Smart+ and applies lifetime budget mode
            plus automatic scheduling defaults in Step 5.
          </span>
        </span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <Select
          id="tiktok-opt-bid-strategy"
          label="Bid strategy"
          value={
            draft.optimisation.smartPlusEnabled
              ? "SMART_PLUS"
              : (draft.optimisation.bidStrategy ??
                draft.campaignSetup.bidStrategy ??
                "")
          }
          disabled={saving || draft.optimisation.smartPlusEnabled}
          placeholder="Select bid strategy"
          onChange={(event) =>
            void saveBidStrategy(event.target.value as TikTokBidStrategy)
          }
          options={TIKTOK_BID_STRATEGIES.map((value) => ({
            value,
            label: TIKTOK_BID_STRATEGY_LABELS[value],
          }))}
        />
        {(draft.optimisation.bidStrategy ?? draft.campaignSetup.bidStrategy) ===
          "COST_CAP" && (
          <div className="space-y-2">
            <MoneyInput
              id="target-cost-per-result"
              label="Target cost per result (£)"
              value={draft.optimisation.targetCostPerResult}
              disabled={saving}
              onBlur={(value) =>
                void saveMoneyField("targetCostPerResult", value)
              }
            />
            
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MoneyInput
          id="benchmark-cpv"
          label="Target CPV (£)"
          value={draft.optimisation.benchmarkCpv}
          disabled={saving}
          onBlur={(value) => void saveMoneyField("benchmarkCpv", value)}
        />
        <MoneyInput
          id="benchmark-cpc"
          label="Target CPC (£)"
          value={draft.optimisation.benchmarkCpc}
          disabled={saving}
          onBlur={(value) => void saveMoneyField("benchmarkCpc", value)}
        />
        <MoneyInput
          id="benchmark-cpm"
          label="Target CPM (£)"
          value={draft.optimisation.benchmarkCpm}
          disabled={saving}
          onBlur={(value) => void saveMoneyField("benchmarkCpm", value)}
        />
      </div>

      <Select
        id="tiktok-pacing"
        label="Pacing"
        value={draft.optimisation.pacing}
        disabled={saving}
        onChange={(event) =>
          void persist({
            optimisation: {
              ...draft.optimisation,
              pacing: event.target.value as "STANDARD" | "ACCELERATED",
            },
          })
        }
        options={[
          { value: "STANDARD", label: "Standard" },
          { value: "ACCELERATED", label: "Accelerated" },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <MoneyInput
          id="max-daily-spend"
          label="Max daily spend (£)"
          value={draft.optimisation.maxDailySpend}
          disabled={saving}
          onBlur={(value) => void saveMoneyField("maxDailySpend", value)}
        />
        <MoneyInput
          id="max-lifetime-spend"
          label="Max lifetime spend (£)"
          value={draft.optimisation.maxLifetimeSpend}
          disabled={saving}
          onBlur={(value) => void saveMoneyField("maxLifetimeSpend", value)}
        />
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {warnings.map((warning) => (
            <Datum key={warning}>{warning}</Datum>
          ))}
        </div>
      )}

      <Datum className="mt-2 text-sm text-muted-foreground">
        Smart+ is {draft.optimisation.smartPlusEnabled ? "enabled" : "disabled"}.
      </Datum>
    </div>
      </StepSurfaceProvider>
  );
}

function MoneyInput({
  id,
  label,
  value,
  disabled,
  onBlur,
}: {
  id: string;
  label: string;
  value: number | null;
  disabled: boolean;
  onBlur: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  return (
    <Input
      id={id}
      label={label}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onBlur(draft)}
      placeholder="0.00"
    />
  );
}
