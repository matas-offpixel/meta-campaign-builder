"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Pause,
  Zap,
  Settings2,
  Ban,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  RefreshCw,
  Shield,
  AlertTriangle,
  Clock,
  DollarSign,
  Crosshair,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type {
  CampaignObjective,
  OptimisationStrategySettings,
  OptimisationRule,
  OptimisationThreshold,
  RuleMetric,
  RuleTimeWindow,
  RuleAction,
  BenchmarkPercentile,
  BudgetGuardrails,
  CeilingBehaviour,
} from "@/lib/types";
import {
  ACCOUNT_BENCHMARKS,
  generateRulesForObjective,
  regenerateThresholdsFromTarget,
  getAccountBenchmarkMedian,
  METRIC_LABELS,
  TIME_WINDOW_LABELS,
  OBJECTIVE_METRIC_PRIORITY,
} from "@/lib/optimisation-rules";

interface OptimisationStrategyProps {
  strategy: OptimisationStrategySettings;
  objective: CampaignObjective;
  budgetAmount: number;
  currency: string;
  onChange: (strategy: OptimisationStrategySettings) => void;
}

const MODE_OPTIONS: { id: OptimisationStrategySettings["mode"]; label: string; description: string; icon: typeof Ban }[] = [
  { id: "none", label: "No Automation", description: "Manual optimisation only — no rules applied", icon: Ban },
  { id: "benchmarks", label: "Use Account Benchmarks", description: "Auto-generate rules from your account performance data", icon: Sparkles },
  { id: "custom", label: "Custom Rules", description: "Define your own thresholds and actions", icon: Settings2 },
];

const METRIC_OPTIONS: { value: RuleMetric; label: string }[] = [
  { value: "cpr", label: "CPR (Cost per Registration)" },
  { value: "cpc", label: "CPC (Cost per Click)" },
  { value: "cpa", label: "CPA (Cost per Acquisition)" },
  { value: "roas", label: "ROAS (Return on Ad Spend)" },
  { value: "cpm", label: "CPM (Cost per 1,000)" },
  { value: "lpv_cost", label: "LPV Cost (Landing Page View)" },
  { value: "ctr", label: "CTR (Click-through Rate)" },
];

const TIME_WINDOW_OPTIONS: { value: RuleTimeWindow; label: string }[] = [
  { value: "24h", label: "24 hours" },
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
];

const ACTION_OPTIONS: { value: RuleAction; label: string }[] = [
  { value: "increase_budget", label: "Increase budget" },
  { value: "decrease_budget", label: "Decrease budget" },
  { value: "pause", label: "Pause ad set" },
];

function actionIcon(action: RuleAction) {
  switch (action) {
    case "increase_budget": return <TrendingUp className="h-3.5 w-3.5 text-success" />;
    case "decrease_budget": return <TrendingDown className="h-3.5 w-3.5 text-warning" />;
    case "pause": return <Pause className="h-3.5 w-3.5 text-destructive" />;
  }
}

function actionColor(action: RuleAction) {
  switch (action) {
    case "increase_budget": return "bg-success/10 border-success/30 text-success";
    case "decrease_budget": return "bg-warning/10 border-warning/30 text-warning";
    case "pause": return "bg-destructive/10 border-destructive/30 text-destructive";
  }
}

function formatBenchmark(value: number, b: BenchmarkPercentile): string {
  if (b.metric === "roas") return `${value.toFixed(1)}×`;
  if (b.metric === "ctr") return `${value.toFixed(1)}%`;
  return `${b.currency ?? "£"}${value.toFixed(2)}`;
}

const TAG_ORDER: Record<string, number> = { primary: 0, secondary: 1, reference: 2 };

const TAG_STYLES: Record<string, { badge: "primary" | "warning" | "default"; border: string }> = {
  primary: { badge: "primary", border: "border-primary/30 bg-primary/[0.03]" },
  secondary: { badge: "warning", border: "border-warning/20 bg-warning/5" },
  reference: { badge: "default", border: "border-border bg-card" },
};

