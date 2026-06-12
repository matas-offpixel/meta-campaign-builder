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
import { ATTACH_CAMPAIGN_CAP, CROSS_CAMPAIGN_ADSET_CAP } from "@/lib/types";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "@/lib/mock-data";
import {
  Target, ShoppingCart, MousePointerClick, Eye, MessageSquare,
  Plus, Link2, Layers, AlertCircle, Info, X, ListChecks,
} from "lucide-react";
import { CampaignMultiPicker } from "@/components/bulk-attach/campaign-multi-picker";
import { AdSetPicker } from "./adset-picker";
import { CrossCampaignAdSetPicker } from "./cross-campaign-adset-picker";

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
  const isAttachAllAdSets = mode === "attach_all_adsets";
  // `attach_all_adsets` is a sub-mode of the "attach campaign" flow — both
  // modes share the campaign picker and selected-campaigns card.
  const isAttachCampaignFamily = isAttachCampaign || isAttachAllAdSets;
  const isAttach = isAttachCampaignFamily || isAttachAdSet;

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
      const {
        existingMetaCampaign: _dropC,
        existingMetaCampaigns: _dropCs,
        existingMetaAdSet: _dropAS,
        existingMetaAdSets: _dropASs,
        ...rest
      } = settings;
      void _dropC; void _dropCs; void _dropAS; void _dropASs;
      onChange({ ...rest, wizardMode: "new" });
      return;
    }
    if (next === "attach_campaign" || next === "attach_all_adsets") {
      // Keep the campaign snapshots (still valid) but drop ad set snapshots.
      const {
        existingMetaAdSet: _dropAS,
        existingMetaAdSets: _dropASs,
        ...rest
      } = settings;
      void _dropAS; void _dropASs;
      onChange({ ...rest, wizardMode: next });
      return;
    }
    // next === "attach_adset" — now allowed for multi-campaign when all campaigns
    // share the same objective (cross-campaign ad set attach, GOAL 3).
    // The allSameObjective check is done at render time to show/hide the button.
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

  // Whether all selected campaigns share the same objective (checked at
  // render time to gate attach_adset availability for cross-campaign mode).
  const allSameObjective = useMemo(() => {
    if (selectedCampaigns.length <= 1) return true;
    const first = selectedCampaigns[0].objective;
    return selectedCampaigns.every((c) => c.objective === first);
  }, [selectedCampaigns]);

  // The raw Meta objective shared across all selected campaigns (null when
  // none selected or objectives differ). Used to filter the picker.
  const sharedRawObjective = useMemo<string | null>(() => {
    if (selectedCampaigns.length === 0) return null;
    return allSameObjective ? (selectedCampaigns[0].objective ?? null) : null;
  }, [selectedCampaigns, allSameObjective]);

  // Callback passed to CampaignMultiPicker to grey out campaigns whose
  // objective differs from the currently-selected campaigns' objective.
  const getObjectiveDisabledReason = useCallback(
    (campaign: MetaCampaignSummary): string | undefined => {
      if (!sharedRawObjective) return undefined;
      if (selectedCampaignIds.has(campaign.id)) return undefined; // already selected — don't disable
      if (campaign.objective !== sharedRawObjective) {
        return "Different objective from selected campaigns — clear selection to pick a different objective";
      }
      return undefined;
    },
    [sharedRawObjective, selectedCampaignIds],
  );

  // Multi-select toggle used by CampaignMultiPicker in attach_campaign mode.
  const handleToggleCampaign = useCallback((campaign: MetaCampaignSummary) => {
    if (!campaign.compatible || !campaign.internalObjective) return;

    // GOAL 1: prevent adding a campaign with a different objective than the
    // existing selection (the picker already greys it out, this is a safety net).
    if (
      selectedCampaigns.length > 0 &&
      !selectedCampaignIds.has(campaign.id) &&
      sharedRawObjective &&
      campaign.objective !== sharedRawObjective
    ) {
      return;
    }

    const alreadySelected = selectedCampaignIds.has(campaign.id);
    let nextList: ExistingMetaCampaignSnapshot[];

    if (alreadySelected) {
      nextList = selectedCampaigns.filter((c) => c.id !== campaign.id);
    } else {
      if (selectedCampaigns.length >= ATTACH_CAMPAIGN_CAP) return;
      const snapshot: ExistingMetaCampaignSnapshot = {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        // Store internalObjective so we can reconstruct settings.objective when
        // this campaign later moves to the front of the list (e.g. first is deselected).
        internalObjective: campaign.internalObjective ?? undefined,
        status: campaign.status,
        effectiveStatus: campaign.effectiveStatus,
        capturedAt: new Date().toISOString(),
      };
      nextList = [...selectedCampaigns, snapshot];
    }

    // GOAL 1 FIX: always derive objective from the FIRST campaign in the new
    // list using its stored internalObjective, not from the toggled campaign.
    // This prevents settings.objective drifting away from the first campaign's
    // objective when adding/removing additional campaigns.
    const firstCamp = nextList[0];
    const firstInternal: CampaignObjective = firstCamp
      ? (firstCamp.internalObjective ?? settings.objective)
      : settings.objective;
    const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[firstInternal] ?? [];
    const goalValid = goals.some((g) => g.value === settings.optimisationGoal);
    const nextGoal = goalValid
      ? settings.optimisationGoal
      : goals[0]?.value ?? settings.optimisationGoal;

    onChange({
      ...settings,
      wizardMode: isAttachAllAdSets ? "attach_all_adsets" : "attach_campaign",
      objective: firstCamp ? firstInternal : settings.objective,
      optimisationGoal: nextGoal as OptimisationGoal,
      existingMetaCampaigns: nextList,
      existingMetaCampaign: nextList[0],
    });
  }, [selectedCampaigns, selectedCampaignIds, sharedRawObjective, settings, onChange, isAttachAllAdSets]);

  // Always operate on the multi-select array. Read sites that haven't been
  // migrated yet still consult `existingMetaAdSet` (kept for back-compat),
  // but we authoritatively write to the new array here.
  const selectedAdSets = useMemo<ExistingMetaAdSetSnapshot[]>(
    () =>
      settings.existingMetaAdSets ??
      (settings.existingMetaAdSet ? [settings.existingMetaAdSet] : []),
    [settings.existingMetaAdSets, settings.existingMetaAdSet],
  );

  // Multi-select handler for attach_adset — same objective guard as
  // attach_campaign; drops ad sets that belonged to a deselected campaign.
  const handleToggleCampaignAdSet = useCallback(
    (campaign: MetaCampaignSummary) => {
      if (!campaign.compatible || !campaign.internalObjective) return;

      if (
        selectedCampaigns.length > 0 &&
        !selectedCampaignIds.has(campaign.id) &&
        sharedRawObjective &&
        campaign.objective !== sharedRawObjective
      ) {
        return;
      }

      const alreadySelected = selectedCampaignIds.has(campaign.id);
      let nextList: ExistingMetaCampaignSnapshot[];

      if (alreadySelected) {
        nextList = selectedCampaigns.filter((c) => c.id !== campaign.id);
      } else {
        if (selectedCampaigns.length >= ATTACH_CAMPAIGN_CAP) return;
        nextList = [
          ...selectedCampaigns,
          {
            id: campaign.id,
            name: campaign.name,
            objective: campaign.objective,
            internalObjective: campaign.internalObjective ?? undefined,
            status: campaign.status,
            effectiveStatus: campaign.effectiveStatus,
            capturedAt: new Date().toISOString(),
          },
        ];
      }

      const firstCamp = nextList[0];
      const firstInternal: CampaignObjective = firstCamp
        ? (firstCamp.internalObjective ?? settings.objective)
        : settings.objective;
      const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[firstInternal] ?? [];
      const goalValid = goals.some((g) => g.value === settings.optimisationGoal);
      const nextGoal = goalValid
        ? settings.optimisationGoal
        : goals[0]?.value ?? settings.optimisationGoal;

      const allowedCampaignIds = new Set(nextList.map((c) => c.id));
      const nextAdSets = selectedAdSets.filter(
        (a) => !a.campaignId || allowedCampaignIds.has(a.campaignId),
      );

      onChange({
        ...settings,
        wizardMode: "attach_adset",
        objective: firstCamp ? firstInternal : settings.objective,
        optimisationGoal: nextGoal as OptimisationGoal,
        existingMetaCampaigns: nextList,
        existingMetaCampaign: nextList[0],
        existingMetaAdSets: nextAdSets,
        existingMetaAdSet: nextAdSets[0],
      });
    },
    [
      selectedCampaigns,
      selectedCampaignIds,
      selectedAdSets,
      sharedRawObjective,
      settings,
      onChange,
    ],
  );

  const handleToggleAdSet = (adSet: MetaAdSetSummary) => {
    if (!adSet.compatible) return;
    // GOAL 3: for cross-campaign, find the parent from selectedCampaigns using
    // adSet.campaignId; fall back to the first selected campaign.
    const parent =
      (adSet.campaignId
        ? selectedCampaigns.find((c) => c.id === adSet.campaignId)
        : null) ??
      selectedExisting ??
      settings.existingMetaCampaign;
    if (!parent) return;

    const exists = selectedAdSets.some((a) => a.id === adSet.id);
    let nextList: ExistingMetaAdSetSnapshot[];
    if (exists) {
      nextList = selectedAdSets.filter((a) => a.id !== adSet.id);
      console.log(
        `[CampaignSetup] de-selected ad set ${adSet.id} ("${adSet.name}")` +
          ` — ${nextList.length} remaining`,
      );
    } else {
      if (
        selectedCampaigns.length > 1 &&
        selectedAdSets.length >= CROSS_CAMPAIGN_ADSET_CAP
      ) {
        return;
      }
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

  // First selected campaign — used as "parent" in single-campaign attach_adset.
  const selectedExisting = selectedCampaigns[0] ?? settings.existingMetaCampaign;
  const adAccountId = settings.metaAdAccountId ?? settings.adAccountId;
  const isCrossMultiCampaignAdSet = isAttachAdSet && selectedCampaigns.length > 1;
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
            ? "Pick the existing campaign(s) and ad set(s) you want to add new ads to."
            : isAttachAllAdSets
            ? "New ads will be attached to ALL active/paused ad sets across selected campaigns at launch."
            : isAttachCampaign
            ? "Pick the existing campaign(s) you want to add a new ad set under."
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
              disabledTitle: undefined,
            },
            {
              // "attach_campaign" is the top-level mode for both
              // "create new ad set" (attach_campaign) and "all existing ad
              // sets" (attach_all_adsets). The sub-toggle below the picker
              // differentiates between the two.
              value: "attach_campaign" as const,
              label: "Add to existing campaign",
              desc: "Pick live campaign(s) — create a new ad set under each, or attach ads to all their existing ad sets.",
              icon: Link2,
              disabled: false,
              disabledTitle: undefined,
            },
            {
              value: "attach_adset" as const,
              label: "Add to existing ad set",
              desc: selectedCampaigns.length > 1 && !allSameObjective
                ? "Campaigns have incompatible objectives — select campaigns with the same objective to pick ad sets."
                : "Pick specific live ad sets and add new ads only — audience, budget and optimisation are inherited.",
              icon: Layers,
              disabled: selectedCampaigns.length > 1 && !allSameObjective,
              disabledTitle: selectedCampaigns.length > 1 && !allSameObjective
                ? "All selected campaigns must share the same objective to pick cross-campaign ad sets"
                : undefined,
            },
          ]).map(({ value, label, desc, icon: Icon, disabled, disabledTitle }) => {
            // "attach_campaign" button appears selected for both attach_campaign
            // and attach_all_adsets (the sub-toggle distinguishes them).
            const selected = value === "attach_campaign"
              ? isAttachCampaignFamily
              : mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => !disabled && setMode(value)}
                disabled={disabled}
                title={disabledTitle}
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
                The wizard skips Optimisation, Audiences and Budget — those stay
                as they are on each live ad set. You only configure creatives,
                then assign them to the existing ad set(s).
              </span>
            </div>
          )}

          {isAttachAllAdSets && (
            <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary-light/30 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium text-foreground">Attach-all mode.</span>{" "}
                At launch the wizard will fetch every <strong>active/paused</strong>{" "}
                ad set across the selected campaigns and attach your new ads to each
                one. No budget or targeting changes — up to {25} total ad sets.
              </span>
            </div>
          )}

          {/* Campaign picker — multi-select for all attach modes */}
          <Card>
            <CardTitle>
              {isAttachAdSet
                ? selectedCampaigns.length > 0
                  ? `Pick parent campaigns (${selectedCampaigns.length} selected)`
                  : "Pick parent campaigns"
                : selectedCampaigns.length > 1
                ? `Pick existing campaigns (${selectedCampaigns.length} selected)`
                : "Pick existing campaigns"}
            </CardTitle>
            <CardDescription>
              Select up to {ATTACH_CAMPAIGN_CAP} live campaigns under{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {adAccountId ?? "—"}
              </code>
              . All selected campaigns must share the same objective.{" "}
              <span className="text-foreground">
                Campaigns with a different objective are greyed out.
              </span>
            </CardDescription>
            <div className="mt-3">
              <CampaignMultiPicker
                adAccountId={adAccountId}
                selectedIds={selectedCampaignIds}
                onToggle={
                  isAttachAdSet ? handleToggleCampaignAdSet : handleToggleCampaign
                }
                getExtraDisabledReason={getObjectiveDisabledReason}
              />
            </div>
          </Card>

          {/* Selected campaigns list — attach_campaign / attach_all_adsets */}
          {isAttachCampaignFamily && selectedCampaigns.length > 0 && (
            <Card>
              <CardTitle>
                Selected {selectedCampaigns.length === 1 ? "campaign" : `campaigns (${selectedCampaigns.length})`}
              </CardTitle>
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
                      onClick={() => {
                        const next = selectedCampaigns.filter((c) => c.id !== camp.id);
                        onChange({
                          ...settings,
                          existingMetaCampaigns: next,
                          existingMetaCampaign: next[0],
                        });
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
                      aria-label={`Remove ${camp.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              {/* GOAL 2 — sub-toggle: "Create new ad set" vs "Attach to all existing ad sets" */}
              <div className="mt-4 space-y-2">
                <CardDescription>What should happen under each campaign at launch?</CardDescription>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {([
                    {
                      value: "attach_campaign" as const,
                      label: "Create new ad set",
                      desc: "The wizard creates one new ad set + ads under each campaign.",
                      icon: Plus,
                    },
                    {
                      value: "attach_all_adsets" as const,
                      label: "Attach ads to all existing ad sets",
                      desc: `Fetch all active/paused ad sets at launch and attach new ads to each (max ${25} total).`,
                      icon: ListChecks,
                    },
                  ] as const).map(({ value, label, desc, icon: Icon }) => {
                    const isSubSelected = mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setMode(value)}
                        className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors
                          ${isSubSelected
                            ? "border-foreground bg-card"
                            : "border-border-strong hover:bg-card/60"}`}
                      >
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isSubSelected ? "text-foreground" : "text-muted-foreground"}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optimisation goal — only relevant when creating new ad sets */}
              {isAttachCampaign && (
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
              )}
            </Card>
          )}

          {/* Selected campaign snapshot — attach_adset single-campaign mode */}
          {isAttachAdSet && !isCrossMultiCampaignAdSet && selectedExisting && (
            <Card>
              <CardTitle>Selected campaign</CardTitle>
              <CardDescription>
                The ad set(s) you pick below must live under this campaign.
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

          {/* No campaign selected warning */}
          {!selectedExisting && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {isAttachAdSet
                ? "Pick one or more campaigns above to load their ad sets."
                : isAttachCampaignFamily && selectedCampaigns.length === 0
                ? "Select one or more campaigns above."
                : "Pick a campaign above to continue."}
            </div>
          )}

          {/* Ad set picker — attach_adset mode, single campaign */}
          {isAttachAdSet && !isCrossMultiCampaignAdSet && selectedExisting && (
            <Card>
              <CardTitle>Step 2 — Pick one or more ad sets</CardTitle>
              <CardDescription>
                Live ad sets under{" "}
                <span className="font-medium">{selectedExisting.name}</span>.
                The same new ads will be added under every ad set you pick.
                Each ad set keeps its existing audience, budget, schedule and
                optimisation.
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

          {/* GOAL 3 — cross-campaign ad set picker */}
          {isCrossMultiCampaignAdSet && (
            <Card>
              <CardTitle>
                Step 2 — Pick ad sets{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  (max {CROSS_CAMPAIGN_ADSET_CAP} total)
                </span>
              </CardTitle>
              <CardDescription>
                Active/paused ad sets from all {selectedCampaigns.length} selected campaigns.
                New ads will be added to every checked ad set at launch.
              </CardDescription>
              <div className="mt-3">
                <CrossCampaignAdSetPicker
                  campaigns={selectedCampaigns.map((c) => ({ id: c.id, name: c.name }))}
                  selectedIds={selectedAdSetIds}
                  onToggle={handleToggleAdSet}
                  maxTotal={CROSS_CAMPAIGN_ADSET_CAP}
                />
              </div>
            </Card>
          )}

          {/* Selected ad sets snapshot */}
          {isAttachAdSet && selectedAdSets.length > 0 && (
            <Card>
              <CardTitle>
                Selected ad sets ({selectedAdSets.length}
                {isCrossMultiCampaignAdSet ? ` / ${CROSS_CAMPAIGN_ADSET_CAP}` : ""})
              </CardTitle>
              <CardDescription>
                New ads will be added to each of these ad sets at launch.
                Their audience, budget, schedule and optimisation are inherited.
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
                        {adSet.campaignName && isCrossMultiCampaignAdSet && (
                          <span className="text-muted-foreground">
                            Campaign: {adSet.campaignName}
                          </span>
                        )}
                        {adSet.optimizationGoal && (
                          <span>Opt: {adSet.optimizationGoal}</span>
                        )}
                        {adSet.targetingSummary && (
                          <span className="truncate max-w-[200px]">
                            {adSet.targetingSummary}
                          </span>
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
            (selectedExisting || isCrossMultiCampaignAdSet) &&
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
