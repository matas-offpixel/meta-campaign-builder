"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { SplitBar } from "@/components/viz/split-bar";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";
import {
  PLAN_SPLIT_PRESETS,
  planSplitAmountsLine,
  planSplitSegments,
  planSplitToBudget,
} from "@/lib/plan/canvas-inputs";
import { lifetimeToDaily, scheduledDayCount } from "@/lib/plan/budget-split";
import type { CampaignPlanBudgetSplit } from "@/lib/plan/types";

/**
 * Zone C — how much, and how is it shared. Two chips for the daily /
 * lifetime pair and one bar for the split. Dragging a platform to 0%
 * turns it off: `budgetedLaunchAdapters` already treats £0 as skipped,
 * so a second toggle state could only ever disagree with the money.
 */
export function CanvasBudget({
  budget,
  mode,
  lifetime,
  startDate,
  endDate,
  hasUserEdit,
  onBudget,
  onMode,
  onLifetime,
}: {
  budget: CampaignPlanBudgetSplit;
  mode: "daily" | "lifetime";
  lifetime: number;
  startDate: string | null;
  endDate: string | null;
  hasUserEdit: boolean;
  onBudget: (next: CampaignPlanBudgetSplit) => void;
  onMode: (mode: "daily" | "lifetime") => void;
  onLifetime: (value: number) => void;
}) {
  const days = scheduledDayCount(startDate, endDate);
  const daily = budget.metaDaily + budget.tiktokDaily + budget.googleDaily;
  const total = mode === "lifetime" ? lifetime : daily;
  const derivedDaily = mode === "lifetime" && days ? lifetimeToDaily(lifetime, days) : daily;

  function commitTotal(value: number) {
    if (mode === "lifetime") {
      onLifetime(value);
      if (days) onBudget(planSplitToBudget(planSplitSegments(budget), lifetimeToDaily(value, days)));
      return;
    }
    onBudget(planSplitToBudget(planSplitSegments(budget), value));
  }

  return (
    <section aria-label="budget" className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetricChip label={mode === "lifetime" ? "total" : "per day"} size="lg">
          <span className="tabular-nums">£</span>
          <input
            className="w-20 border-0 bg-transparent p-0 text-right tabular-nums outline-none"
            aria-label={mode === "lifetime" ? "budget total" : "budget per day"}
            inputMode="decimal"
            value={total || ""}
            onChange={(event) => commitTotal(Number(event.target.value) || 0)}
          />
          <span className="text-[11px] text-muted-foreground">
            {mode === "lifetime" ? "total" : "/day"}
          </span>
        </MetricChip>
        {(["daily", "lifetime"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${
              mode === option
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
            onClick={() => onMode(option)}
          >
            {option}
          </button>
        ))}
        {mode === "lifetime" ? (
          <MetricChip label="derived per day" size="sm">
            £{Math.round(derivedDaily)}/d
          </MetricChip>
        ) : null}
        <InfoTip label={PLAN_CANVAS_COPY.splitZeroIsOff} />
      </div>

      <SplitBar
        segments={planSplitSegments(budget)}
        editable
        presets={PLAN_SPLIT_PRESETS}
        onChange={(segments) => onBudget(planSplitToBudget(segments, derivedDaily))}
        tip={hasUserEdit ? undefined : PLAN_CANVAS_COPY.splitZeroIsOff}
      />
      <div className="text-[11px] tabular-nums text-muted-foreground">
        {planSplitAmountsLine(budget)}
      </div>
    </section>
  );
}
