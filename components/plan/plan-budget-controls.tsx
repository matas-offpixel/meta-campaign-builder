"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { PlatformToggle } from "@/components/viz/platform-toggle";
import {
  PLAN_BUDGET_PLATFORMS,
  PLAN_BUDGET_PRESETS,
  applyPreset,
  budgetVariancePence,
  dailyKey,
  lifetimeToDaily,
  scheduledDayCount,
  selectionFromBudget,
  splitLockedEdit,
  type PlanBudgetPlatform,
  type PlanBudgetPresetId,
  type PlanBudgetSelection,
} from "@/lib/plan/budget-split";
import type { CampaignPlanBudgetSplit } from "@/lib/plan/types";

export function PlanBudgetControls({
  budget,
  startDate,
  endDate,
  selected,
  presetId,
  mode,
  lifetime,
  onBudget,
  onSelected,
  onPreset,
  onMode,
  onLifetime,
}: {
  budget: CampaignPlanBudgetSplit;
  startDate: string | null;
  endDate: string | null;
  selected: PlanBudgetSelection;
  presetId: PlanBudgetPresetId | null;
  mode: "daily" | "lifetime";
  lifetime: number;
  onBudget: (next: CampaignPlanBudgetSplit) => void;
  onSelected: (next: PlanBudgetSelection) => void;
  onPreset: (id: PlanBudgetPresetId | null) => void;
  onMode: (mode: "daily" | "lifetime") => void;
  onLifetime: (value: number) => void;
}) {
  const days = scheduledDayCount(startDate, endDate);
  const locked = presetId != null;
  const dailyTotal = mode === "lifetime" && days != null ? lifetimeToDaily(lifetime, days) : budget.totalDaily;
  const variance = budgetVariancePence(budget, dailyTotal);
  const lifetimeInert = mode === "lifetime" && days == null;

  function applyTotal(total: number, nextSelected = selected, nextPreset = presetId) {
    if (nextPreset) {
      onBudget(applyPreset(total, nextPreset, nextSelected));
      return;
    }
    onBudget({ ...budget, totalDaily: total });
  }

  function togglePlatform(platform: PlanBudgetPlatform, on: boolean) {
    const next = { ...selected, [platform]: on };
    onSelected(next);
    const total = dailyTotal;
    if (presetId) {
      onBudget(applyPreset(total, presetId, next));
      return;
    }
    if (!on) {
      onBudget({ ...budget, [dailyKey(platform)]: 0, totalDaily: budget.totalDaily });
      return;
    }
    const restored = budget[dailyKey(platform)];
    if (restored > 0) return;
    // Reselect after a zero: keep draft, leave 0 so the operator types a share.
  }

  function toggleAll() {
    const allOn = PLAN_BUDGET_PLATFORMS.every((platform) => selected[platform]);
    const next: PlanBudgetSelection = allOn
      ? { meta: true, tiktok: true, google: true }
      : { meta: true, tiktok: true, google: true };
    if (allOn) {
      // All stays all-on — it is a select-all, not a flip.
      onSelected(next);
      if (presetId) onBudget(applyPreset(dailyTotal, presetId, next));
      return;
    }
    onSelected(next);
    if (presetId) onBudget(applyPreset(dailyTotal, presetId, next));
  }

  function editPlatform(platform: PlanBudgetPlatform, value: number) {
    if (locked) {
      onBudget(splitLockedEdit(budget, selected, platform, value, dailyTotal));
      return;
    }
    onBudget({ ...budget, [dailyKey(platform)]: value });
  }

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
            PLAN_BUDGET_PLATFORMS.every((platform) => selected[platform])
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground"
          }`}
          onClick={toggleAll}
        >
          All
        </button>
        {PLAN_BUDGET_PLATFORMS.map((platform) => (
          <PlatformToggle
            key={platform}
            platform={platform}
            checked={selected[platform]}
            onChange={(checked) => togglePlatform(platform, checked)}
          />
        ))}
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              mode === "daily" ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
            onClick={() => onMode("daily")}
          >
            Daily
          </button>
          <button
            type="button"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              mode === "lifetime" ? "border-foreground bg-foreground text-background" : "border-border"
            }`}
            onClick={() => onMode("lifetime")}
          >
            Lifetime
          </button>
          <InfoTip label="Lifetime divides by scheduled days into the daily figures adapters already consume." />
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {mode === "lifetime" ? (
          <label className="block text-sm">
            <span className="text-muted-foreground">Total</span>
            <input
              type="number"
              min={0}
              step="0.01"
              disabled={lifetimeInert}
              className="mt-1 w-32 rounded-md border border-border bg-background px-3 py-2"
              value={lifetime || ""}
              onChange={(event) => {
                const value = Number(event.target.value) || 0;
                onLifetime(value);
                if (days != null) applyTotal(lifetimeToDaily(value, days));
              }}
            />
          </label>
        ) : (
          <label className="block text-sm">
            <span className="text-muted-foreground">Total £/day</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="mt-1 w-32 rounded-md border border-border bg-background px-3 py-2"
              value={budget.totalDaily || ""}
              onChange={(event) => applyTotal(Number(event.target.value) || 0)}
            />
          </label>
        )}
        {mode === "lifetime" ? (
          lifetimeInert ? (
            <MetricChip label="Set a start and end date to use lifetime">No schedule</MetricChip>
          ) : (
            <MetricChip label={`${dailyTotal} per day`}>£{dailyTotal}/d</MetricChip>
          )
        ) : null}
        {PLAN_BUDGET_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              presetId === preset.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
            onClick={() => {
              const next = presetId === preset.id ? null : preset.id;
              onPreset(next);
              if (next) onBudget(applyPreset(dailyTotal, next, selected));
            }}
          >
            {preset.id.replaceAll("-", "/")}
          </button>
        ))}
        {!locked && variance !== 0 ? (
          <MetricChip
            label={variance > 0 ? "Over the total" : "Under the total"}
            className="border-warning text-warning"
          >
            {variance > 0 ? "+" : ""}
            {(variance / 100).toFixed(2)}
          </MetricChip>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        {PLAN_BUDGET_PLATFORMS.map((platform) => (
          <label key={platform} className={`block ${selected[platform] ? "" : "opacity-40"}`}>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <PlatformGlyph platform={platform} size="sm" />
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              disabled={!selected[platform] || lifetimeInert}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2"
              value={budget[dailyKey(platform)] || ""}
              onChange={(event) => editPlatform(platform, Number(event.target.value) || 0)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export { selectionFromBudget };
