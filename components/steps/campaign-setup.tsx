"use client";

import { useCallback, useEffect, useMemo } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type {
  CampaignSettings,
  CampaignObjective,
  ExistingMetaCampaignSnapshot,
  ExistingMetaAdSetSnapshot,
  MetaCampaignSummary,
  MetaAdSetSummary,
  OptimisationGoal,
  WizardMode,
} from "@/lib/types";
import { ATTACH_CAMPAIGN_CAP } from "@/lib/types";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "@/lib/mock-data";
import {
  Target, ShoppingCart, MousePointerClick, Eye, MessageSquare,
  Plus, Link2, Layers, AlertCircle, Info, X,
} from "lucide-react";
import { CampaignPicker } from "./campaign-picker";
import { CampaignMultiPicker } from "@/components/bulk-attach/campaign-multi-picker";
import { AdSetPicker } from "./adset-picker";

interface CampaignSetupProps {
  settings: CampaignSettings;
  onChange: (settings: CampaignSettings) => void;
}

const OBJECTIVES: {
  value: CampaignObjective;
  label: string;
  sublabel: string;
  icon: typeof Target;
}[] = [
  { value: "registration", label: "Registration", sublabel: "Sales → CompleteRegistration", icon: Target },
  { value: "purchase", label: "Purchase", sublabel: "Sales → Purchase", icon: ShoppingCart },
  { value: "traffic", label: "Traffic", sublabel: "Landing Page Views", icon: MousePointerClick },
  { value: "awareness", label: "Awareness", sublabel: "Reach", icon: Eye },
  { value: "engagement", label: "Engagement", sublabel: "Boost an existing post", icon: MessageSquare },
];

const OBJECTIVE_LABELS: Record<CampaignObjective, string> = {
  purchase: "Purchase",
  registration: "Registration",
  traffic: "Traffic",
  awareness: "Awareness",
  engagement: "Engagement",
};

function suggestCampaignName(code: string, objective: CampaignObjective): string {
  if (!code) return "";
  return `[${code}] ${OBJECTIVE_LABELS[objective]}`;
}

