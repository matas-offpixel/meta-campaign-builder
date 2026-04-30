"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  everyAdGroupHasCreative,
  everyCreativeAssigned,
  suggestTikTokAdGroups,
} from "@/lib/tiktok-wizard/review";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function AssignCreativesStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const adGroups = suggestTikTokAdGroups(draft);

  useEffect(() => {
    if (draft.budgetSchedule.adGroups.length > 0) return;
    void onSave({
      budgetSchedule: {
        ...draft.budgetSchedule,
        adGroups,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(adGroupId: string, creativeId: string) {
    setSaving(true);
    const current = draft.creativeAssignments.byAdGroupId[adGroupId] ?? [];
    const next = current.includes(creativeId)
      ? current.filter((id) => id !== creativeId)
      : [...current, creativeId];
    try {
      await onSave({
        creativeAssignments: {
          byAdGroupId: {
            ...draft.creativeAssignments.byAdGroupId,
            [adGroupId]: next,
          },
        },
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Assign creatives</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Assign each creative to at least one suggested ad group. Every ad
          group must also have at least one creative before review.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge ok={everyCreativeAssigned(draft)}>
          {everyCreativeAssigned(draft) ? "Every creative assigned" : "Unassigned creatives"}
        </Badge>
        <Badge ok={everyAdGroupHasCreative(draft)}>
          {everyAdGroupHasCreative(draft)
            ? "Every ad group has creatives"
            : "Empty ad groups"}
        </Badge>
      </div>

      {draft.creatives.items.length > 0 && !everyAdGroupHasCreative(draft) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Assign at least one creative to each ad group.
        </p>
      )}

      {draft.creatives.items.length === 0 ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Add at least one creative in Step 4 before assigning.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3">Creative</th>
                {adGroups.map((adGroup) => {
                  const assignedCount = (
                    draft.creativeAssignments.byAdGroupId[adGroup.id] ?? []
                  ).length;
                  return (
                    <th
                      key={adGroup.id}
                      className={`p-3 ${
                        assignedCount === 0
                          ? "border-l border-red-500/40 bg-red-500/10"
                          : ""
                      }`}
                    >
                      {adGroup.name}
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${
                          assignedCount === 0
                            ? "bg-red-500/20 text-red-700"
                            : "bg-background"
                        }`}
                      >
                        {assignedCount}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {draft.creatives.items.map((creative) => (
                <tr key={creative.id} className="border-t border-border">
                  <td className="p-3">
                    <div className="font-medium">{creative.name}</div>
                    <div className="text-xs text-muted-foreground">{creative.videoId}</div>
                  </td>
                  {adGroups.map((adGroup) => {
                    const checked = (
                      draft.creativeAssignments.byAdGroupId[adGroup.id] ?? []
                    ).includes(creative.id);
                    return (
                      <td key={adGroup.id} className="p-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={() => void toggle(adGroup.id, creative.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border border-border bg-background p-4">
        <p className="text-sm font-medium">Suggested ad groups</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {adGroups.map((adGroup) => (
            <div key={adGroup.id} className="rounded border border-border p-3 text-sm">
              <p className="font-medium">{adGroup.name}</p>
              <p className="text-xs text-muted-foreground">
                Budget: {adGroup.budget == null ? "—" : `£${adGroup.budget}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {adGroup.startAt ?? "No start"} → {adGroup.endAt ?? "No end"}
              </p>
            </div>
          ))}
        </div>
      </div>

      <Button type="button" variant="outline" disabled>
        Manual ad-group count coming soon
      </Button>
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs ${
        ok ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"
      }`}
    >
      {children}
    </span>
  );
}
