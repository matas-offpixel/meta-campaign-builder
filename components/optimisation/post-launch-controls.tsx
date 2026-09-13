"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { BudgetGuardrailsCard } from "@/components/steps/budget-guardrails-card";
import { Button } from "@/components/ui/button";
import { Datum, StatusLine } from "@/components/steps/step-surface";
import {
  controlsFromStrategy,
  type ArmedCampaignRow,
} from "@/lib/optimisation/armed-read-model";
import type { BudgetGuardrails, OptimisationStrategySettings } from "@/lib/types";
import { VIZ_TYPE } from "@/lib/viz/tokens";

export function PostLaunchControls({
  row,
  onSaved,
}: {
  row: ArmedCampaignRow;
  onSaved: (next: Partial<ArmedCampaignRow>) => void;
}) {
  const [target, setTarget] = useState(row.controls.campaignTargetValue ?? "");
  const [guardrails, setGuardrails] = useState<BudgetGuardrails>(row.controls.guardrails);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = row.arm === "live";
  const nextTick = new Date(row.nextTickAt).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const save = async (patch: {
    campaignTargetValue?: number;
    regenerateFromTarget?: boolean;
    guardrails?: BudgetGuardrails;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/optimisation/campaigns/${row.id}/controls`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        strategy?: OptimisationStrategySettings;
      };
      if (!res.ok || json.ok === false || !json.strategy) {
        setError(json.error ?? "Could not save");
        return;
      }
      const controls = controlsFromStrategy(
        json.strategy,
        row.controls.objective,
        row.controls.currency,
      );
      setTarget(controls.campaignTargetValue ?? "");
      setGuardrails(controls.guardrails);
      onSaved({ controls });
    } catch {
      setError("Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-border pt-3">
      {live ? (
        <StatusLine className="text-amber-800 dark:text-amber-200">
          This campaign is Live. A guardrail edit changes what the next tick
          writes, at {nextTick} London time — within four hours.
        </StatusLine>
      ) : (
        <Datum className="text-muted-foreground">
          Shadow logs only. These numbers still bind if you arm Live before the
          next tick ({nextTick} London).
        </Datum>
      )}

      <div>
        <label className={`mb-1 block font-medium text-muted-foreground ${VIZ_TYPE.label}`}>
          Campaign target
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            step="any"
            value={target}
            disabled={!row.canWrite || saving}
            onChange={(e) => setTarget(e.target.value === "" ? "" : Number(e.target.value))}
            className={`h-8 w-28 rounded-md border border-border bg-background px-2 ${VIZ_TYPE.body}`}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!row.canWrite || saving || target === ""}
            onClick={() =>
              void save({ campaignTargetValue: Number(target) })
            }
          >
            Save target
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!row.canWrite || saving || target === ""}
            onClick={() =>
              void save({
                campaignTargetValue: Number(target),
                regenerateFromTarget: true,
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Regenerate from target
          </Button>
        </div>
        <Datum className="mt-1 text-muted-foreground">
          Saving the target does not rewrite the ladder. Regenerating does —
          that is a second click.
        </Datum>
      </div>

      <BudgetGuardrailsCard
        guardrails={guardrails}
        currency={row.controls.currency}
        budgetAmount={row.controls.baseCampaignBudget}
        onChange={setGuardrails}
      />
      <Button
        type="button"
        size="sm"
        disabled={!row.canWrite || saving}
        onClick={() => void save({ guardrails })}
      >
        Save ceilings
      </Button>
      {error ? (
        <StatusLine tone="alert" className="text-destructive">
          {error}
        </StatusLine>
      ) : null}
    </div>
  );
}
