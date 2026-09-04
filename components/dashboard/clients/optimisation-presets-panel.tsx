"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { StatusDot } from "@/components/viz/status-dot";
import { ThresholdBand } from "@/components/viz/threshold-band";
import { METRIC_LABELS, TIME_WINDOW_LABELS } from "@/lib/optimisation-rules";
import {
  industrySeedPreset,
  isIndustrySeedPresetId,
  materialiseStrategy,
  presetPrimaryRule,
  presetVersionLabel,
  type ClientOptimisationPreset,
  type PresetArm,
  type PresetGuardrails,
} from "@/lib/optimisation/presets";
import { defaultUnitForObjective } from "@/lib/plan/target-unit";
import type { CampaignObjective, CeilingBehaviour } from "@/lib/types";

/**
 * Client × objective optimisation policy — the 13 of 14 Optimisation
 * Strategy fields that are not per-campaign (redesign §1 row 2, §5 row 5).
 *
 * Kit only. No `<p>`, no `CardDescription`; every word that explains rather
 * than names is an `InfoTip`. One card per objective the client actually
 * runs, plus an add control for the rest.
 */

const OBJECTIVES: readonly CampaignObjective[] = [
  "registration",
  "traffic",
  "purchase",
  "awareness",
  "engagement",
];

const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  registration: "signups",
  traffic: "traffic",
  purchase: "sales",
  awareness: "awareness",
  engagement: "engagement",
};

const ARM_TIP =
  "The arm a new campaign starts on. Shadow logs what the rules would do and changes nothing. Live stays a per-campaign decision and is never set here.";
const LADDER_TIP =
  "Bands are multipliers of the campaign target, so one preset fits every budget. The zones show scale, maintain, reduce and pause left to right.";
const SEED_TIP =
  "industry seed — will become learned per client. No policy saved yet, so this is the benchmark ladder.";
const CEILING_TIP =
  "What happens when a scale-up would cross the budget ceiling: stop, apply only the part that fits, or pause scaling for review.";
const COOLDOWN_TIP =
  "Minimum wait after a budget change. The evaluator raises it to the metric window when it is shorter, so changes never stack faster than they can be measured.";

const CEILING_OPTIONS: Array<{ value: CeilingBehaviour; label: string }> = [
  { value: "stop", label: "stop" },
  { value: "partial", label: "partial" },
  { value: "pause_scaling", label: "pause scaling" },
];

type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; objective: CampaignObjective }
  | { kind: "error"; message: string };

