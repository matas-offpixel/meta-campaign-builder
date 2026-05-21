"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

export function NegativesStep({ tree, onChange }: Props) {
  return (
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

      <Card>
        <CardHeader>
          <CardTitle>Campaign overrides</CardTitle>
          <CardDescription>
            Per-campaign negatives — for blocking sister-campaign brand terms or campaign-specific
            noise.
          </CardDescription>
        </CardHeader>

        {tree.campaigns.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add a campaign in step 2 before defining overrides.</p>
        ) : (
          <div className="space-y-4">
            {tree.campaigns.map((campaign) => (
              <section
                key={campaign.id}
                className="rounded-md border border-border bg-background p-3"
              >
                <header className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">{campaign.name || "(unnamed)"}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange(addNegative(tree, { kind: "campaign", campaign_id: campaign.id }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add negative
                  </Button>
                </header>
                <NegativeTable
                  rows={campaign.negatives}
                  onPatch={(id, patch) => onChange(updateNegative(tree, id, patch))}
                  onRemove={(id) => onChange(removeNegative(tree, id))}
                  emptyText="No campaign-scoped negatives."
                />
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
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
            <th className="px-2 py-1">Reason</th>
            <th className="w-10 px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id} className="border-t border-border align-middle">
              <td className="px-2 py-1">
                <Input
                  aria-label="Negative keyword"
                  value={n.keyword}
                  onChange={(e) => onPatch(n.id, { keyword: e.target.value })}
                />
              </td>
              <td className="px-2 py-1">
                <Select
                  aria-label="Negative match type"
                  value={n.match_type}
                  options={MATCH_TYPES.map((m) => ({ value: m, label: m }))}
                  onChange={(e) => onPatch(n.id, { match_type: e.target.value as GoogleSearchMatchType })}
                />
              </td>
              <td className="px-2 py-1">
                <Input
                  aria-label="Negative reason"
                  value={n.reason ?? ""}
                  onChange={(e) => onPatch(n.id, { reason: e.target.value || null })}
                  placeholder="e.g. noise / cannibalisation"
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
