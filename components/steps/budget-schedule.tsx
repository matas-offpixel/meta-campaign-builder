"use client";

import { useMemo } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DollarSign, Zap, Lightbulb } from "lucide-react";
import type {
  BudgetScheduleSettings,
  BudgetLevel,
  BudgetType,
  AdSetSuggestion,
  AudienceSettings,
} from "@/lib/types";
import { TIMEZONES } from "@/lib/mock-data";
import { suggestAgeRange } from "@/lib/interest-suggestions";

interface BudgetScheduleProps {
  budgetSchedule: BudgetScheduleSettings;
  adSetSuggestions: AdSetSuggestion[];
  audiences: AudienceSettings;
  onBudgetChange: (bs: BudgetScheduleSettings) => void;
  onSuggestionsChange: (suggestions: AdSetSuggestion[]) => void;
}

function generateSuggestions(audiences: AudienceSettings, budget: number): AdSetSuggestion[] {
  const suggestions: AdSetSuggestion[] = [];
  const age = suggestAgeRange(audiences);

  audiences.pageGroups.forEach((g) => {
    if (g.pageIds.length === 0) return;
    suggestions.push({
      id: `as_pg_${g.id}`,
      name: g.name || "Page Group",
      sourceType: "page_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.pageIds.length} pages)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: true,
      enabled: true,
    });
  });

  audiences.customAudienceGroups.forEach((g) => {
    if (g.audienceIds.length === 0) return;
    suggestions.push({
      id: `as_ca_${g.id}`,
      name: g.name || "Custom Audiences",
      sourceType: "custom_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.audienceIds.length} audiences)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: true,
      enabled: true,
    });
  });

  audiences.savedAudiences.audienceIds.forEach((id, i) => {
    suggestions.push({
      id: `as_sa_${id}`,
      name: `Saved Audience ${i + 1}`,
      sourceType: "saved_audience",
      sourceId: id,
      sourceName: id,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: true,
      enabled: true,
    });
  });

  audiences.interestGroups.forEach((g) => {
    if (g.interests.length === 0) return;
    suggestions.push({
      id: `as_ig_${g.id}`,
      name: g.name || "Interest Group",
      sourceType: "interest_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.interests.length} interests)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: true,
      enabled: true,
    });
  });

  // Distribute budget equally
  const enabled = suggestions.filter((s) => s.enabled);
  const perSet = enabled.length > 0 ? Math.round((budget / enabled.length) * 100) / 100 : 0;
  return suggestions.map((s) => ({ ...s, budgetPerDay: s.enabled ? perSet : 0 }));
}

