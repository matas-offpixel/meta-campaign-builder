"use client";

import { useMemo } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import type { AdSetSuggestion, AdCreativeDraft, CreativeAssignmentMatrix } from "@/lib/types";
import { ATTACHED_AD_SET_ID } from "@/lib/types";

interface AssignCreativesProps {
  adSets: AdSetSuggestion[];
  creatives: AdCreativeDraft[];
  assignments: CreativeAssignmentMatrix;
  onChange: (assignments: CreativeAssignmentMatrix) => void;
}

export function AssignCreatives({ adSets, creatives, assignments, onChange }: AssignCreativesProps) {
  const enabledSets = useMemo(() => adSets.filter((s) => s.enabled), [adSets]);

  const isAssigned = (adSetId: string, creativeId: string) =>
    (assignments[adSetId] || []).includes(creativeId);

  const toggle = (adSetId: string, creativeId: string) => {
    const current = assignments[adSetId] || [];
    const next = current.includes(creativeId)
      ? current.filter((id) => id !== creativeId)
      : [...current, creativeId];
    onChange({ ...assignments, [adSetId]: next });
  };

  const assignAll = () => {
    const next: CreativeAssignmentMatrix = {};
    enabledSets.forEach((s) => {
      next[s.id] = creatives.map((c) => c.id);
    });
    onChange(next);
  };

  const clearAll = () => {
    const next: CreativeAssignmentMatrix = {};
    enabledSets.forEach((s) => {
      next[s.id] = [];
    });
    onChange(next);
  };

  const assignColumnAll = (creativeId: string) => {
    const next = { ...assignments };
    enabledSets.forEach((s) => {
      const current = next[s.id] || [];
      if (!current.includes(creativeId)) {
        next[s.id] = [...current, creativeId];
      }
    });
    onChange(next);
  };

  const removeColumnAll = (creativeId: string) => {
    const next = { ...assignments };
    enabledSets.forEach((s) => {
      next[s.id] = (next[s.id] || []).filter((id) => id !== creativeId);
    });
    onChange(next);
  };

  const totalAds = useMemo(() => {
    return Object.values(assignments).reduce((sum, ids) => sum + ids.length, 0);
  }, [assignments]);

  if (enabledSets.length === 0 || creatives.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Assign Creatives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Mix and match creatives with ad sets before launch.
          </p>
        </div>
        <Card className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {creatives.length === 0
              ? "Add creatives first, then assign them to ad sets."
              : "Generate and enable ad sets in Budget & Schedule first."}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl tracking-wide">Assign Creatives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {enabledSets.length === 1 && enabledSets[0].id === ATTACHED_AD_SET_ID
              ? "Tick the creatives you want to add as new ads to the existing ad set."
              : "Choose which creatives run in each ad set."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={assignAll}>Assign All</Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear All</Button>
        </div>
      </div>

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ad Set</th>
              {creatives.map((c, i) => (
                <th key={c.id} className="px-3 py-3 text-center min-w-[120px]">
                  <div className="text-xs font-semibold">{c.name || `Ad #${i + 1}`}</div>
                  <div className="mt-1 flex justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => assignColumnAll(c.id)}
                      className="text-[10px] text-primary hover:underline"
                    >
                      All
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button
                      type="button"
                      onClick={() => removeColumnAll(c.id)}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      None
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enabledSets.map((adSet) => (
              <tr key={adSet.id} className="border-b border-border last:border-b-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{adSet.name}</span>
                    {adSet.id === ATTACHED_AD_SET_ID ? (
                      <Badge variant="primary" className="text-[10px]">existing ad set</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">{adSet.sourceType.replace("_", " ")}</Badge>
                    )}
                  </div>
                </td>
                {creatives.map((c) => {
                  const assigned = isAssigned(adSet.id, c.id);
                  return (
                    <td key={c.id} className="px-3 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => toggle(adSet.id, c.id)}
                        className={`mx-auto flex h-8 w-8 items-center justify-center rounded-md transition-colors
                          ${assigned ? "bg-foreground text-background" : "border border-border-strong hover:bg-card"}`}
                      >
                        {assigned && <Check className="h-4 w-4" strokeWidth={3} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-3">
        <span className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{totalAds} ads</span> will be created
        </span>
        <span className="text-sm text-muted-foreground">
          {creatives.length} creative{creatives.length !== 1 ? "s" : ""} × {enabledSets.length} ad set{enabledSets.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
