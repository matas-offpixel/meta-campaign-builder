"use client";

import { useState } from "react";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PLAN_CANVAS_COPY, joinInfoTips } from "@/lib/plan/canvas";
import {
  planEffectiveTargetUnit,
  planTargetChip,
} from "@/lib/plan/canvas-inputs";
import { PLAN_OBJECTIVE_OPTIONS } from "@/lib/plan/empty-plan";
import {
  LAUNCH_INFO_VARIANT,
  formatStartingPoint,
  formatTargetFromShows,
  launchReadingUnit,
  launchUnitWord,
} from "@/lib/plan/launch-face";
import { targetUnitSpec } from "@/lib/plan/target-unit";
import type { CampaignPlanObjectiveIntent } from "@/lib/plan/types";
import type { PlanTargetUnit } from "@/lib/types";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Zone D — what are we aiming for. The one per-campaign answer of the
 * fourteen Optimisation Strategy fields; the other thirteen are the
 * client preset, reachable through the `⌁` badge (#877).
 *
 * The objective select only exists in the no-unit state. Every unit
 * implies an objective, so exposing both would let the operator declare
 * a contradiction the preset cannot price.
 */
export function CanvasTarget({
  value,
  unit,
  benchmark,
  objectiveIntent,
  presetHref,
  onTarget,
  onUnit: _onUnit,
  onObjective,
  generalSaleAt,
  kind,
  historyN = 0,
  venueName,
}: {
  value: number | null;
  unit: PlanTargetUnit | null;
  benchmark: number | null;
  objectiveIntent: CampaignPlanObjectiveIntent;
  presetHref: string | null;
  onTarget: (next: number | null) => void;
  onUnit: (next: PlanTargetUnit | null) => void;
  onObjective: (next: CampaignPlanObjectiveIntent) => void;
  generalSaleAt?: string | null;
  kind?: string | null;
  /** Other runs with spend and results. 0 until the benchmark view exists. */
  historyN?: number;
  venueName?: string | null;
}) {
  void _onUnit;
  const phaseUnit = launchReadingUnit({
    now: new Date(),
    generalSaleAt,
    kind,
  });
  const effective = planEffectiveTargetUnit(unit, objectiveIntent);
  const chip = planTargetChip({ value, unit: effective.unit, benchmark });
  const evidence =
    historyN <= 0
      ? formatStartingPoint(phaseUnit)
      : formatTargetFromShows(historyN, venueName?.trim() || "this venue");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? benchmark ?? ""));
  const unitLabel = effective.unit ? targetUnitSpec(effective.unit).label : null;
  const tip = joinInfoTips(
    chip.seeded && evidence,
    "computed today",
    effective.inferred ? PLAN_CANVAS_COPY.unitInferred : PLAN_CANVAS_COPY.unitChangesObjective,
    chip.needsObjective && PLAN_CANVAS_COPY.noUnit,
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
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>/ {unitLabel}</span>
        </MetricChip>
      ) : (
        <button
          type="button"
          aria-label="edit target"
          onClick={() => {
            setDraft(String(value ?? benchmark ?? ""));
            setEditing(true);
          }}
          disabled={!effective.unit}
        >
          <MetricChip
            label="target"
            size="lg"
            lineKind={historyN < 3 ? "estimated" : "measured"}
          >
            {chip.needsObjective ? (
              <span className={VIZ_TYPE.label}>{chip.label}</span>
            ) : (
              <>
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>◎</span>
                <span>{chip.label.replace(/^◎\s*/, "").replace(/\s*\/\s*\S+$/, "")}</span>
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>
                  per {launchUnitWord(phaseUnit)}
                </span>
              </>
            )}
          </MetricChip>
        </button>
      )}
      <InfoTip
        variant={LAUNCH_INFO_VARIANT}
        header={chip.seeded ? "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND" : undefined}
        label={tip}
      />

      {chip.needsObjective ? (
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
      ) : null}

      <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{evidence}</span>

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
