"use client";

import Link from "next/link";
import { useEffect, useState, type RefObject } from "react";

import { ActionGlyph } from "@/components/viz/action-glyph";
import { Drawer } from "@/components/viz/drawer";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { ScopeGlyph } from "@/components/viz/scope-glyph";
import { ThresholdBand } from "@/components/viz/threshold-band";
import { StatusLine, StepSurfaceProvider } from "@/components/steps/step-surface";
import { VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";
import type { DecisionRowView } from "@/lib/optimisation/automation-ui";
import {
  presetEditHref,
  presetVersionLabel,
  resolvePreset,
  type ClientOptimisationPreset,
} from "@/lib/optimisation/presets";
import {
  DECISIONS_SHEET_COPY,
  bandDashedFor,
  compactRelative,
  emptyDecisionsStatus,
  glyphActionFor,
  groupDecisions,
  metricChipText,
  presetDriftLabel,
  provenanceForDecision,
  provenanceMarkForDecision,
  whyForDecision,
} from "@/lib/plan/decisions-sheet";
import type { CampaignObjective, OptimisationRule, OptimisationThreshold } from "@/lib/types";

type GatePayload = {
  ok?: boolean;
  decisions?: DecisionRowView[];
  lastEvaluatedAt?: string | null;
  materialisedPreset?: { presetId: string; presetVersion: number } | null;
};

export function DecisionsSheet({
  draftId,
  clientId,
  objective,
  materialised,
  variant = "sheet",
  open,
  onDone,
  triggerRef,
}: {
  draftId: string;
  clientId?: string | null;
  objective?: CampaignObjective | null;
  materialised?: { presetId: string; presetVersion: number } | null;
  variant?: "sheet" | "page";
  open: boolean;
  onDone: () => void;
  triggerRef?: RefObject<Element | null>;
}) {
  const [decisions, setDecisions] = useState<DecisionRowView[]>([]);
  const [lastEvaluatedAt, setLastEvaluatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [fetchedMaterialised, setFetchedMaterialised] = useState<{
    presetId: string;
    presetVersion: number;
  } | null>(null);

  useEffect(() => {
    if (!open || !draftId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/campaigns/${encodeURIComponent(draftId)}/automation`)
      .then((res) => res.json() as Promise<GatePayload>)
      .then((json) => {
        if (cancelled || json.ok === false) return;
        setDecisions(json.decisions ?? []);
        setLastEvaluatedAt(json.lastEvaluatedAt ?? null);
        setFetchedMaterialised(json.materialisedPreset ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, draftId]);

  return (
    <Drawer
      open={open}
      variant={variant}
      title={DECISIONS_SHEET_COPY.title}
      onDone={onDone}
      triggerRef={triggerRef}
      header={
        <button
          type="button"
          className={`${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}
          onClick={() => setPresetOpen((current) => !current)}
          aria-expanded={presetOpen}
        >
          ⌁ {DECISIONS_SHEET_COPY.preset}
        </button>
      }
    >
      <StepSurfaceProvider surface="drawer">
        {presetOpen ? (
          <PresetRead
            clientId={clientId ?? null}
            objective={objective ?? null}
            materialised={materialised ?? fetchedMaterialised}
          />
        ) : null}
        <DecisionsSheetRows
          decisions={decisions}
          lastEvaluatedAt={lastEvaluatedAt}
          loading={loading}
        />
      </StepSurfaceProvider>
    </Drawer>
  );
}

export function DecisionsSheetRows({
  decisions,
  lastEvaluatedAt,
  loading,
  now,
}: {
  decisions: DecisionRowView[];
  lastEvaluatedAt?: string | null;
  loading?: boolean;
  now?: Date;
}) {
  const [olderOpen, setOlderOpen] = useState(false);
  const clock = now ?? new Date();
  const grouped = groupDecisions(decisions, clock);

  if (loading) {
    return <StatusLine className={`${VIZ_TYPE.label} text-muted-foreground`}>…</StatusLine>;
  }
  if (decisions.length === 0) {
    return (
      <StatusLine className={`${VIZ_TYPE.label} text-muted-foreground`}>
        {emptyDecisionsStatus(lastEvaluatedAt ?? null, clock)}
      </StatusLine>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.recent.map((day) => (
        <DayGroup key={day.dayKey} rows={day.rows} now={clock} />
      ))}
      {grouped.older.length > 0 ? (
        <div>
          <button
            type="button"
            className={`${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}
            aria-expanded={olderOpen}
            onClick={() => setOlderOpen((current) => !current)}
          >
            {olderOpen ? "▾" : "▸"} {DECISIONS_SHEET_COPY.older}
          </button>
          {olderOpen
            ? grouped.older.map((day) => (
                <DayGroup key={day.dayKey} rows={day.rows} now={clock} />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function DayGroup({ rows, now }: { rows: DecisionRowView[]; now: Date }) {
  return (
    <ul className="space-y-0">
      {rows.map((decision, idx) => (
        <DecisionRow
          key={`${decision.decidedAt}-${decision.action}-${idx}`}
          row={decision}
          now={now}
        />
      ))}
    </ul>
  );
}

function DecisionRow({ row, now }: { row: DecisionRowView; now: Date }) {
  const glyph = glyphActionFor(row.action);
  const chip = metricChipText(row);
  const why = whyForDecision(row, now);
  const dashed = bandDashedFor(row.action);

  return (
    <li className={`flex h-9 items-center gap-2 border-b border-border ${VIZ_TYPE_NUM.body} text-foreground`}>
      <span className="inline-flex w-5 shrink-0 items-center justify-center">
        <PlatformGlyph platform={row.channel} size="sm" />
      </span>
      <ActionGlyph
        action={glyph}
        filled={row.kind === "applied"}
        className="text-muted-foreground"
      />
      {row.scope === "campaign" ? <ScopeGlyph scope="campaign" size="sm" /> : null}
      <span className="w-[88px] shrink-0">
        <MetricChip label={chip} size="sm">
          {chip}
        </MetricChip>
      </span>
      <span className="min-w-[96px] max-w-[160px] flex-1">
        <ThresholdBand
          action={row.action}
          currentValue={row.metricValue}
          dashed={dashed}
          size="sm"
        />
      </span>
      <span className="w-16 shrink-0 truncate text-muted-foreground">{why}</span>
      <ProvenanceBadge
        provenance={provenanceForDecision(row)}
        label={provenanceMarkForDecision(row)}
      />
      <time className={`w-12 shrink-0 ${VIZ_TYPE_NUM.micro} text-muted-foreground`} dateTime={row.decidedAt}>
        {compactRelative(row.decidedAt, now)}
      </time>
    </li>
  );
}

function PresetRead({
  clientId,
  objective,
  materialised,
}: {
  clientId: string | null;
  objective: CampaignObjective | null;
  materialised: { presetId: string; presetVersion: number } | null;
}) {
  const [stored, setStored] = useState<ClientOptimisationPreset[] | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    fetch(`/api/clients/${encodeURIComponent(clientId)}/optimisation-presets`)
      .then((res) => res.json() as Promise<{ ok?: boolean; presets?: ClientOptimisationPreset[] }>)
      .then((json) => {
        if (cancelled || json.ok === false) return;
        setStored(json.presets ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId || !objective) return null;

  const resolved = resolvePreset(clientId, objective, stored);
  const preset = resolved.preset;
  const drift = presetDriftLabel(materialised?.presetVersion, preset.version);
  const editHref = presetEditHref(clientId);

  return (
    <div className="mb-3 space-y-2 border-b border-border pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {drift && materialised ? (
          <span className="inline-flex items-center gap-1">
            <ProvenanceBadge provenance="derived" label={drift} />
            <InfoTip label={DECISIONS_SHEET_COPY.driftTip(presetVersionLabel(materialised.presetVersion))} />
          </span>
        ) : null}
        {editHref ? (
          <Link
            href={editHref}
            className={`ml-auto ${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}
          >
            {DECISIONS_SHEET_COPY.edit}
          </Link>
        ) : null}
      </div>
      {preset.rules
        .filter((rule) => rule.enabled && rule.thresholds.length > 0)
        .map((rule) => (
          <div key={`${rule.metric}-${rule.name}`} className="flex items-center gap-2">
            <MetricChip label={rule.metric} size="sm">
              {rule.metric} · {rule.timeWindow}
            </MetricChip>
            <span className="flex-1">
              <ThresholdBand rule={displayRuleFromPreset(rule)} currentValue={null} size="sm" />
            </span>
          </div>
        ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <MetricChip label="expansion" size="sm">
          +{preset.guardrails.maxExpansionPercent}%
        </MetricChip>
        <MetricChip label="at ceiling" size="sm">
          {preset.guardrails.ceilingBehaviour}
        </MetricChip>
        {preset.guardrails.cooldownHours != null ? (
          <MetricChip label="cooldown" size="sm">
            {preset.guardrails.cooldownHours}h
          </MetricChip>
        ) : null}
        {preset.guardrails.maxDailyIncreasePercent != null ? (
          <MetricChip label="max daily increase" size="sm">
            +{preset.guardrails.maxDailyIncreasePercent}%/24h
          </MetricChip>
        ) : null}
        <MetricChip label="arm" size="sm">
          {preset.defaultArm}
        </MetricChip>
        <MetricChip label="mode" size="sm">
          {preset.mode}
        </MetricChip>
      </div>
    </div>
  );
}

function displayRuleFromPreset(rule: {
  benchmarkTarget: number | null;
  thresholds: ReadonlyArray<{
    operator: OptimisationThreshold["operator"];
    multiplier: number;
    multiplierTo?: number;
    action: OptimisationThreshold["action"];
  }>;
}): Pick<OptimisationRule, "thresholds"> {
  const base = rule.benchmarkTarget != null && rule.benchmarkTarget > 0 ? rule.benchmarkTarget : 1;
  return {
    thresholds: rule.thresholds.map((threshold, idx) => ({
      id: `preset-${idx}`,
      operator: threshold.operator,
      value: threshold.multiplier * base,
      valueTo: threshold.multiplierTo != null ? threshold.multiplierTo * base : undefined,
      action: threshold.action,
      label: "",
    })),
  };
}
