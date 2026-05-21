"use client";

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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
        <CardDescription>
          Review imported campaigns or add new ones. The push step prefixes [event_code] so the
          reporting matcher picks them up.
        </CardDescription>
      </CardHeader>

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
                <th className="w-32 p-3">Monthly £</th>
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
          aria-label={`Campaign ${index + 1} monthly budget`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={campaign.monthly_budget ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const num = raw === "" ? null : Number(raw);
            onPatch({ monthly_budget: Number.isFinite(num) ? (num as number | null) : null });
          }}
        />
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