export function OptimisationPresetsPanel({
  clientId,
  initialPresets,
  objectivesInUse,
}: {
  clientId: string;
  initialPresets: ClientOptimisationPreset[];
  /** Objectives this client's campaigns actually use — the cards shown by default. */
  objectivesInUse: CampaignObjective[];
}) {
  const [presets, setPresets] = useState(initialPresets);
  const [added, setAdded] = useState<CampaignObjective[]>([]);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const shown = useMemo(() => {
    const set = new Set<CampaignObjective>([
      ...objectivesInUse,
      ...presets.map((p) => p.objective),
      ...added,
    ]);
    return OBJECTIVES.filter((o) => set.has(o));
  }, [objectivesInUse, presets, added]);

  const addable = OBJECTIVES.filter((o) => !shown.includes(o));

  async function persist(next: ClientOptimisationPreset) {
    setSave({ kind: "saving", objective: next.objective });
    try {
      const res = await fetch(`/api/clients/${clientId}/optimisation-presets`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: next.objective,
          defaultArm: next.defaultArm,
          mode: next.mode,
          rules: next.rules,
          guardrails: next.guardrails,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        preset?: ClientOptimisationPreset;
      };
      if (!res.ok || !json.ok || !json.preset) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const saved = json.preset;
      setPresets((prev) => [
        ...prev.filter((p) => p.objective !== saved.objective),
        saved,
      ]);
      setSave({ kind: "idle" });
    } catch (err) {
      setSave({
        kind: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <h2 className="font-heading text-base tracking-wide">Optimisation</h2>
        <InfoTip label="Policy per objective. Campaigns materialise a copy of this when they are created, so editing a preset never changes a campaign that is already published." />
        <span className="ml-auto flex items-center gap-2">
          {save.kind === "error" ? (
            <span className="text-xs text-destructive">{save.message}</span>
          ) : null}
          {addable.length > 0 ? (
            <AddObjective
              options={addable}
              onAdd={(objective) => setAdded((prev) => [...prev, objective])}
            />
          ) : null}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
          <ProvenanceBadge provenance="not instrumented" />
          <span>no campaigns yet</span>
        </div>
      ) : (
        <div className="grid gap-3">
          {shown.map((objective) => (
            <PresetCard
              key={objective}
              objective={objective}
              stored={presets.find((p) => p.objective === objective) ?? null}
              clientId={clientId}
              saving={save.kind === "saving" && save.objective === objective}
              onSave={persist}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AddObjective({
  options,
  onAdd,
}: {
  options: CampaignObjective[];
  onAdd: (objective: CampaignObjective) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        add
      </Button>
    );
  }
  return (
    <Select
      value=""
      onChange={(e) => {
        const value = e.target.value as CampaignObjective;
        if (value) onAdd(value);
        setOpen(false);
      }}
      options={[
        { value: "", label: "pick an objective" },
        ...options.map((o) => ({ value: o, label: OBJECTIVE_LABEL[o] })),
      ]}
    />
  );
}

function PresetCard({
  objective,
  stored,
  clientId,
  saving,
  onSave,
}: {
  objective: CampaignObjective;
  stored: ClientOptimisationPreset | null;
  clientId: string;
  saving: boolean;
  onSave: (preset: ClientOptimisationPreset) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // `industrySeedPreset` walks `generateRulesForObjective`, so hold it
  // stable — the ladder band memo below keys on this identity.
  const preset = useMemo(
    () => stored ?? industrySeedPreset(clientId, objective),
    [stored, clientId, objective],
  );
  const seeded = isIndustrySeedPresetId(preset.id);
  const primary = presetPrimaryRule(preset);
  const unit = defaultUnitForObjective(objective);

  // The band needs absolute values, so show the ladder at the preset's own
  // benchmark target. A campaign rescales the same multipliers to its target.
  const bandRule = useMemo(() => {
    const strategy = materialiseStrategy(preset, {
      value: null,
      unit: null,
      budgetAmount: 0,
      materialisedAt: "1970-01-01T00:00:00.000Z",
    });
    return strategy.rules.find((r) => r.metric === primary?.metric) ?? null;
  }, [preset, primary?.metric]);

  function mutate(patch: Partial<ClientOptimisationPreset>) {
    onSave({ ...preset, ...patch });
  }

  function mutateGuardrails(patch: Partial<PresetGuardrails>) {
    onSave({ ...preset, guardrails: { ...preset.guardrails, ...patch } });
  }

  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot status={preset.defaultArm === "shadow" ? "in-progress" : "idle"} />
        <span className="text-sm font-medium">{OBJECTIVE_LABEL[objective]}</span>
        <ProvenanceBadge provenance={seeded ? "modelled" : "manual entry"} />
        <InfoTip label={seeded ? SEED_TIP : `saved policy · ${presetVersionLabel(preset.version)}`} />
        <MetricChip label="preset version" size="sm">
          {presetVersionLabel(preset.version)}
        </MetricChip>
        {primary ? (
          <MetricChip label={`ladder metric · ${METRIC_LABELS[primary.metric] ?? primary.metric}`}>
            {METRIC_LABELS[primary.metric] ?? primary.metric}
            {unit ? <span className="text-muted-foreground">/ {unit}</span> : null}
          </MetricChip>
        ) : null}
        {primary ? (
          <MetricChip label={`window · ${TIME_WINDOW_LABELS[primary.timeWindow]}`}>
            {primary.timeWindow}
          </MetricChip>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          <InfoTip label={ARM_TIP} />
          <ArmToggle
            arm={preset.defaultArm}
            disabled={saving}
            onChange={(defaultArm) => mutate({ defaultArm })}
          />
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <InfoTip label={LADDER_TIP} />
        <span className="flex-1">
          {bandRule && bandRule.thresholds.length > 0 ? (
            <ThresholdBand rule={bandRule} />
          ) : (
            <ThresholdBand action="maintain" />
          )}
        </span>
        {primary?.benchmarkTarget != null ? (
          <MetricChip label="benchmark target" size="sm">
            £{primary.benchmarkTarget}
          </MetricChip>
        ) : (
          <ProvenanceBadge provenance="not instrumented" />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MetricChip label="max expansion" size="sm">
          +{preset.guardrails.maxExpansionPercent}%
        </MetricChip>
        <MetricChip label="ceiling behaviour" size="sm">
          {CEILING_OPTIONS.find((o) => o.value === preset.guardrails.ceilingBehaviour)?.label ??
            preset.guardrails.ceilingBehaviour}
        </MetricChip>
        {preset.guardrails.maxSingleAdSetBudget != null ? (
          <MetricChip label="max single ad set" size="sm">
            {preset.guardrails.maxSingleAdSetBudgetType === "percent"
              ? `${preset.guardrails.maxSingleAdSetBudget}%`
              : `£${preset.guardrails.maxSingleAdSetBudget}`}
          </MetricChip>
        ) : null}
        {preset.guardrails.maxDailyIncreasePercent != null ? (
          <MetricChip label="max daily increase" size="sm">
            +{preset.guardrails.maxDailyIncreasePercent}%/24h
          </MetricChip>
        ) : null}
        {preset.guardrails.cooldownHours != null ? (
          <MetricChip label="cooldown" size="sm">
            {preset.guardrails.cooldownHours}h
          </MetricChip>
        ) : null}
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          guardrails
        </button>
      </div>

      {advancedOpen ? (
        <div className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
          <NumberField
            label="max expansion %"
            value={preset.guardrails.maxExpansionPercent}
            disabled={saving}
            onCommit={(v) => mutateGuardrails({ maxExpansionPercent: Math.max(0, v ?? 0) })}
          />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-40 shrink-0">at ceiling</span>
            <InfoTip label={CEILING_TIP} />
            <select
              value={preset.guardrails.ceilingBehaviour}
              disabled={saving}
              onChange={(e) =>
                mutateGuardrails({ ceilingBehaviour: e.target.value as CeilingBehaviour })
              }
              className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none"
            >
              {CEILING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="max single ad set £"
            value={preset.guardrails.maxSingleAdSetBudget}
            disabled={saving}
            onCommit={(v) =>
              mutateGuardrails({
                maxSingleAdSetBudget: v ?? undefined,
                maxSingleAdSetBudgetType: "fixed",
              })
            }
          />
          <NumberField
            label="max daily increase %"
            value={preset.guardrails.maxDailyIncreasePercent}
            disabled={saving}
            onCommit={(v) => mutateGuardrails({ maxDailyIncreasePercent: v ?? undefined })}
          />
          <NumberField
            label="cooldown h"
            tip={COOLDOWN_TIP}
            value={preset.guardrails.cooldownHours}
            disabled={saving}
            onCommit={(v) => mutateGuardrails({ cooldownHours: v ?? undefined })}
          />
        </div>
      ) : null}
    </div>
  );
}

function ArmToggle({
  arm,
  disabled,
  onChange,
}: {
  arm: PresetArm;
  disabled: boolean;
  onChange: (arm: PresetArm) => void;
}) {
  return (
    <span className="inline-flex overflow-hidden rounded-md border border-border">
      {(["off", "shadow"] as const).map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option)}
          className={`px-2 py-1 text-xs transition-colors ${
            arm === option
              ? "bg-primary-light text-foreground"
              : "text-muted-foreground hover:bg-muted/40"
          }`}
        >
          {option}
        </button>
      ))}
    </span>
  );
}

function NumberField({
  label,
  tip,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  tip?: string;
  value: number | undefined;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-40 shrink-0">{label}</span>
      {tip ? <InfoTip label={tip} /> : null}
      <input
        type="number"
        min={0}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const trimmed = draft.trim();
          onCommit(trimmed === "" ? null : Number(trimmed));
        }}
        className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs text-foreground focus:border-primary focus:outline-none"
      />
    </label>
  );
}