export function CampaignSetup({ settings, onChange }: CampaignSetupProps) {
  const update = (patch: Partial<CampaignSettings>) =>
    onChange({ ...settings, ...patch });

  const mode: WizardMode = settings.wizardMode ?? "new";
  const isAttachCampaign = mode === "attach_campaign";
  const isAttachAdSet = mode === "attach_adset";
  const isAttach = isAttachCampaign || isAttachAdSet;

  const availableGoals = OPTIMISATION_GOALS_BY_OBJECTIVE[settings.objective] || [];

  useEffect(() => {
    const goalValid = availableGoals.some((g) => g.value === settings.optimisationGoal);
    if (!goalValid && availableGoals.length > 0) {
      update({ optimisationGoal: availableGoals[0].value });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.objective]);

  const handleObjectiveChange = (objective: CampaignObjective) => {
    const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[objective];
    const newGoal = goals[0]?.value ?? settings.optimisationGoal;
    const patch: Partial<CampaignSettings> = { objective, optimisationGoal: newGoal };

    if (settings.campaignCode && settings.campaignName === suggestCampaignName(settings.campaignCode, settings.objective)) {
      patch.campaignName = suggestCampaignName(settings.campaignCode, objective);
    }
    update(patch);
  };

  const handleCodeChange = (code: string) => {
    const oldSuggestion = suggestCampaignName(settings.campaignCode, settings.objective);
    const isDefault = !settings.campaignName || settings.campaignName === oldSuggestion;
    const patch: Partial<CampaignSettings> = { campaignCode: code };
    if (isDefault) {
      patch.campaignName = suggestCampaignName(code, settings.objective);
    }
    update(patch);
  };

  // ── Mode toggle ───────────────────────────────────────────────────────────

  const setMode = (next: WizardMode) => {
    if (next === mode) return;
    if (next === "new") {
      // Drop both attach snapshots but keep whatever name/objective the user
      // had configured before — they may want to edit it.
      const {
        existingMetaCampaign: _dropC,
        existingMetaCampaigns: _dropCs,
        existingMetaAdSet: _dropAS,
        existingMetaAdSets: _dropASs,
        ...rest
      } = settings;
      void _dropC;
      void _dropCs;
      void _dropAS;
      void _dropASs;
      onChange({ ...rest, wizardMode: "new" });
      return;
    }
    if (next === "attach_campaign") {
      // Switching from attach_adset → attach_campaign: keep the campaign
      // snapshots (still valid) but drop the ad set snapshots.
      const {
        existingMetaAdSet: _dropAS,
        existingMetaAdSets: _dropASs,
        ...rest
      } = settings;
      void _dropAS;
      void _dropASs;
      onChange({ ...rest, wizardMode: "attach_campaign" });
      return;
    }
    // next === "attach_adset" — only allowed when at most 1 campaign is selected
    if (selectedCampaigns.length > 1) return;
    onChange({ ...settings, wizardMode: "attach_adset" });
  };

  // ── Picker selection ──────────────────────────────────────────────────────

  // Authoritative list — prefer `existingMetaCampaigns` (multi-select array),
  // fall back to wrapping the legacy singular field for backward compat.
  const selectedCampaigns = useMemo<ExistingMetaCampaignSnapshot[]>(
    () =>
      settings.existingMetaCampaigns ??
      (settings.existingMetaCampaign ? [settings.existingMetaCampaign] : []),
    [settings.existingMetaCampaigns, settings.existingMetaCampaign],
  );
  const selectedCampaignIds = useMemo(
    () => new Set(selectedCampaigns.map((c) => c.id)),
    [selectedCampaigns],
  );

  // Multi-select toggle used by CampaignMultiPicker in attach_campaign mode.
  const handleToggleCampaign = useCallback((campaign: MetaCampaignSummary) => {
    if (!campaign.compatible || !campaign.internalObjective) return;

    const alreadySelected = selectedCampaignIds.has(campaign.id);
    let nextList: ExistingMetaCampaignSnapshot[];

    if (alreadySelected) {
      nextList = selectedCampaigns.filter((c) => c.id !== campaign.id);
    } else {
      if (selectedCampaigns.length >= ATTACH_CAMPAIGN_CAP) return; // cap enforced by picker UI too
      const snapshot: ExistingMetaCampaignSnapshot = {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        effectiveStatus: campaign.effectiveStatus,
        capturedAt: new Date().toISOString(),
      };
      nextList = [...selectedCampaigns, snapshot];
    }

    // Derive optimisation goal from the FIRST selected campaign (or keep
    // the existing goal if it's already valid for the first campaign's objective).
    const firstCamp = nextList[0];
    const firstInternal = firstCamp
      ? (campaign.internalObjective ?? settings.objective)
      : settings.objective;
    const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[firstInternal] ?? [];
    const goalValid = goals.some((g) => g.value === settings.optimisationGoal);
    const nextGoal = goalValid
      ? settings.optimisationGoal
      : goals[0]?.value ?? settings.optimisationGoal;

    onChange({
      ...settings,
      wizardMode: "attach_campaign",
      objective: firstCamp ? firstInternal : settings.objective,
      optimisationGoal: nextGoal as OptimisationGoal,
      existingMetaCampaigns: nextList,
      // Mirror first selection into the legacy singular field for backward
      // compat with any read sites that haven't migrated yet.
      existingMetaCampaign: nextList[0],
    });
  }, [selectedCampaigns, selectedCampaignIds, settings, onChange]);

  // Single-select handler — kept for attach_adset mode where the ad set
  // picker needs exactly one parent campaign selected.
  const handlePickCampaign = (campaign: MetaCampaignSummary) => {
    if (!campaign.compatible || !campaign.internalObjective) return;

    const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[campaign.internalObjective] ?? [];
    const goalValid = goals.some((g) => g.value === settings.optimisationGoal);
    const nextGoal = goalValid
      ? settings.optimisationGoal
      : goals[0]?.value ?? settings.optimisationGoal;

    // Picking a different campaign while in attach_adset mode invalidates
    // any previously-selected ad sets. Drop them so the user has to re-pick.
    const previousSelections =
      settings.existingMetaAdSets ??
      (settings.existingMetaAdSet ? [settings.existingMetaAdSet] : []);
    const adSetSnapshotPatch: Partial<CampaignSettings> =
      mode === "attach_adset" &&
      previousSelections.length > 0 &&
      previousSelections.some((a) => a.campaignId !== campaign.id)
        ? { existingMetaAdSet: undefined, existingMetaAdSets: [] }
        : {};

    const snapshot: ExistingMetaCampaignSnapshot = {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      effectiveStatus: campaign.effectiveStatus,
      capturedAt: new Date().toISOString(),
    };

    onChange({
      ...settings,
      wizardMode: mode === "new" ? "attach_campaign" : mode,
      objective: campaign.internalObjective,
      optimisationGoal: nextGoal as OptimisationGoal,
      existingMetaCampaign: snapshot,
      existingMetaCampaigns: [snapshot],
      ...adSetSnapshotPatch,
    });
  };

  // Always operate on the multi-select array. Read sites that haven't been
  // migrated yet still consult `existingMetaAdSet` (kept for back-compat),
  // but we authoritatively write to the new array here.
  const selectedAdSets = useMemo<ExistingMetaAdSetSnapshot[]>(
    () =>
      settings.existingMetaAdSets ??
      (settings.existingMetaAdSet ? [settings.existingMetaAdSet] : []),
    [settings.existingMetaAdSets, settings.existingMetaAdSet],
  );

  const handleToggleAdSet = (adSet: MetaAdSetSummary) => {
    if (!adSet.compatible) return;
    const parent = selectedExisting ?? settings.existingMetaCampaign;
    if (!parent) return; // shouldn't happen — picker only renders when set

    const exists = selectedAdSets.some((a) => a.id === adSet.id);
    let nextList: ExistingMetaAdSetSnapshot[];
    if (exists) {
      nextList = selectedAdSets.filter((a) => a.id !== adSet.id);
      console.log(
        `[CampaignSetup] de-selected ad set ${adSet.id} ("${adSet.name}")` +
          ` — ${nextList.length} remaining`,
      );
    } else {
      const snapshot: ExistingMetaAdSetSnapshot = {
        id: adSet.id,
        name: adSet.name,
        campaignId: adSet.campaignId || parent.id,
        campaignName: parent.name,
        objective: parent.objective,
        optimizationGoal: adSet.optimizationGoal,
        billingEvent: adSet.billingEvent,
        status: adSet.status,
        effectiveStatus: adSet.effectiveStatus,
        targetingSummary: adSet.targetingSummary,
        capturedAt: new Date().toISOString(),
      };
      nextList = [...selectedAdSets, snapshot];
      console.log(
        `[CampaignSetup] selected ad set ${adSet.id} ("${adSet.name}")` +
          ` — ${nextList.length} total`,
      );
    }

    onChange({
      ...settings,
      wizardMode: "attach_adset",
      existingMetaAdSets: nextList,
      // Mirror first selection into the legacy field so any non-migrated
      // read sites still render the headline ad set name. Cleared when the
      // user de-selects everything.
      existingMetaAdSet: nextList[0],
    });
  };

  const handleRemoveAdSet = (adSetId: string) => {
    const nextList = selectedAdSets.filter((a) => a.id !== adSetId);
    onChange({
      ...settings,
      existingMetaAdSets: nextList,
      existingMetaAdSet: nextList[0],
    });
  };

  // For attach_adset, a single campaign must be selected as the parent.
  const selectedExisting = selectedCampaigns[0] ?? settings.existingMetaCampaign;
  const adAccountId = settings.metaAdAccountId ?? settings.adAccountId;
  const isMultiCampaignSelected = isAttachCampaign && selectedCampaigns.length > 1;
  const selectedAdSetIds = useMemo(
    () => selectedAdSets.map((a) => a.id),
    [selectedAdSets],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Campaign Config</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAttachAdSet
            ? "Pick the existing campaign and ad set you want to add new ads to."
            : isAttachCampaign
            ? "Pick the existing campaign you want to add a new ad set under."
            : "Choose your campaign objective, name, and optimisation goal."}
        </p>
      </div>

      {/* Mode toggle */}
      <Card>
        <CardTitle>What do you want to do?</CardTitle>
        <CardDescription>
          Create a fresh campaign at launch, add a new ad set to a live
          campaign, or add new ads under an existing live ad set.
        </CardDescription>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            {
              value: "new" as const,
              label: "Create new campaign",
              desc: "The wizard provisions everything from scratch.",
              icon: Plus,
              disabled: false,
            },
            {
              value: "attach_campaign" as const,
              label: "Add to existing campaign",
              desc: "Pick one or more live campaigns and add a new ad set + ads under each.",
              icon: Link2,
              disabled: false,
            },
            {
              value: "attach_adset" as const,
              label: "Add to existing ad set",
              desc: isMultiCampaignSelected
                ? "Disabled — select a single campaign to pick an ad set."
                : "Pick a live ad set and add new ads only — audience, budget and optimisation are inherited.",
              icon: Layers,
              disabled: isMultiCampaignSelected,
            },
          ]).map(({ value, label, desc, icon: Icon, disabled }) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => !disabled && setMode(value)}
                disabled={disabled}
                className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors
                  ${disabled
                    ? "cursor-not-allowed border-border bg-muted/30 opacity-50"
                    : selected
                    ? "border-foreground bg-card"
                    : "border-border-strong hover:bg-card/60"}`}
              >
                <Icon className={`mt-0.5 h-4 w-4 ${selected ? "text-foreground" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {isAttach ? (
        <>
          {isAttachAdSet && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-light/30 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium text-foreground">Ads-only mode.</span>{" "}
                The wizard will skip Optimisation, Audiences and Budget — those
                stay as they are on the live ad set. You only configure
                creatives, then assign them to the existing ad set.
              </span>
            </div>
          )}

          {/* Campaign picker — multi-select for attach_campaign, single-select for attach_adset */}
          <Card>
            <CardTitle>
              {isAttachAdSet
                ? "Step 1 — Pick the parent campaign"
                : selectedCampaigns.length > 1
                ? `Pick existing campaigns (${selectedCampaigns.length} selected)`
                : "Pick existing campaigns"}
            </CardTitle>
            <CardDescription>
              {isAttachCampaign
                ? <>
                    Select up to {ATTACH_CAMPAIGN_CAP} live campaigns — a new ad set + ads will be created
                    under each at launch.{" "}
                    <span className="text-foreground">
                      Incompatible campaigns are greyed out.
                    </span>
                  </>
                : <>
                    Live campaigns under{" "}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                      {adAccountId ?? "—"}
                    </code>
                    . Compatible campaigns can be selected; the rest are shown
                    greyed-out so you know they exist.
                  </>
              }
            </CardDescription>
            <div className="mt-3">
              {isAttachCampaign ? (
                <CampaignMultiPicker
                  adAccountId={adAccountId}
                  selectedIds={selectedCampaignIds}
                  onToggle={handleToggleCampaign}
                />
              ) : (
                <CampaignPicker
                  adAccountId={adAccountId}
                  selectedId={selectedExisting?.id}
                  onSelect={handlePickCampaign}
                />
              )}
            </div>
          </Card>

          {/* Selected campaigns list — attach_campaign mode */}
          {isAttachCampaign && selectedCampaigns.length > 0 && (
            <Card>
              <CardTitle>
                Selected {selectedCampaigns.length === 1 ? "campaign" : `campaigns (${selectedCampaigns.length})`}
              </CardTitle>
              <CardDescription>
                {selectedCampaigns.length === 1
                  ? "The new ad set will be created under this campaign at launch."
                  : `One new ad set will be created under each campaign at launch, with a 1-second gap between them.`}
              </CardDescription>
              <ul className="mt-3 space-y-2">
                {selectedCampaigns.map((camp) => (
                  <li
                    key={camp.id}
                    className="flex items-start gap-3 rounded-md border border-primary bg-primary-light/40 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{camp.name}</span>
                        <Badge variant="primary">
                          {OBJECTIVE_LABELS[settings.objective] ?? camp.objective}
                        </Badge>
                        {camp.effectiveStatus && (
                          <Badge variant="outline">{camp.effectiveStatus}</Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5">{camp.id}</code>
                        <span>Raw objective: {camp.objective}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...settings,
                          existingMetaCampaigns: selectedCampaigns.filter((c) => c.id !== camp.id),
                          existingMetaCampaign: selectedCampaigns.filter((c) => c.id !== camp.id)[0],
                        })
                      }
                      className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                      aria-label={`Remove ${camp.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* Optimisation goal — applies to all new ad sets */}
              <div className="mt-4">
                <CardDescription className="mb-2">
                  Optimisation goal for new ad sets
                </CardDescription>
                <div className="flex flex-wrap gap-2">
                  {availableGoals.map((goal) => (
                    <button
                      key={goal.value}
                      type="button"
                      onClick={() => update({ optimisationGoal: goal.value as OptimisationGoal })}
                      className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                        ${settings.optimisationGoal === goal.value
                          ? "border-foreground bg-foreground text-background"
                          : "border-border-strong hover:bg-card"}`}
                    >
                      {goal.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Selected campaign snapshot — attach_adset mode (single-select) */}
          {isAttachAdSet && selectedExisting && (
            <Card>
              <CardTitle>Selected campaign</CardTitle>
              <CardDescription>
                The ad set you pick below must live under this campaign.
              </CardDescription>
              <div className="mt-3 space-y-2 rounded-md border border-primary bg-primary-light/40 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{selectedExisting.name}</span>
                  <Badge variant="primary">
                    {OBJECTIVE_LABELS[settings.objective]}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1.5 py-0.5">
                    {selectedExisting.id}
                  </code>
                  <span>Raw objective: {selectedExisting.objective}</span>
                  {selectedExisting.effectiveStatus && (
                    <span>Status: {selectedExisting.effectiveStatus}</span>
                  )}
                </div>
              </div>
            </Card>
          )}

          {!selectedExisting && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {isAttachAdSet
                ? "Pick a campaign above to load its ad sets."
                : isAttachCampaign && selectedCampaigns.length === 0
                ? "Select one or more campaigns above. A new ad set + ads will be created under each at launch."
                : "Pick a campaign above to continue."}
            </div>
          )}

          {/* Ad set picker — only in attach_adset mode and only after the
              parent campaign is selected. Multi-select. */}
          {isAttachAdSet && selectedExisting && (
            <Card>
              <CardTitle>Step 2 — Pick one or more ad sets</CardTitle>
              <CardDescription>
                Live ad sets under{" "}
                <span className="font-medium">{selectedExisting.name}</span>.
                The same set of new ads will be added under every ad set you
                pick. Each ad set keeps its existing audience, budget,
                schedule and optimisation.
              </CardDescription>
              <div className="mt-3">
                <AdSetPicker
                  campaignId={selectedExisting.id}
                  selectedIds={selectedAdSetIds}
                  onToggle={handleToggleAdSet}
                />
              </div>
            </Card>
          )}

          {/* Selected ad sets snapshot */}
          {isAttachAdSet && selectedAdSets.length > 0 && (
            <Card>
              <CardTitle>
                Selected ad sets ({selectedAdSets.length})
              </CardTitle>
              <CardDescription>
                New ads created in this wizard will be added to each of these
                ad sets at launch. Their audience, budget, schedule and
                optimisation are inherited unchanged.
              </CardDescription>
              <ul className="mt-3 space-y-2">
                {selectedAdSets.map((adSet) => (
                  <li
                    key={adSet.id}
                    className="flex items-start gap-3 rounded-md border border-primary bg-primary-light/40 p-3 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{adSet.name}</span>
                        <Badge variant="primary">
                          {adSet.effectiveStatus ?? adSet.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <code className="rounded bg-muted px-1.5 py-0.5">
                          {adSet.id}
                        </code>
                        {adSet.optimizationGoal && (
                          <span>Optimisation: {adSet.optimizationGoal}</span>
                        )}
                        {adSet.billingEvent && (
                          <span>Billing: {adSet.billingEvent}</span>
                        )}
                        {adSet.targetingSummary && (
                          <span>Audience: {adSet.targetingSummary}</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAdSet(adSet.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                      title="Remove from selection"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {isAttachAdSet &&
            selectedExisting &&
            selectedAdSets.length === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Pick at least one ad set above to continue.
              </div>
            )}
        </>
      ) : (
        <>
          <Card>
            <CardTitle>Campaign Objective</CardTitle>
            <CardDescription>What outcome do you want from this campaign?</CardDescription>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {OBJECTIVES.map((obj) => {
                const Icon = obj.icon;
                const selected = settings.objective === obj.value;
                return (
                  <button
                    key={obj.value}
                    type="button"
                    onClick={() => handleObjectiveChange(obj.value)}
                    className={`flex flex-col items-center gap-2 rounded-md border p-4 text-center transition-all
                      ${
                        selected
                          ? "border-foreground/20 bg-card"
                          : "border-transparent hover:border-border-strong hover:bg-card/60"
                      }`}
                  >
                    <Icon className={`h-5 w-5 ${selected ? "text-foreground" : "text-muted-foreground"}`} />
                    <span className="text-sm font-medium">{obj.label}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">{obj.sublabel}</span>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardTitle>Optimisation Goal</CardTitle>
            <CardDescription>
              How should Meta optimise delivery for{" "}
              <span className="font-medium text-foreground">{OBJECTIVE_LABELS[settings.objective]}</span>?
            </CardDescription>
            <div className="mt-3 flex gap-2">
              {availableGoals.map((goal) => (
                <button
                  key={goal.value}
                  type="button"
                  onClick={() => update({ optimisationGoal: goal.value as OptimisationGoal })}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                    ${
                      settings.optimisationGoal === goal.value
                        ? "border-foreground bg-foreground text-background"
                        : "border-border-strong hover:bg-card"
                    }`}
                >
                  {goal.label}
                </button>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle>Campaign Code</CardTitle>
              <CardDescription>Internal reference code.</CardDescription>
              <div className="mt-3">
                <Input
                  value={settings.campaignCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="e.g. UTB0044"
                />
              </div>
            </Card>

            <Card>
              <CardTitle>Campaign Name</CardTitle>
              <CardDescription>Auto-suggested from code + objective.</CardDescription>
              <div className="mt-3">
                <Input
                  value={settings.campaignName}
                  onChange={(e) => update({ campaignName: e.target.value })}
                  placeholder="e.g. [UTB0044] Purchase | Junction 2: Fragrance"
                />
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
