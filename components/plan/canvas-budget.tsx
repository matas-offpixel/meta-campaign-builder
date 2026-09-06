"use client";

import { SegmentedControl } from "@/components/plan/segmented-control";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { SplitBar } from "@/components/viz/split-bar";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";
import {
  PLAN_SPLIT_PRESETS,
  planSplitSegments,
  planSplitToBudget,
} from "@/lib/plan/canvas-inputs";
import {
  LAUNCH_INFO_VARIANT,
  formatHistoryEmpty,
  formatSkippedShare,
  formatYouSetThis,
} from "@/lib/plan/launch-face";
import { lifetimeToDaily, scheduledDayCount } from "@/lib/plan/budget-split";
import type { CampaignPlanBudgetSplit } from "@/lib/plan/types";
import { VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";

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
  clientName,
  onBudget,
  onMode,
  onLifetime,
  readOnly = false,
}: {
  budget: CampaignPlanBudgetSplit;
  mode: "daily" | "lifetime";
  lifetime: number;
  startDate: string | null;
  endDate: string | null;
  hasUserEdit: boolean;
  clientName?: string | null;
  onBudget: (next: CampaignPlanBudgetSplit) => void;
  onMode: (mode: "daily" | "lifetime") => void;
  onLifetime: (value: number) => void;
  readOnly?: boolean;
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
    <section aria-label="budget" className="min-h-[80px] space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <MetricChip label={mode === "lifetime" ? "total" : "per day"} size="lg">
          <span className={VIZ_TYPE.display}>£</span>
          {readOnly ? (
            <span className={VIZ_TYPE.display}>{total || "—"}</span>
          ) : (
            <input
              className={`w-20 border-0 bg-transparent p-0 text-right outline-none ${VIZ_TYPE.display}`}
              aria-label={mode === "lifetime" ? "budget total" : "budget per day"}
              inputMode="decimal"
              value={total || ""}
              onChange={(event) => commitTotal(Number(event.target.value) || 0)}
            />
          )}
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>
            {mode === "lifetime" ? "total" : "/day"}
          </span>
        </MetricChip>
        {readOnly ? null : (
          <SegmentedControl
            ariaLabel="budget mode"
            value={mode}
            onChange={(next) => {
              if (next) onMode(next);
            }}
            options={[
              { id: "daily", label: "daily" },
              { id: "lifetime", label: "lifetime" },
            ]}
          />
        )}
        {mode === "lifetime" ? (
          <MetricChip label="derived per day" size="sm">
            £{Math.round(derivedDaily)}/d
          </MetricChip>
        ) : null}
        <InfoTip
          variant={LAUNCH_INFO_VARIANT}
          label={[PLAN_CANVAS_COPY.splitZeroIsOff, formatYouSetThis(hasUserEdit)]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>

      <SplitBar
        segments={planSplitSegments(budget)}
        editable={!readOnly}
        presets={readOnly ? undefined : PLAN_SPLIT_PRESETS}
        outlines={{
          usual: {
            pct: PLAN_SPLIT_PRESETS[1]!.pct,
            source: "client-preset",
          },
          history: null,
        }}
        historySentence={
          clientName
            ? [formatHistoryEmpty("tiktok", clientName), formatHistoryEmpty("google", clientName)].join(
                " · ",
              )
            : undefined
        }
        onChange={
          readOnly ? undefined : (segments) => onBudget(planSplitToBudget(segments, derivedDaily))
        }
      />
      {planSplitSegments(budget)
        .filter((segment) => segment.pct === 0)
        .map((segment) => (
          <span key={segment.platform} className={`block ${VIZ_TYPE_NUM.body} text-muted-foreground`}>
            {formatSkippedShare(0, segment.platform)}
          </span>
        ))}
    </section>
  );
}
