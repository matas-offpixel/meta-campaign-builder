"use client";

import { useState } from "react";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PLAN_CANVAS_COPY, joinInfoTips } from "@/lib/plan/canvas";
import {
  PLAN_TARGET_UNITS,
  planEffectiveTargetUnit,
} from "@/lib/plan/canvas-inputs";
import { PLAN_OBJECTIVE_OPTIONS } from "@/lib/plan/empty-plan";
import {
  LAUNCH_INFO_VARIANT,
  formatGbp,
  launchTargetView,
} from "@/lib/plan/launch-face";
import { targetUnitSpec } from "@/lib/plan/target-unit";
import type { CampaignPlanObjectiveIntent } from "@/lib/plan/types";
import type { PlanTargetUnit } from "@/lib/types";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Zone D — what are we aiming for. Chip and evidence line share
 * `launchTargetView` — never a preset number beside a starting-point line.
 */
export function CanvasTarget({
  value,
  unit,
  objectiveIntent,
  presetHref,
  onTarget,
  onUnit,
  onObjective,
  generalSaleAt,
  presaleAt,
  kind,
  venueName,
  now,
  ticketSource,
}: {
  value: number | null;
  unit: PlanTargetUnit | null;
  objectiveIntent: CampaignPlanObjectiveIntent;
  presetHref: string | null;
  onTarget: (next: number | null) => void;
  onUnit: (next: PlanTargetUnit | null) => void;
  onObjective: (next: CampaignPlanObjectiveIntent) => void;
  generalSaleAt?: string | null;
  presaleAt?: string | null;
  kind?: string | null;
  venueName?: string | null;
  now?: Date;
  ticketSource?: "none" | "manual" | "xlsx_import" | "eventbrite" | "fourthefans" | "unknown";
}) {
  const view = launchTargetView({
    now: now ?? new Date(),
    generalSaleAt,
    presaleAt,
    kind,
    venueName,
    operatorTarget: value,
    ticketSource,
  });
  const effective = planEffectiveTargetUnit(unit, objectiveIntent);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? view.chipValue));
  const tip = joinInfoTips(
    view.showComputedToday && "computed today",
    effective.inferred ? PLAN_CANVAS_COPY.unitInferred : PLAN_CANVAS_COPY.unitChangesObjective,
    !effective.unit && PLAN_CANVAS_COPY.noUnit,
  );

  function commit() {
    const next = Number(draft);
    onTarget(Number.isFinite(next) && next > 0 ? next : null);
    setEditing(false);
  }

  return (
    <section aria-label="target" className="flex min-h-[80px] flex-wrap items-center gap-1.5">
      {editing && effective.unit ? (
        <MetricChip label="target" size="lg">
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>◎ £</span>
          <input
            autoFocus
            className={`w-20 border-0 bg-transparent p-0 text-right outline-none ${VIZ_TYPE.display}`}
            aria-label="target value"
            inputMode="decimal"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") setEditing(false);
            }}
          />
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>
            per {view.unitWord}
          </span>
        </MetricChip>
      ) : (
        <button
          type="button"
          aria-label="edit target"
          onClick={() => {
            setDraft(String(value ?? view.chipValue));
            setEditing(true);
          }}
          disabled={!effective.unit}
        >
          <MetricChip
            label="target"
            size="lg"
            value={view.chipValue}
            benchmark={view.benchmark}
            lineKind={view.lineKind}
            infoHeader={view.infoHeader}
          >
            {effective.unit ? (
              <>
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>◎</span>
                <span>{formatGbp(view.chipValue)}</span>
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>
                  per {view.unitWord}
                </span>
              </>
            ) : (
              <span className={VIZ_TYPE.label}>— · no unit</span>
            )}
          </MetricChip>
        </button>
      )}
      <InfoTip
        variant={LAUNCH_INFO_VARIANT}
        header={view.infoHeader}
        label={tip}
      />

      {effective.unit ? null : (
        <label className="inline-flex items-center gap-1">
          <span className="sr-only">Objective</span>
          <select
            className={`rounded-sm border border-border bg-background px-1.5 py-0.5 ${VIZ_TYPE.label}`}
            value={objectiveIntent}
            onChange={(event) =>
              onObjective(event.target.value as CampaignPlanObjectiveIntent)
            }
          >
            {PLAN_OBJECTIVE_OPTIONS.map((objective) => (
              <option key={objective} value={objective}>
                {objective}
              </option>
            ))}
          </select>
        </label>
      )}

      <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{view.evidence}</span>
      {view.purchaseLine ? (
        <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{view.purchaseLine}</span>
      ) : null}

      <details className={`${VIZ_TYPE.label} text-muted-foreground`}>
        <summary>details</summary>
        <label className="mt-1 inline-flex items-center gap-1">
          <span>unit</span>
          <select
            className={`rounded-sm border border-border bg-background px-1.5 py-0.5 ${VIZ_TYPE.label}`}
            aria-label="target unit"
            value={unit ?? ""}
            onChange={(event) =>
              onUnit((event.target.value || null) as PlanTargetUnit | null)
            }
          >
            <option value="">phase</option>
            {PLAN_TARGET_UNITS.map((option) => (
              <option key={option} value={option}>
                {targetUnitSpec(option).label}
              </option>
            ))}
          </select>
        </label>
      </details>

      {presetHref ? (
        <a
          href={presetHref}
          className={`${VIZ_TYPE.label} text-muted-foreground underline underline-offset-2 hover:text-foreground`}
        >
          ⌁ preset · edit
        </a>
      ) : null}
    </section>
  );
}