export function BudgetSchedule({
  budgetSchedule: bs,
  adSetSuggestions,
  audiences,
  onBudgetChange,
  onSuggestionsChange,
}: BudgetScheduleProps) {
  const updateBs = (patch: Partial<BudgetScheduleSettings>) =>
    onBudgetChange({ ...bs, ...patch });

  const updateSuggestion = (id: string, patch: Partial<AdSetSuggestion>) =>
    onSuggestionsChange(adSetSuggestions.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const handleGenerate = () => {
    const next = generateSuggestions(audiences, bs.budgetAmount);
    onSuggestionsChange(next);
  };

  const distributeBudget = () => {
    const enabled = adSetSuggestions.filter((s) => s.enabled);
    if (enabled.length === 0) return;
    const perSet = Math.round((bs.budgetAmount / enabled.length) * 100) / 100;
    onSuggestionsChange(
      adSetSuggestions.map((s) => ({
        ...s,
        budgetPerDay: s.enabled ? perSet : 0,
      }))
    );
  };

  const enabledCount = adSetSuggestions.filter((s) => s.enabled).length;
  const totalDaily = adSetSuggestions
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + s.budgetPerDay, 0);

  const days = useMemo(() => {
    if (!bs.startDate || !bs.endDate) return 0;
    return Math.ceil(
      (new Date(bs.endDate).getTime() - new Date(bs.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
  }, [bs.startDate, bs.endDate]);

  const SOURCE_LABELS: Record<string, string> = {
    page_group: "page",
    custom_group: "custom",
    saved_audience: "saved",
    interest_group: "interest",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Budget & Schedule</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure spending, timing, and ad set structure.
        </p>
      </div>

      {/* Budget */}
      <Card>
        <CardTitle>Budget</CardTitle>
        <div className="mt-4 space-y-4">
          <div className="flex gap-2">
            {(["ad_set", "campaign"] as BudgetLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => updateBs({ budgetLevel: level })}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                  ${bs.budgetLevel === level ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
              >
                {level === "ad_set" ? "Ad Set Level" : "Campaign Level (CBO)"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["daily", "lifetime"] as BudgetType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => updateBs({ budgetType: type })}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                  ${bs.budgetType === type ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
              >
                {type === "daily" ? "Daily" : "Lifetime"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={`${bs.budgetType === "daily" ? "Daily" : "Lifetime"} Budget (${bs.currency})`}
              type="number"
              value={bs.budgetAmount}
              onChange={(e) => updateBs({ budgetAmount: Number(e.target.value) })}
              min={1}
            />
            <Select
              label="Timezone"
              value={bs.timezone}
              onChange={(e) => updateBs({ timezone: e.target.value })}
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            />
          </div>
        </div>
      </Card>

      {/* Schedule */}
      <Card>
        <CardTitle>Schedule</CardTitle>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Input
            label="Start Date & Time"
            type="datetime-local"
            value={bs.startDate}
            onChange={(e) => updateBs({ startDate: e.target.value })}
          />
          <Input
            label="End Date & Time"
            type="datetime-local"
            value={bs.endDate}
            onChange={(e) => updateBs({ endDate: e.target.value })}
          />
        </div>
        {days > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Duration: <span className="font-medium text-foreground">{days} days</span>
            {bs.budgetType === "daily" && (
              <> · Total estimated spend: <span className="font-medium text-foreground">{bs.currency} {(bs.budgetAmount * days).toFixed(2)}</span></>
            )}
          </p>
        )}
      </Card>

      {/* Suggested age hint */}
      {(() => {
        const age = suggestAgeRange(audiences);
        const hasPages = audiences.pageGroups.some((g) => g.pageIds.length > 0);
        if (!hasPages) return null;
        return (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary-light px-4 py-2.5">
            <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-foreground">
              Suggested age range: <span className="font-semibold">{age.min}–{age.max}</span>
              <span className="text-muted-foreground"> (based on your page audiences)</span>
            </span>
          </div>
        );
      })()}

      {/* Ad Set Suggestions */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ad Set Suggestions</CardTitle>
            <CardDescription>Generated from your audiences. Fine-tune each ad set.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={distributeBudget} disabled={enabledCount === 0}>
              <DollarSign className="h-3.5 w-3.5" />
              Distribute Budget
            </Button>
            <Button size="sm" onClick={handleGenerate}>
              <Zap className="h-3.5 w-3.5" />
              Generate Suggestions
            </Button>
          </div>
        </div>

        {adSetSuggestions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate Suggestions&quot; to create ad sets from your audiences.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active: {enabledCount}/{adSetSuggestions.length}</span>
              <span>
                Daily Total: <span className="font-medium text-foreground">{bs.currency} {totalDaily.toFixed(2)}</span>
                {days > 0 && <> · Total Spend ({days}d): <span className="font-medium text-foreground">{bs.currency} {(totalDaily * days).toFixed(2)}</span></>}
              </span>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              {adSetSuggestions.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0
                    ${s.enabled ? "" : "opacity-50"}`}
                >
                  <Checkbox
                    checked={s.enabled}
                    onChange={() => updateSuggestion(s.id, { enabled: !s.enabled })}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {SOURCE_LABELS[s.sourceType] || s.sourceType}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground truncate block">{s.sourceName}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={s.ageMin}
                        onChange={(e) => updateSuggestion(s.id, { ageMin: Number(e.target.value) })}
                        className="w-12 rounded border border-border px-1.5 py-1 text-center text-xs"
                        min={13}
                        max={65}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <input
                        type="number"
                        value={s.ageMax}
                        onChange={(e) => updateSuggestion(s.id, { ageMax: Number(e.target.value) })}
                        className="w-12 rounded border border-border px-1.5 py-1 text-center text-xs"
                        min={13}
                        max={65}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{bs.currency}</span>
                      <input
                        type="number"
                        value={s.budgetPerDay}
                        onChange={(e) => updateSuggestion(s.id, { budgetPerDay: Number(e.target.value) })}
                        className="w-16 rounded border border-border px-1.5 py-1 text-center text-xs"
                        min={0}
                        step={0.01}
                      />
                      <span className="text-xs text-muted-foreground">/day</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSuggestion(s.id, { advantagePlus: !s.advantagePlus })}
                      className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors
                        ${s.advantagePlus ? "border-primary bg-primary-light text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                    >
                      Advantage+
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
