"use client";

import { useEffect } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { CampaignSettings, CampaignObjective, OptimisationGoal } from "@/lib/types";
import { OPTIMISATION_GOALS_BY_OBJECTIVE } from "@/lib/mock-data";
import { Target, ShoppingCart, MousePointerClick, Eye, MessageSquare } from "lucide-react";

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Campaign Config</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose your campaign objective, name, and optimisation goal.
        </p>
      </div>

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
    </div>
  );
}
