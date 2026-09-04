"use client";

import { useState } from "react";

import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { OPTIMISATION_PRESET_SEED_LABEL } from "@/lib/optimisation/presets";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";
import {
  PLAN_TARGET_UNITS,
  planEffectiveTargetUnit,
  planTargetChip,
} from "@/lib/plan/canvas-inputs";
import { PLAN_OBJECTIVE_OPTIONS } from "@/lib/plan/empty-plan";
import { targetUnitSpec } from "@/lib/plan/target-unit";
import type { CampaignPlanObjectiveIntent } from "@/lib/plan/types";
import type { PlanTargetUnit } from "@/lib/types";

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
  onUnit,
  onObjective,
}: {
  value: number | null;
  unit: PlanTargetUnit | null;
  benchmark: number | null;
  objectiveIntent: CampaignPlanObjectiveIntent;
  presetHref: string | null;
  onTarget: (next: number | null) => void;
  onUnit: (next: PlanTargetUnit | null) => void;
  onObjective: (next: CampaignPlanObjectiveIntent) => void;
}) {
  const effective = planEffectiveTargetUnit(unit, objectiveIntent);
  const chip = planTargetChip({ value, unit: effective.unit, benchmark });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? benchmark ?? ""));

  function commit() {
    const next = Number(draft);
    onTarget(Number.isFinite(next) && next > 0 ? next : null);
    setEditing(false);
  }

  return (
    <section aria-label="target" className="flex flex-wrap items-center gap-1.5">
      {editing && effective.unit ? (
        <MetricChip label="target" size="lg">
          <span>◎ £</span>
          <input
            autoFocus
            className="w-20 border-0 bg-transparent p-0 text-right tabular-nums outline-none"
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
          <span className="text-[11px] text-muted-foreground">/ {targetUnitSpec(effective.unit).label}</span>
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
          <MetricChip label="target" size="lg">
            {chip.label}
          </MetricChip>
        </button>
      )}

      <ProvenanceBadge provenance={chip.provenance} />
      {chip.seeded ? <InfoTip label={OPTIMISATION_PRESET_SEED_LABEL} /> : null}
      {chip.seeded && effective.unit ? <InfoTip label={PLAN_CANVAS_COPY.targetSeed} /> : null}

      <span className="inline-flex items-center gap-1">
        {PLAN_TARGET_UNITS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={effective.unit === option}
            className={`rounded-sm border px-1.5 py-0.5 text-[10px] ${
              effective.unit === option
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground"
            }`}
            onClick={() => onUnit(effective.unit === option ? null : option)}
          >
            {targetUnitSpec(option).label}
          </button>
        ))}
        <InfoTip
          label={
            effective.inferred
              ? PLAN_CANVAS_COPY.unitInferred
              : PLAN_CANVAS_COPY.unitChangesObjective
          }
        />
      </span>

      {chip.needsObjective ? (
        <label className="inline-flex items-center gap-1">
          <span className="sr-only">Objective</span>
          <select
            className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px]"
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
          <InfoTip label={PLAN_CANVAS_COPY.noUnit} />
        </label>
      ) : null}

      {presetHref ? (
        <a
          href={presetHref}
          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          edit
        </a>
      ) : null}
    </section>
  );
}
