"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  addCampaign,
  moveCampaign,
  removeCampaign,
  updateCampaign,
} from "@/lib/google-search/tree-mutations";
import type {
  GoogleSearchCampaignNode,
  GoogleSearchPlanTree,
} from "@/lib/google-search/types";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
  /** Quick deep link to the keywords step from each row. */
  onJumpToKeywords: () => void;
}

export function CampaignsStep({ tree, onChange, onJumpToKeywords }: Props) {
  // Google Ads campaign budgets are DAILY (the API expects amountMicros
  // on a daily basis). The xlsx import stores the plan's monthly
  // figure on `monthly_budget` for reference, but the push uses
  // `daily_budget`. The bulk-set input below lets the operator
  // populate every campaign's daily budget in one shot — common when
  // running a £1/day smoke test before going live.
  const [bulkDaily, setBulkDaily] = useState("");

  const applyBulkDaily = () => {
    const num = bulkDaily === "" ? null : Number(bulkDaily);
    if (num != null && !Number.isFinite(num)) return;
    let next = tree;
    for (const c of tree.campaigns) {
      next = updateCampaign(next, c.id, { daily_budget: num });
    }
    onChange(next);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
        <CardDescription>
          Review imported campaigns or add new ones. The push step prefixes [event_code] so the
          reporting matcher picks them up.
        </CardDescription>
      </CardHeader>

      {tree.campaigns.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="gs-bulk-daily">
              Set all daily budgets (£)
            </label>
            <Input
              id="gs-bulk-daily"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              value={bulkDaily}
              onChange={(e) => setBulkDaily(e.target.value)}
              placeholder="e.g. 1"
              className="w-28"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applyBulkDaily}
            disabled={bulkDaily === ""}
          >
            Apply to all
          </Button>
          <p className="text-xs text-muted-foreground">
            Google Ads budgets are <strong>daily</strong>. Use £1/day for a smoke test, then raise per campaign.
          </p>
        </div>
      ) : null}

      {tree.campaigns.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
          <div className="mt-3 flex justify-center">
            <Button onClick={() => onChange(addCampaign(tree))}>
              <Plus className="h-4 w-4" />
              Add campaign
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 p-3"></th>
                <th className="p-3">Name</th>
                <th className="w-32 p-3">Priority</th>
                <th className="w-32 p-3">Daily £</th>
                <th className="p-3">Notes</th>
                <th className="w-28 p-3">Ad groups</th>
                <th className="w-32 p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tree.campaigns.map((c, idx) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  index={idx}
                  total={tree.campaigns.length}
                  onPatch={(patch) => onChange(updateCampaign(tree, c.id, patch))}
                  onRemove={() => {
                    if (window.confirm(`Remove campaign "${c.name}" and its ${c.ad_groups.length} ad group(s)?`)) {
                      onChange(removeCampaign(tree, c.id));
                    }
                  }}
                  onMove={(dir) => onChange(moveCampaign(tree, c.id, dir))}
                  onOpenKeywords={onJumpToKeywords}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={() => onChange(addCampaign(tree))}>
          <Plus className="h-4 w-4" />
          Add campaign
        </Button>
      </div>
    </Card>
  );
}

function CampaignRow({
  campaign,
  index,
  total,
  onPatch,
  onRemove,
  onMove,
  onOpenKeywords,
}: {
  campaign: GoogleSearchCampaignNode;
  index: number;
  total: number;
  onPatch: (patch: Partial<GoogleSearchCampaignNode>) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onOpenKeywords: () => void;
}) {
  return (
    <tr className="border-t border-border align-top">
      <td className="p-2 align-middle">
        <div className="flex flex-col items-center gap-0.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            aria-label="Move up"
          >
            <ArrowUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            aria-label="Move down"
          >
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </td>
      <td className="p-2">
        <Input
          aria-label={`Campaign ${index + 1} name`}
          value={campaign.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="Campaign name"
        />
      </td>
      <td className="p-2">
        <Input
          aria-label={`Campaign ${index + 1} priority`}
          value={campaign.priority ?? ""}
          onChange={(e) => onPatch({ priority: e.target.value || null })}
          placeholder="MUST-RUN"
        />
      </td>
      <td className="p-2">
        <Input
          aria-label={`Campaign ${index + 1} daily budget`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={campaign.daily_budget ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const num = raw === "" ? null : Number(raw);
            onPatch({ daily_budget: Number.isFinite(num) ? (num as number | null) : null });
          }}
        />
        {campaign.monthly_budget != null && campaign.monthly_budget > 0 ? (
          <p className="mt-1 text-[10px] text-muted-foreground" title="Imported monthly figure from the plan — reference only, push uses daily.">
            plan: £{Math.round(campaign.monthly_budget)}/mo
          </p>
        ) : null}
      </td>
      <td className="p-2">
        <Input
          aria-label={`Campaign ${index + 1} notes`}
          value={campaign.notes ?? ""}
          onChange={(e) => onPatch({ notes: e.target.value || null })}
          placeholder="Optional"
        />
      </td>
      <td className="p-2 align-middle text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onOpenKeywords}
          className="rounded-md border border-border-strong bg-background px-2 py-1 text-xs hover:bg-muted"
        >
          {campaign.ad_groups.length} ad group{campaign.ad_groups.length === 1 ? "" : "s"}
        </button>
      </td>
      <td className="p-2 align-middle text-right">
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove campaign">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}
