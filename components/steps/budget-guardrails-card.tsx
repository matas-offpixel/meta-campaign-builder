"use client";

import { useState } from "react";
import {
  Shield,
  AlertTriangle,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { CardDescription, Datum } from "@/components/steps/step-surface";
import { Card, CardTitle } from "@/components/ui/card";
import type { BudgetGuardrails, BudgetCeilingScope, CeilingBehaviour } from "@/lib/types";

export const EXPANSION_OPTIONS = [
  { value: "0", label: "0% (no expansion)" },
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "100", label: "100% (2×)" },
  { value: "200", label: "200% (3×)" },
  { value: "custom", label: "Custom" },
];

export const CEILING_BEHAVIOUR_OPTIONS: { id: CeilingBehaviour; label: string; description: string }[] = [
  { id: "stop", label: "Stop increases at ceiling", description: "Budget stays at the maximum — no further scaling" },
  { id: "partial", label: "Partially apply increase", description: "Apply only the portion that fits under the ceiling" },
  { id: "pause_scaling", label: "Pause scaling automation", description: "Disable all increase rules until manual review" },
];

export function BudgetGuardrailsCard({
  guardrails,
  currency,
  budgetAmount,
  onChange,
}: {
  guardrails: BudgetGuardrails;
  currency: string;
  budgetAmount: number;
  onChange: (g: BudgetGuardrails) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency;

  const base = guardrails.baseAdSetBudget || guardrails.baseCampaignBudget || budgetAmount;
  const ceiling = guardrails.hardBudgetCeiling;
  const expansionPct = guardrails.maxExpansionPercent;
  const ceilingScope = guardrails.budgetCeilingScope ?? "ad_set";
  const scopeIsAdSet = ceilingScope === "ad_set" || ceilingScope === "both";
  const scopeIsCampaign = ceilingScope === "campaign" || ceilingScope === "both";

  const isPreset = [0, 25, 50, 100, 200].includes(expansionPct);
  const [customMode, setCustomMode] = useState(!isPreset);

  const updateField = <K extends keyof BudgetGuardrails>(key: K, value: BudgetGuardrails[K]) => {
    onChange({ ...guardrails, [key]: value });
  };

  const handleExpansionChange = (val: string) => {
    if (val === "custom") {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    const pct = Number(val);
    const newCeiling = Math.round(base * (1 + pct / 100));
    onChange({ ...guardrails, maxExpansionPercent: pct, hardBudgetCeiling: newCeiling });
  };

  const handleCustomExpansion = (pct: number) => {
    const clamped = Math.max(0, pct);
    const newCeiling = Math.round(base * (1 + clamped / 100));
    onChange({ ...guardrails, maxExpansionPercent: clamped, hardBudgetCeiling: newCeiling });
  };

  const handleBaseChange = (newBase: number) => {
    const clamped = Math.max(0, newBase);
    const newCeiling = Math.round(clamped * (1 + expansionPct / 100));
    onChange({
      ...guardrails,
      baseAdSetBudget: clamped,
      baseCampaignBudget: clamped,
      hardBudgetCeiling: newCeiling,
    });
  };

  const usagePct = base > 0 ? Math.round((base / ceiling) * 100) : 0;

  return (
    <Card>
      <div className="flex items-center gap-2 mb-1">
        <Shield className="h-4.5 w-4.5 text-primary" />
        <CardTitle>Budget Guardrails</CardTitle>
      </div>
      <CardDescription className="mb-4">
        Hard limits that prevent automation from scaling budgets beyond a defined ceiling.
      </CardDescription>

      <div className="space-y-5">
        {/* Base + Ceiling visual */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Base ad-set budget</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{sym}</span>
              <input
                type="number"
                min={0}
                value={base}
                onChange={(e) => handleBaseChange(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-border-strong bg-background pl-7 pr-3 text-sm text-foreground
                  focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Max Expansion</label>
            <select
              value={customMode ? "custom" : String(expansionPct)}
              onChange={(e) => handleExpansionChange(e.target.value)}
              className="h-9 w-full appearance-none rounded-md border border-border-strong bg-background px-3 text-sm text-foreground
                focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {EXPANSION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {customMode && (
              <div className="mt-1.5 relative">
                <input
                  type="number"
                  min={0}
                  value={expansionPct}
                  onChange={(e) => handleCustomExpansion(Number(e.target.value))}
                  className="h-8 w-full rounded-md border border-border-strong bg-background pl-3 pr-7 text-xs text-foreground
                    focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Hard Budget Ceiling</label>
            <div className="flex h-9 items-center rounded-lg border border-primary/30 bg-primary-light px-3">
              <span className="text-sm font-semibold text-primary">{sym}{ceiling.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Visual bar */}
        <div className="rounded-md border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>Base: {sym}{base.toLocaleString()}</span>
            <span>Ceiling: {sym}{ceiling.toLocaleString()}</span>
          </div>
          <div className="relative h-3 rounded-full bg-muted overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary/30 transition-all"
              style={{ width: "100%" }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all"
              style={{ width: `${usagePct}%` }}
            />
          </div>
          
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Ceiling applies to</label>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { id: "ad_set" as const, label: "Ad set" },
              { id: "campaign" as const, label: "Campaign" },
              { id: "both" as const, label: "Both" },
            ] satisfies { id: BudgetCeilingScope; label: string }[]).map((opt) => {
              const current = guardrails.budgetCeilingScope ?? "ad_set";
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => updateField("budgetCeilingScope", opt.id)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all
                    ${current === opt.id
                      ? "border-primary bg-primary-light text-foreground"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                    }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {scopeIsAdSet && (
          <div className="rounded-md border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <label className="text-sm font-medium text-foreground">Max single ad-set budget</label>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={guardrails.maxSingleAdSetBudgetType ?? "fixed"}
                onChange={(e) => updateField("maxSingleAdSetBudgetType", e.target.value as "fixed" | "percent")}
                className="h-8 w-28 appearance-none rounded-md border border-border bg-card px-2 text-xs text-foreground
                  focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="fixed">Fixed ({sym})</option>
                <option value="percent">% of base</option>
              </select>
              <div className="relative flex-1">
                {(guardrails.maxSingleAdSetBudgetType ?? "fixed") === "fixed" && (
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{sym}</span>
                )}
                <input
                  type="number"
                  min={0}
                  value={guardrails.maxSingleAdSetBudget ?? ""}
                  placeholder={`e.g. ${(guardrails.maxSingleAdSetBudgetType ?? "fixed") === "fixed" ? "200" : "40"}`}
                  onChange={(e) => updateField("maxSingleAdSetBudget", e.target.value ? Number(e.target.value) : undefined)}
                  className={`h-8 w-full rounded-md border border-border bg-card pr-3 text-xs text-foreground
                    focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20
                    ${(guardrails.maxSingleAdSetBudgetType ?? "fixed") === "fixed" ? "pl-7" : "pl-3"}`}
                />
                {(guardrails.maxSingleAdSetBudgetType ?? "fixed") === "percent" && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                )}
              </div>
            </div>
            {guardrails.maxSingleAdSetBudget != null && (guardrails.maxSingleAdSetBudgetType ?? "fixed") === "percent" && (
              <Datum className="mt-1 text-xs text-muted-foreground">
                = {sym}{Math.round(base * (guardrails.maxSingleAdSetBudget / 100)).toLocaleString()} per ad set
              </Datum>
            )}
          </div>
        )}

        {scopeIsCampaign && (
          <div className="rounded-md border border-border bg-card px-4 py-3 space-y-3">
            <label className="text-sm font-medium text-foreground">Campaign daily ceiling</label>
            <Datum className="text-xs text-muted-foreground">
              Derived from remaining planned spend ÷ remaining days — the same plan the pacing alert uses. Not a number to type.
            </Datum>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { id: "derived" as const, label: "Derived" },
                { id: "typed" as const, label: "Typed" },
              ]).map((opt) => {
                const current = guardrails.campaignDailyCeilingSource ?? "derived";
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => updateField("campaignDailyCeilingSource", opt.id)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-all
                      ${current === opt.id
                        ? "border-primary bg-primary-light text-foreground"
                        : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                      }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {(guardrails.campaignDailyCeilingSource ?? "derived") === "typed" && (
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{sym}</span>
                <input
                  type="number"
                  min={0}
                  value={guardrails.campaignDailyCeiling ?? ""}
                  placeholder="e.g. 300"
                  onChange={(e) =>
                    updateField(
                      "campaignDailyCeiling",
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                  className="h-8 w-full rounded-md border border-border bg-card pl-7 pr-3 text-xs text-foreground
                    focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            )}
          </div>
        )}

        {/* Ceiling behaviour */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">Behaviour at Ceiling</label>
          <div className="grid gap-1.5">
            {CEILING_BEHAVIOUR_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => updateField("ceilingBehaviour", opt.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all text-sm
                  ${guardrails.ceilingBehaviour === opt.id
                    ? "border-primary bg-primary-light"
                    : "border-border bg-card hover:bg-muted/40"
                  }`}
              >
                <div className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors
                  ${guardrails.ceilingBehaviour === opt.id ? "border-primary bg-primary" : "border-border"}`}>
                  {guardrails.ceilingBehaviour === opt.id && <div className="h-full w-full rounded-full ring-2 ring-white ring-inset" />}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-foreground">{opt.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{opt.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Advanced guardrails */}
        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {advancedOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Advanced Guardrails
          </button>

          {advancedOpen && (
            <div className="mt-3 space-y-4">
              {/* Max daily increase */}
              <div className="rounded-md border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">Max Budget Increase per 24h</label>
                </div>
                <div className="relative w-40">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={guardrails.maxDailyIncreasePercent ?? ""}
                    placeholder="e.g. 50"
                    onChange={(e) => updateField("maxDailyIncreasePercent", e.target.value ? Number(e.target.value) : undefined)}
                    className="h-8 w-full rounded-md border border-border bg-card pl-3 pr-7 text-xs text-foreground
                      focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                </div>
                
              </div>

              {/* Cooldown */}
              <div className="rounded-md border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">Cooldown After Budget Change</label>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={guardrails.cooldownHours != null ? String(guardrails.cooldownHours) : ""}
                    onChange={(e) => updateField("cooldownHours", e.target.value ? Number(e.target.value) : undefined)}
                    className="h-8 w-40 appearance-none rounded-md border border-border bg-card px-2 text-xs text-foreground
                      focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">No cooldown</option>
                    <option value="6">6 hours</option>
                    <option value="12">12 hours</option>
                    <option value="24">24 hours</option>
                    <option value="48">48 hours</option>
                  </select>
                </div>
                {guardrails.cooldownHours != null && (
                  <Datum className="mt-1 text-xs text-muted-foreground">
                    Wait {guardrails.cooldownHours}h after any budget change before allowing the next increase.
                  </Datum>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
