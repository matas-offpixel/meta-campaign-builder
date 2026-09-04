"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface, useIsDrawer } from "@/components/steps/step-surface";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  describeTikTokAdGroupReconciliation,
  reconcileTikTokAdGroups,
} from "@/lib/tiktok-wizard/ad-group-reconcile";
import {
  assignTikTokCreativeToAllAdGroups,
  assignTikTokCreativesToAdGroup,
  assignTikTokEverything,
  clearTikTokAdGroupAssignments,
  clearTikTokCreativeFromAllAdGroups,
  clearTikTokEverything,
  pruneTikTokAssignments,
  toggleTikTokAssignment,
  type TikTokAssignmentMap,
} from "@/lib/tiktok-wizard/assign-creatives";
import {
  everyAdGroupHasCreative,
  everyCreativeAssigned,
} from "@/lib/tiktok-wizard/review";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function AssignCreativesStep({
  draft,
  onSave,
  surface = "wizard",
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  surface?: StepSurface;
}) {
  const [saving, setSaving] = useState(false);
  const [reconcileNotice, setReconcileNotice] = useState<string | null>(null);
  const reconciliation = useMemo(() => reconcileTikTokAdGroups(draft), [draft]);
  const adGroups = reconciliation.adGroups;
  const creativeIds = draft.creatives.items.map((creative) => creative.id);
  const adGroupIds = adGroups.map((adGroup) => adGroup.id);
  const reconciledSignature = adGroupIds.join("|");
  const persistedSignature = draft.budgetSchedule.adGroups
    .map((adGroup) => adGroup.id)
    .join("|");

  // Reconcile whenever the interest groups move, not once on mount. The two
  // signatures are the only inputs that can make this fire, and persisting the
  // reconciled list makes them equal, so this settles after one save.
  useEffect(() => {
    if (reconciledSignature === persistedSignature) return;
    const hadPersistedList = draft.budgetSchedule.adGroups.length > 0;
    const message = hadPersistedList
      ? describeTikTokAdGroupReconciliation(reconciliation)
      : null;
    const assignments = pruneTikTokAssignments(
      draft.creativeAssignments.byAdGroupId,
      adGroupIds,
    );
    void onSave({
      budgetSchedule: { ...draft.budgetSchedule, adGroups },
      ...(assignments.pruned
        ? { creativeAssignments: { byAdGroupId: assignments.byAdGroupId } }
        : {}),
    }).then(() => setReconcileNotice(message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconciledSignature, persistedSignature]);

  async function persistAssignments(byAdGroupId: TikTokAssignmentMap) {
    setSaving(true);
    try {
      await onSave({
        creativeAssignments: { byAdGroupId },
      });
    } finally {
      setSaving(false);
    }
  }

  async function persistAdGroupName(id: string, name: string) {
    await onSave({
      budgetSchedule: {
        ...draft.budgetSchedule,
        adGroups: adGroups.map((group) =>
          group.id === id ? { ...group, name } : group,
        ),
      },
    });
  }

  const current = draft.creativeAssignments.byAdGroupId;

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        
        {draft.creatives.items.length > 0 && adGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() =>
                void persistAssignments(
                  assignTikTokEverything(current, adGroupIds, creativeIds),
                )
              }
            >
              Assign everything
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() =>
                void persistAssignments(clearTikTokEverything(current, adGroupIds))
              }
            >
              Clear everything
            </Button>
          </div>
        )}
      </div>

      {reconcileNotice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <Datum>{reconcileNotice}</Datum>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setReconcileNotice(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

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
        <StatusLine tone="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Assign at least one creative to each ad group.
        </StatusLine>
      )}

      {draft.creatives.items.length === 0 ? (
        <StatusLine className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Add at least one creative in Step 4 before assigning.
        </StatusLine>
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
                      <AdGroupNameInput
                        value={adGroup.name}
                        disabled={saving}
                        onChange={(name) => void persistAdGroupName(adGroup.id, name)}
                      />
                      <span
                        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] normal-case tracking-normal ${
                          assignedCount === 0
                            ? "bg-red-500/20 text-red-700"
                            : "bg-background"
                        }`}
                      >
                        {assignedCount}
                      </span>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-normal normal-case tracking-normal">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void persistAssignments(
                              assignTikTokCreativesToAdGroup(
                                current,
                                adGroup.id,
                                creativeIds,
                              ),
                            )
                          }
                          className="text-primary hover:underline disabled:opacity-50"
                        >
                          Assign all
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() =>
                            void persistAssignments(
                              clearTikTokAdGroupAssignments(current, adGroup.id),
                            )
                          }
                          className="text-destructive hover:underline disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
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
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void persistAssignments(
                            assignTikTokCreativeToAllAdGroups(
                              current,
                              adGroupIds,
                              creative.id,
                            ),
                          )
                        }
                        className="text-primary hover:underline disabled:opacity-50"
                      >
                        Assign to all ad groups
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() =>
                          void persistAssignments(
                            clearTikTokCreativeFromAllAdGroups(
                              current,
                              adGroupIds,
                              creative.id,
                            ),
                          )
                        }
                        className="text-destructive hover:underline disabled:opacity-50"
                      >
                        Clear
                      </button>
                    </div>
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
                          onChange={() =>
                            void persistAssignments(
                              toggleTikTokAssignment(
                                current,
                                adGroup.id,
                                creative.id,
                              ),
                            )
                          }
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
        <Datum className="text-sm font-medium">Suggested ad groups</Datum>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {adGroups.map((adGroup) => (
            <div key={adGroup.id} className="rounded border border-border p-3 text-sm">
              <AdGroupNameInput
                value={adGroup.name}
                disabled={saving}
                onChange={(name) => void persistAdGroupName(adGroup.id, name)}
              />
              <Datum className="text-xs text-muted-foreground">
                Budget: {adGroup.budget == null ? "—" : `£${adGroup.budget}`}
              </Datum>
              <Datum className="text-xs text-muted-foreground">
                {draft.budgetSchedule.scheduleStartAt ?? "No start"} →{" "}
                {draft.budgetSchedule.scheduleEndAt ?? "No end"}
              </Datum>
            </div>
          ))}
        </div>
      </div>

      <Button type="button" variant="outline" disabled>
        Manual ad-group count coming soon
      </Button>
    </div>
      </StepSurfaceProvider>
  );
}

function AdGroupNameInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (name: string) => void;
}) {
  const blank = !value.trim();
  return (
    <div>
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        title="Click to rename this ad group"
        placeholder="Ad group name"
        aria-invalid={blank}
        className={`min-w-0 w-full truncate rounded border bg-transparent px-1 py-0.5 text-sm font-medium normal-case tracking-normal text-foreground hover:border-border focus:border-primary focus:bg-card focus:outline-none disabled:opacity-50 ${
          blank ? "border-red-500/50" : "border-transparent"
        }`}
      />
      {blank ? (
        <StatusLine tone="alert" className="mt-1 text-[10px] font-normal normal-case tracking-normal text-red-700">
          Name cannot be empty
        </StatusLine>
      ) : null}
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