function BenchmarkCard({ benchmarks }: { benchmarks: BenchmarkPercentile[] }) {
  const sorted = [...benchmarks].sort(
    (a, b) => (TAG_ORDER[a.tag ?? "reference"] ?? 2) - (TAG_ORDER[b.tag ?? "reference"] ?? 2)
  );

  return (
    <Card className="bg-card">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-4.5 w-4.5 text-primary" />
        <CardTitle>Account Performance Benchmarks</CardTitle>
      </div>
      <CardDescription className="mb-4">
        Based on your last 90 days of campaign performance
      </CardDescription>
      <div className="grid gap-2.5">
        {sorted.map((b) => {
          const t = b.tag ?? "reference";
          const style = TAG_STYLES[t] ?? TAG_STYLES.reference;
          return (
            <div key={b.metric} className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${style.border}`}>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <Badge variant={style.badge} className="shrink-0 text-[10px] uppercase tracking-wider">
                  {t}
                </Badge>
                <p className="text-sm font-medium text-foreground">{b.metricLabel}</p>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">Top 25%</p>
                  <p className="font-semibold text-success">{formatBenchmark(b.top25, b)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">Median</p>
                  <p className="font-semibold text-foreground">{formatBenchmark(b.median, b)}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-0.5">Bottom 25%</p>
                  <p className="font-semibold text-warning">{formatBenchmark(b.bottom25, b)}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const OPERATOR_OPTIONS = [
  { value: "below", label: "Below" },
  { value: "between", label: "Between" },
  { value: "above", label: "Above" },
];

function ThresholdRowCompact({
  threshold,
  onRemove,
}: {
  threshold: OptimisationThreshold;
  onRemove: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${actionColor(threshold.action)}`}>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {actionIcon(threshold.action)}
        <span className="truncate">{threshold.label}</span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded p-1 hover:bg-black/5 text-current opacity-50 hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ThresholdRowEditable({
  threshold,
  onUpdate,
  onRemove,
}: {
  threshold: OptimisationThreshold;
  onUpdate: (t: OptimisationThreshold) => void;
  onRemove: () => void;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 text-sm space-y-2 ${actionColor(threshold.action)}`}>
      <div className="flex items-center gap-2">
        {actionIcon(threshold.action)}
        <input
          type="text"
          value={threshold.label}
          onChange={(e) => onUpdate({ ...threshold, label: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium border-none focus:outline-none text-current placeholder:opacity-50"
          placeholder="Threshold label"
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 hover:bg-black/5 text-current opacity-50 hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={threshold.operator}
          onChange={(e) => onUpdate({ ...threshold, operator: e.target.value as OptimisationThreshold["operator"] })}
          className="h-7 w-24 appearance-none rounded border border-current/20 bg-transparent px-2 text-xs focus:outline-none"
        >
          {OPERATOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="relative">
          <input
            type="number"
            step="any"
            value={threshold.value}
            onChange={(e) => onUpdate({ ...threshold, value: Number(e.target.value) })}
            className="h-7 w-20 rounded border border-current/20 bg-transparent px-2 text-xs focus:outline-none"
          />
        </div>
        {threshold.operator === "between" && (
          <>
            <span className="text-xs opacity-60">to</span>
            <input
              type="number"
              step="any"
              value={threshold.valueTo ?? ""}
              onChange={(e) => onUpdate({ ...threshold, valueTo: Number(e.target.value) })}
              className="h-7 w-20 rounded border border-current/20 bg-transparent px-2 text-xs focus:outline-none"
            />
          </>
        )}
        <select
          value={threshold.action}
          onChange={(e) => onUpdate({ ...threshold, action: e.target.value as RuleAction })}
          className="h-7 w-32 appearance-none rounded border border-current/20 bg-transparent px-2 text-xs focus:outline-none"
        >
          {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {threshold.action !== "pause" && (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={500}
              value={threshold.actionValue ?? 0}
              onChange={(e) => onUpdate({ ...threshold, actionValue: Number(e.target.value) })}
              className="h-7 w-16 rounded border border-current/20 bg-transparent px-2 text-xs focus:outline-none"
            />
            <span className="text-xs opacity-60">%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function RuleCard({
  rule,
  onUpdate,
  onRemove,
  isCustom,
  objective,
}: {
  rule: OptimisationRule;
  onUpdate: (r: OptimisationRule) => void;
  onRemove: () => void;
  isCustom: boolean;
  objective: CampaignObjective;
}) {
  const [expanded, setExpanded] = useState(true);
  const [advancedMode, setAdvancedMode] = useState(false);

  const toggleEnabled = () => onUpdate({ ...rule, enabled: !rule.enabled });

  const accountBenchmark = rule.accountBenchmarkValue ?? getAccountBenchmarkMedian(objective, rule.metric);
  const activeTarget = rule.useOverride && rule.campaignTargetValue != null
    ? rule.campaignTargetValue
    : accountBenchmark;
  const isRoas = rule.metric === "roas";
  const metricSym = isRoas ? "" : "£";
  const metricSuffix = isRoas ? "×" : "";

  const updateThreshold = (idx: number, t: OptimisationThreshold) => {
    const next = [...rule.thresholds];
    next[idx] = t;
    onUpdate({ ...rule, thresholds: next });
  };

  const removeThreshold = (idx: number) => {
    onUpdate({ ...rule, thresholds: rule.thresholds.filter((_, i) => i !== idx) });
  };

  const addThreshold = () => {
    const newT: OptimisationThreshold = {
      id: crypto.randomUUID(),
      operator: "above",
      value: 0,
      action: "decrease_budget",
      actionValue: 20,
      label: "New threshold — edit label",
    };
    onUpdate({ ...rule, thresholds: [...rule.thresholds, newT] });
  };

  const handleRegenerate = () => {
    if (activeTarget != null && activeTarget > 0) {
      onUpdate({ ...rule, thresholds: regenerateThresholdsFromTarget(rule.metric, activeTarget) });
    }
  };

  const handleOverrideToggle = () => {
    const next = !rule.useOverride;
    const updated: OptimisationRule = { ...rule, useOverride: next };
    if (next && rule.campaignTargetValue == null) {
      updated.campaignTargetValue = accountBenchmark;
    }
    onUpdate(updated);
  };

  const handleTargetChange = (val: number) => {
    onUpdate({ ...rule, campaignTargetValue: val });
  };

  const priorityBorderClass = rule.priority === "primary"
    ? "border-primary/30"
    : rule.priority === "secondary"
      ? "border-warning/30"
      : "border-border";

  return (
    <div className={`rounded-md border bg-card transition-all ${rule.enabled ? priorityBorderClass : "border-border/50 opacity-60"}`}>
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {rule.priority && (
              <Badge variant={rule.priority === "primary" ? "primary" : "warning"} className="text-[10px] uppercase tracking-wider">
                {rule.priority}
              </Badge>
            )}
            <span className="font-medium text-sm">{rule.name}</span>
            <Badge variant={rule.enabled ? "success" : "default"}>
              {rule.enabled ? "Active" : "Disabled"}
            </Badge>
            <Badge variant="outline">{METRIC_LABELS[rule.metric] ?? rule.metric}</Badge>
            <Badge variant="outline">{TIME_WINDOW_LABELS[rule.timeWindow]}</Badge>
            {rule.useOverride && rule.campaignTargetValue != null && (
              <Badge variant="warning" className="text-[10px]">
                Override: {metricSym}{rule.campaignTargetValue}{metricSuffix}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={toggleEnabled}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border transition-colors
              ${rule.enabled ? "bg-primary border-primary" : "bg-muted border-border"}`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform
              ${rule.enabled ? "translate-x-4" : "translate-x-0.5"} mt-px`} />
          </button>
          {isCustom && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Custom mode: name/metric/window */}
          {isCustom && (
            <div className="grid grid-cols-3 gap-3">
              <Input
                label="Rule Name"
                value={rule.name}
                onChange={(e) => onUpdate({ ...rule, name: e.target.value })}
              />
              <Select
                label="Metric"
                value={rule.metric}
                onChange={(e) => onUpdate({ ...rule, metric: e.target.value as RuleMetric })}
                options={METRIC_OPTIONS}
              />
              <Select
                label="Time Window"
                value={rule.timeWindow}
                onChange={(e) => onUpdate({ ...rule, timeWindow: e.target.value as RuleTimeWindow })}
                options={TIME_WINDOW_OPTIONS}
              />
            </div>
          )}

          {/* Benchmark override section */}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Crosshair className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">Campaign Target</span>
              </div>
              <button
                type="button"
                onClick={handleOverrideToggle}
                className={`relative inline-flex h-4.5 w-8 shrink-0 cursor-pointer rounded-full border transition-colors
                  ${rule.useOverride ? "bg-warning border-warning" : "bg-muted border-border"}`}
              >
                <span className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform
                  ${rule.useOverride ? "translate-x-3.5" : "translate-x-0.5"} mt-px`} />
              </button>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-0.5">Account benchmark</p>
                <p className="text-sm font-medium text-foreground">
                  {accountBenchmark != null ? `${metricSym}${accountBenchmark}${metricSuffix}` : "—"}
                </p>
              </div>
              {rule.useOverride ? (
                <div className="flex-1">
                  <p className="text-xs text-warning mb-0.5 font-medium">Campaign override</p>
                  <div className="relative">
                    {!isRoas && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{metricSym}</span>}
                    <input
                      type="number"
                      step="any"
                      min={0}
                      value={rule.campaignTargetValue ?? ""}
                      onChange={(e) => handleTargetChange(Number(e.target.value))}
                      className={`h-8 w-full rounded-md border border-warning/40 bg-warning/10 text-sm font-medium text-foreground
                        focus:border-warning focus:outline-none focus:ring-1 focus:ring-warning/20
                        ${isRoas ? "pl-2" : "pl-5"} pr-2`}
                    />
                    {isRoas && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>}
                  </div>
                </div>
              ) : (
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-0.5">Active target</p>
                  <p className="text-sm font-medium text-foreground">
                    {accountBenchmark != null ? `${metricSym}${accountBenchmark}${metricSuffix}` : "—"}
                    <span className="text-xs text-muted-foreground ml-1">(account)</span>
                  </p>
                </div>
              )}
            </div>
            {rule.useOverride && accountBenchmark != null && rule.campaignTargetValue != null && (
              <p className="text-xs text-warning mt-1.5">
                {rule.campaignTargetValue > accountBenchmark
                  ? `Target is ${isRoas ? "above" : "above"} account benchmark — thresholds tuned for ${isRoas ? "higher return" : "higher cost"} economics`
                  : rule.campaignTargetValue < accountBenchmark
                    ? `Target is below account benchmark — tighter ${isRoas ? "return" : "cost"} expectations`
                    : "Target matches account benchmark"}
              </p>
            )}
          </div>

          {/* Regenerate from target */}
          {activeTarget != null && activeTarget > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleRegenerate}>
                <RotateCcw className="h-3.5 w-3.5" />
                Regenerate from target
              </Button>
              <span className="text-xs text-muted-foreground">
                Rebuild bands around {metricSym}{activeTarget}{metricSuffix}
              </span>
            </div>
          )}

          {/* Quick / Advanced toggle */}
          <div className="flex items-center gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setAdvancedMode(false)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                ${!advancedMode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Zap className="h-3 w-3" />
              Quick view
            </button>
            <button
              type="button"
              onClick={() => setAdvancedMode(true)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                ${advancedMode ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <SlidersHorizontal className="h-3 w-3" />
              Advanced
            </button>
          </div>

          {/* Threshold rows */}
          <div className="space-y-2">
            {rule.thresholds.map((t, idx) =>
              advancedMode ? (
                <ThresholdRowEditable
                  key={t.id}
                  threshold={t}
                  onUpdate={(updated) => updateThreshold(idx, updated)}
                  onRemove={() => removeThreshold(idx)}
                />
              ) : (
                <ThresholdRowCompact
                  key={t.id}
                  threshold={t}
                  onRemove={() => removeThreshold(idx)}
                />
              )
            )}
          </div>

          {/* Add threshold */}
          {advancedMode && (
            <button
              type="button"
              onClick={addThreshold}
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover font-medium"
            >
              <Plus className="h-3.5 w-3.5" />
              Add threshold
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const EXPANSION_OPTIONS = [
  { value: "0", label: "0% (no expansion)" },
  { value: "25", label: "25%" },
  { value: "50", label: "50%" },
  { value: "100", label: "100% (2×)" },
  { value: "200", label: "200% (3×)" },
  { value: "custom", label: "Custom" },
];

const CEILING_BEHAVIOUR_OPTIONS: { id: CeilingBehaviour; label: string; description: string }[] = [
  { id: "stop", label: "Stop increases at ceiling", description: "Budget stays at the maximum — no further scaling" },
  { id: "partial", label: "Partially apply increase", description: "Apply only the portion that fits under the ceiling" },
  { id: "pause_scaling", label: "Pause scaling automation", description: "Disable all increase rules until manual review" },
];

function BudgetGuardrailsCard({
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

  const base = guardrails.baseCampaignBudget || budgetAmount;
  const ceiling = guardrails.hardBudgetCeiling;
  const expansionPct = guardrails.maxExpansionPercent;

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
    onChange({ ...guardrails, baseCampaignBudget: clamped, hardBudgetCeiling: newCeiling });
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
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Base Campaign Budget</label>
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
          <p className="mt-2 text-xs text-foreground">
            Automation can scale budgets up to <strong>{sym}{ceiling.toLocaleString()}</strong> total, but no further.
          </p>
        </div>

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
              {/* Max single ad set budget */}
              <div className="rounded-md border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <label className="text-sm font-medium text-foreground">Max Single Ad Set Budget</label>
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    = {sym}{Math.round(base * (guardrails.maxSingleAdSetBudget / 100)).toLocaleString()} per ad set
                  </p>
                )}
              </div>

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
                {guardrails.maxDailyIncreasePercent != null && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No single ad set can increase more than +{guardrails.maxDailyIncreasePercent}% in one adjustment cycle.
                  </p>
                )}
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
                  <p className="mt-1 text-xs text-muted-foreground">
                    Wait {guardrails.cooldownHours}h after any budget change before allowing the next increase.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function OptimisationStrategy({ strategy, objective, budgetAmount, currency, onChange }: OptimisationStrategyProps) {
  const benchmarks = useMemo(() => ACCOUNT_BENCHMARKS[objective] ?? [], [objective]);
  const [prevObjective, setPrevObjective] = useState(objective);

  const setMode = useCallback(
    (mode: OptimisationStrategySettings["mode"]) => {
      if (mode === "benchmarks") {
        onChange({ ...strategy, mode, rules: generateRulesForObjective(objective) });
      } else if (mode === "custom") {
        const base = strategy.rules.length > 0 ? strategy.rules : generateRulesForObjective(objective);
        onChange({ ...strategy, mode, rules: base });
      } else {
        onChange({ ...strategy, mode, rules: [] });
      }
    },
    [objective, onChange, strategy]
  );

  useEffect(() => {
    if (objective !== prevObjective) {
      setPrevObjective(objective);
      if (strategy.mode === "benchmarks") {
        onChange({ ...strategy, rules: generateRulesForObjective(objective) });
      }
    }
  }, [objective, prevObjective, strategy, onChange]);

  const regenerate = useCallback(() => {
    onChange({ ...strategy, rules: generateRulesForObjective(objective) });
  }, [objective, onChange, strategy]);

  const updateRule = useCallback(
    (idx: number, rule: OptimisationRule) => {
      const next = [...strategy.rules];
      next[idx] = rule;
      onChange({ ...strategy, rules: next });
    },
    [onChange, strategy]
  );

  const removeRule = useCallback(
    (idx: number) => {
      onChange({ ...strategy, rules: strategy.rules.filter((_, i) => i !== idx) });
    },
    [onChange, strategy]
  );

  const addCustomRule = useCallback(() => {
    const newRule: OptimisationRule = {
      id: crypto.randomUUID(),
      name: "New Rule",
      metric: "cpc",
      timeWindow: "24h",
      thresholds: [],
      enabled: true,
    };
    onChange({ ...strategy, rules: [...strategy.rules, newRule] });
  }, [onChange, strategy]);

  const updateGuardrails = useCallback(
    (guardrails: BudgetGuardrails) => {
      onChange({ ...strategy, guardrails });
    },
    [onChange, strategy]
  );

  useEffect(() => {
    if (
      budgetAmount > 0 &&
      strategy.guardrails &&
      strategy.guardrails.baseCampaignBudget !== budgetAmount
    ) {
      const g = strategy.guardrails;
      const newCeiling = Math.round(budgetAmount * (1 + g.maxExpansionPercent / 100));
      onChange({
        ...strategy,
        guardrails: { ...g, baseCampaignBudget: budgetAmount, hardBudgetCeiling: newCeiling },
      });
    }
    // only react to budgetAmount changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetAmount]);

  const activeRuleCount = strategy.rules.filter((r) => r.enabled).length;
  const totalThresholds = strategy.rules
    .filter((r) => r.enabled)
    .reduce((sum, r) => sum + r.thresholds.length, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Optimisation Strategy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure performance-based rules that automatically scale, reduce, or pause ad sets based on live metrics.
        </p>
      </div>

      <BenchmarkCard benchmarks={benchmarks} />

      {/* Strategy mode selector */}
      <Card>
        <CardTitle className="mb-3">Strategy Mode</CardTitle>
        <div className="grid gap-2">
          {MODE_OPTIONS.map((opt) => {
            const isActive = strategy.mode === opt.id;
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all
                  ${isActive
                    ? "border-primary bg-primary-light ring-1 ring-primary/20"
                    : "border-border bg-card hover:border-border-strong hover:bg-muted/40"
                  }`}
              >
                <div className={`mt-0.5 rounded-md p-1.5 ${isActive ? "bg-foreground text-background" : "bg-muted text-muted-foreground"}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isActive ? "text-foreground" : "text-foreground"}`}>
                    {opt.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                </div>
                <div className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition-colors
                  ${isActive ? "border-primary bg-primary" : "border-border"}`}>
                  {isActive && <div className="h-full w-full rounded-full ring-2 ring-white ring-inset" />}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Rules section */}
      {strategy.mode !== "none" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-4.5 w-4.5 text-primary" />
                <CardTitle>
                  {strategy.mode === "benchmarks" ? "Benchmark-Generated Rules" : "Custom Rules"}
                </CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeRuleCount} active rule{activeRuleCount !== 1 ? "s" : ""} · {totalThresholds} threshold{totalThresholds !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {strategy.mode === "benchmarks" && (
                <Button variant="outline" size="sm" onClick={regenerate}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate
                </Button>
              )}
              {strategy.mode === "custom" && (
                <Button variant="outline" size="sm" onClick={addCustomRule}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Rule
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {strategy.rules.map((rule, idx) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onUpdate={(r) => updateRule(idx, r)}
                onRemove={() => removeRule(idx)}
                isCustom={strategy.mode === "custom"}
                objective={objective}
              />
            ))}

            {strategy.rules.length === 0 && (
              <div className="rounded-lg border border-dashed border-border py-8 text-center">
                <p className="text-sm text-muted-foreground">No rules configured</p>
                {strategy.mode === "custom" && (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={addCustomRule}>
                    <Plus className="h-3.5 w-3.5" />
                    Add your first rule
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Budget Guardrails */}
      {strategy.mode !== "none" && strategy.guardrails && (
        <BudgetGuardrailsCard
          guardrails={strategy.guardrails}
          currency={currency}
          budgetAmount={budgetAmount}
          onChange={updateGuardrails}
        />
      )}

      {/* Summary readout */}
      {strategy.mode !== "none" && (strategy.rules.some((r) => r.enabled && r.thresholds.length > 0) || strategy.guardrails) && (
        <Card className="bg-surface">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Strategy Summary</CardTitle>
          </div>
          <div className="space-y-4">
            {/* Guardrails summary */}
            {strategy.guardrails && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                  Budget Guardrails
                </p>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span>Base budget: {currency === "GBP" ? "£" : currency}{strategy.guardrails.baseCampaignBudget.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-3.5 w-3.5 text-success" />
                    <span>Max expansion: {strategy.guardrails.maxExpansionPercent}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-warning" />
                    <span>Hard ceiling: {currency === "GBP" ? "£" : currency}{strategy.guardrails.hardBudgetCeiling.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>At ceiling: {CEILING_BEHAVIOUR_OPTIONS.find((o) => o.id === strategy.guardrails.ceilingBehaviour)?.label ?? strategy.guardrails.ceilingBehaviour}</span>
                  </div>
                  {strategy.guardrails.maxDailyIncreasePercent != null && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Max +{strategy.guardrails.maxDailyIncreasePercent}% per 24h cycle</span>
                    </div>
                  )}
                  {strategy.guardrails.cooldownHours != null && (
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{strategy.guardrails.cooldownHours}h cooldown between changes</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Objective metric priority */}
            {(() => {
              const prio = OBJECTIVE_METRIC_PRIORITY[objective];
              return (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">
                    Metric Priority
                  </p>
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="primary" className="text-[10px] uppercase tracking-wider shrink-0">Primary</Badge>
                      <span>{prio.primaryLabel}</span>
                    </div>
                    {prio.secondary && (
                      <div className="flex items-center gap-2">
                        <Badge variant="warning" className="text-[10px] uppercase tracking-wider shrink-0">Secondary</Badge>
                        <span>{prio.secondaryLabel}</span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">{prio.summaryLine}</p>
                  </div>
                </div>
              );
            })()}

            {/* Rules summary */}
            {strategy.rules
              .filter((r) => r.enabled && r.thresholds.length > 0)
              .map((rule) => {
                const isRoas = rule.metric === "roas";
                const sym = isRoas ? "" : "£";
                const suf = isRoas ? "×" : "";
                const abm = rule.accountBenchmarkValue ?? getAccountBenchmarkMedian(objective, rule.metric);
                const hasOverride = rule.useOverride && rule.campaignTargetValue != null;

                return (
                  <div key={rule.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      {rule.priority && (
                        <Badge variant={rule.priority === "primary" ? "primary" : "warning"} className="text-[10px] uppercase tracking-wider">
                          {rule.priority}
                        </Badge>
                      )}
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {rule.name} · {TIME_WINDOW_LABELS[rule.timeWindow]} window
                      </p>
                    </div>
                    {/* Benchmark vs target */}
                    {abm != null && (
                      <div className="flex items-center gap-3 mb-1.5 text-xs">
                        <span className="text-muted-foreground">Account: {sym}{abm}{suf}</span>
                        {hasOverride && (
                          <>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-warning font-medium">Campaign target: {sym}{rule.campaignTargetValue}{suf}</span>
                          </>
                        )}
                      </div>
                    )}
                    <div className="space-y-1">
                      {rule.thresholds.map((t) => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          {actionIcon(t.action)}
                          <span className="text-foreground">{t.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}
    </div>
  );
}
