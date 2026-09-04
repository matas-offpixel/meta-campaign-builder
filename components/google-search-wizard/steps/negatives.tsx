"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface } from "@/components/steps/step-surface";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  addNegative,
  removeNegative,
  updateNegative,
} from "@/lib/google-search/tree-mutations";
import {
  MATCH_TYPES,
  type GoogleSearchMatchType,
  type GoogleSearchNegative,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";
import { isDerivedGoogleNote } from "@/lib/plan/derive/google";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";

interface Props {
  surface?: StepSurface;
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function NegativesStep({ surface = "wizard", tree, onChange }: Props) {
  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Shared negatives</CardTitle>
          <CardDescription>
            Plan-scoped: applied to every campaign in the plan. Add generic noise (free, jobs, dl,
            torrent, stream) here once.
          </CardDescription>
        </CardHeader>
        <NegativeTable
          rows={tree.plan_negatives}
          onPatch={(id, patch) => onChange(updateNegative(tree, id, patch))}
          onRemove={(id) => onChange(removeNegative(tree, id))}
          emptyText="No shared negatives yet."
          onAdd={() => onChange(addNegative(tree, { kind: "plan" }))}
        />
      </Card>

      <div className="space-y-2">
        {tree.campaigns.map((campaign) => (
          <div key={campaign.id} className="space-y-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange(addNegative(tree, { kind: "campaign", campaign_id: campaign.id }))
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add negative · {campaign.name || "(unnamed)"}
            </Button>
            {campaign.negatives.length > 0 ? (
              <NegativeTable
                rows={campaign.negatives}
                onPatch={(id, patch) => onChange(updateNegative(tree, id, patch))}
                onRemove={(id) => onChange(removeNegative(tree, id))}
                emptyText="No campaign-scoped negatives."
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
      </StepSurfaceProvider>
  );
}

function NegativeTable({
  rows,
  onPatch,
  onRemove,
  emptyText,
  onAdd,
}: {
  rows: GoogleSearchNegative[];
  onPatch: (id: string, patch: Partial<GoogleSearchNegative>) => void;
  onRemove: (id: string) => void;
  emptyText: string;
  onAdd?: () => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        {emptyText}
        {onAdd && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus className="h-3.5 w-3.5" />
              Add negative
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <table className="min-w-full text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1">Keyword</th>
            <th className="w-28 px-2 py-1">Match</th>
            <th className="w-10 px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id} className="border-t border-border align-middle">
              <td className="px-2 py-1">
                <div className="flex items-center gap-1">
                  <Input
                    aria-label="Negative keyword"
                    value={n.keyword}
                    onChange={(e) => onPatch(n.id, { keyword: e.target.value })}
                  />
                  {isDerivedGoogleNote(n.reason) ? (
                    <ProvenanceBadge provenance="derived" />
                  ) : null}
                </div>
              </td>
              <td className="px-2 py-1">
                <Select
                  aria-label="Negative match type"
                  value={n.match_type}
                  options={MATCH_TYPES.map((m) => ({ value: m, label: m }))}
                  onChange={(e) => onPatch(n.id, { match_type: e.target.value as GoogleSearchMatchType })}
                />
              </td>
              <td className="px-2 py-1 text-right">
                <Button variant="ghost" size="sm" onClick={() => onRemove(n.id)} aria-label="Remove">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {onAdd && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus className="h-3.5 w-3.5" />
            Add negative
          </Button>
        </div>
      )}
    </div>
  );
}
