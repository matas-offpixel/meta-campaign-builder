"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { updateCampaign, updatePlan } from "@/lib/google-search/tree-mutations";
import type {
  GoogleSearchGeoTarget,
  GoogleSearchPlanTree,
} from "@/lib/google-search/types";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function TargetingBudgetStep({ tree, onChange }: Props) {
  const total = tree.plan.total_budget ?? 0;
  const allocated = tree.campaigns.reduce((s, c) => s + (c.monthly_budget ?? 0), 0);
  const remaining = total - allocated;

  function setGeo(next: GoogleSearchGeoTarget[]) {
    onChange(updatePlan(tree, { geo_targets: next }));
  }

  function addGeo() {
    setGeo([...tree.plan.geo_targets, { location: "United Kingdom", bid_modifier_pct: null }]);
  }
  function updateGeo(index: number, patch: Partial<GoogleSearchGeoTarget>) {
    setGeo(tree.plan.geo_targets.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }
  function removeGeo(index: number) {
    setGeo(tree.plan.geo_targets.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Geo targets</CardTitle>
          <CardDescription>
            Locations to target, with optional bid modifier (positive = boost, negative = damp).
          </CardDescription>
        </CardHeader>

        {tree.plan.geo_targets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            No geo targets — campaigns will use account defaults.
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={addGeo}>
                <Plus className="h-3.5 w-3.5" />
                Add geo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Location</th>
                  <th className="w-40 px-2 py-1">Bid modifier (%)</th>
                  <th className="w-10 px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {tree.plan.geo_targets.map((g, i) => (
                  <tr key={i} className="border-t border-border align-middle">
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Geo ${i + 1} location`}
                        value={g.location}
                        onChange={(e) => updateGeo(i, { location: e.target.value })}
                        placeholder="London, England, United Kingdom"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <Input
                        aria-label={`Geo ${i + 1} bid modifier`}
                        type="number"
                        step="1"
                        value={g.bid_modifier_pct ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const num = raw === "" ? null : Number(raw);
                          updateGeo(i, {
                            bid_modifier_pct: Number.isFinite(num) ? (num as number | null) : null,
                          });
                        }}
                        placeholder="+20"
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button variant="ghost" size="sm" onClick={() => removeGeo(i)} aria-label="Remove geo">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={addGeo}>
                <Plus className="h-3.5 w-3.5" />
                Add geo
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget allocation</CardTitle>
          <CardDescription>
            Total: £{total.toFixed(2)} • Allocated: £{allocated.toFixed(2)} • Remaining: £
            {remaining.toFixed(2)}
            {tree.plan.bidding_strategy === "maximize_clicks" && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                Maximise Clicks — no conversion tracking, budget pacing is best-effort
              </span>
            )}
          </CardDescription>
        </CardHeader>

        {tree.campaigns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No campaigns yet.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Campaign</th>
                <th className="w-40 px-2 py-1">Monthly £</th>
                <th className="w-40 px-2 py-1">Daily £ (optional)</th>
              </tr>
            </thead>
            <tbody>
              {tree.campaigns.map((c) => (
                <tr key={c.id} className="border-t border-border align-middle">
                  <td className="px-2 py-1 text-sm">{c.name || "(unnamed)"}</td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label={`Monthly budget for ${c.name}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      value={c.monthly_budget ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? null : Number(raw);
                        onChange(
                          updateCampaign(tree, c.id, {
                            monthly_budget: Number.isFinite(num) ? (num as number | null) : null,
                          }),
                        );
                      }}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      aria-label={`Daily budget for ${c.name}`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={0}
                      value={c.daily_budget ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = raw === "" ? null : Number(raw);
                        onChange(
                          updateCampaign(tree, c.id, {
                            daily_budget: Number.isFinite(num) ? (num as number | null) : null,
                          }),
                        );
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
