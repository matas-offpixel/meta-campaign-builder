"use client";

import { useEffect } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type {
  CampaignSettings,
  CampaignObjective,
  MetaCampaignSummary,
  OptimisationGoal,
} from "@/lib/types";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "@/lib/mock-data";
import {
  Target, ShoppingCart, MousePointerClick, Eye, MessageSquare,
  Plus, Link2, AlertCircle,
} from "lucide-react";
import { CampaignPicker } from "./campaign-picker";

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

  const mode: "new" | "attach" = settings.wizardMode ?? "new";
  const isAttach = mode === "attach";

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

  const setMode = (next: "new" | "attach") => {
    if (next === mode) return;
    if (next === "new") {
      // Drop the attach snapshot but keep whatever name/objective the user
      // had configured before — they may want to edit it.
      const { existingMetaCampaign: _drop, ...rest } = settings;
      void _drop;
      onChange({ ...rest, wizardMode: "new" });
    } else {
      onChange({ ...settings, wizardMode: "attach" });
    }
  };

  // ── Picker selection ──────────────────────────────────────────────────────

  const handlePickCampaign = (campaign: MetaCampaignSummary) => {
    if (!campaign.compatible || !campaign.internalObjective) return;

    const goals = OPTIMISATION_GOALS_BY_OBJECTIVE[campaign.internalObjective] ?? [];
    const goalValid = goals.some((g) => g.value === settings.optimisationGoal);
    const nextGoal = goalValid
      ? settings.optimisationGoal
      : goals[0]?.value ?? settings.optimisationGoal;

    onChange({
      ...settings,
      wizardMode: "attach",
      // Mirror the live campaign's objective into settings so all downstream
      // logic (buildAdSetPayload, validation, review summary) keeps working
      // unchanged — that pipeline reads `settings.objective`, not the picker.
      objective: campaign.internalObjective,
      optimisationGoal: nextGoal as OptimisationGoal,
      // Stash a snapshot so the launch route can re-validate against the
      // live campaign and the review step can render its name without
      // refetching.
      existingMetaCampaign: {
        id: campaign.id,
        name: campaign.name,
        objective: campaign.objective,
        status: campaign.status,
        effectiveStatus: campaign.effectiveStatus,
        capturedAt: new Date().toISOString(),
      },
    });
  };

  const selectedExisting = settings.existingMetaCampaign;
  const adAccountId = settings.metaAdAccountId ?? settings.adAccountId;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Campaign Config</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAttach
            ? "Pick the existing campaign you want to add a new ad set under."
            : "Choose your campaign objective, name, and optimisation goal."}
        </p>
      </div>

      {/* Mode toggle */}
      <Card>
        <CardTitle>Where should this ad set live?</CardTitle>
        <CardDescription>
          Create a fresh campaign at launch, or add a new ad set under one
          that already exists in this ad account.
        </CardDescription>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            {
              value: "new" as const,
              label: "Create new campaign",
              desc: "The wizard provisions everything from scratch.",
              icon: Plus,
            },
            {
              value: "attach" as const,
              label: "Add to existing campaign",
              desc: "Pick a live campaign in this ad account and add a new ad set + ads under it.",
              icon: Link2,
            },
          ]).map(({ value, label, desc, icon: Icon }) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`flex items-start gap-3 rounded-md border px-3 py-3 text-left transition-colors
                  ${selected
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
          {/* Campaign picker */}
          <Card>
            <CardTitle>Pick an existing campaign</CardTitle>
            <CardDescription>
              Live campaigns under{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                {adAccountId ?? "—"}
              </code>
              . Compatible campaigns can be selected; the rest are shown
              greyed-out so you know they exist.
            </CardDescription>
            <div className="mt-3">
              <CampaignPicker
                adAccountId={adAccountId}
                selectedId={selectedExisting?.id}
                onSelect={handlePickCampaign}
              />
            </div>
          </Card>

          {/* Selected snapshot */}
          {selectedExisting && (
            <Card>
              <CardTitle>Selected campaign</CardTitle>
              <CardDescription>
                The new ad set will be created under this campaign at launch.
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

              {/* Optimisation goal still applies to the new ad set */}
              <div className="mt-4">
                <CardDescription className="mb-2">
                  Optimisation goal for the new ad set
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

          {!selectedExisting && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Pick a campaign above to continue. The rest of the wizard will
              build a single ad set + ads under it.
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
