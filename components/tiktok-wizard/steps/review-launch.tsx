"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import {
  buildTikTokBriefFilename,
  buildTikTokBriefMarkdown,
} from "@/lib/tiktok-wizard/brief";
import {
  buildTikTokPreflightChecks,
  suggestTikTokAdGroups,
} from "@/lib/tiktok-wizard/review";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

export function ReviewLaunchStep({
  draft,
  onSave,
  context,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  context?: TikTokWizardContext;
}) {
  const [saving, setSaving] = useState(false);
  const checks = buildTikTokPreflightChecks(draft);
  const adGroups = suggestTikTokAdGroups(draft);

  async function markReviewReady() {
    setSaving(true);
    try {
      await onSave({ reviewReadyAt: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }

  function downloadBrief() {
    const markdown = buildTikTokBriefMarkdown(draft, context);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildTikTokBriefFilename(draft);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Review & launch</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Review the full TikTok plan. Launch writes are disabled until the
          TikTok write API is enabled.
        </p>
      </div>

      <section className="grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.id}
            className={`rounded-md border p-3 ${
              check.severity === "green"
                ? "border-emerald-500/30 bg-emerald-500/10"
                : "border-red-500/30 bg-red-500/10"
            }`}
          >
            <p className="text-sm font-medium">{check.label}</p>
            <p className="text-xs text-muted-foreground">{check.detail}</p>
          </div>
        ))}
      </section>

      <ReviewPanel title="Account">
        <KeyValue label="Advertiser" value={draft.accountSetup.advertiserId} />
        <KeyValue
          label="Identity"
          value={
            draft.accountSetup.identityDisplayName ??
            draft.accountSetup.identityManualName
          }
        />
        <KeyValue
          label="Pixel"
          value={draft.accountSetup.pixelName ?? draft.accountSetup.pixelId}
        />
      </ReviewPanel>

      <ReviewPanel title="Campaign">
        <KeyValue label="Name" value={draft.campaignSetup.campaignName} />
        <KeyValue label="Objective" value={draft.campaignSetup.objective} />
        <KeyValue
          label="Optimisation goal"
          value={draft.campaignSetup.optimisationGoal}
        />
        <KeyValue label="Bid strategy" value={draft.campaignSetup.bidStrategy} />
      </ReviewPanel>

      <ReviewPanel title="Optimisation">
        <KeyValue
          label="Smart+"
          value={draft.optimisation.smartPlusEnabled ? "On" : "Off"}
        />
        <KeyValue label="Pacing" value={draft.optimisation.pacing} />
        <KeyValue
          label="Guardrails"
          value={[
            draft.optimisation.maxDailySpend == null
              ? null
              : `Daily £${draft.optimisation.maxDailySpend}`,
            draft.optimisation.maxLifetimeSpend == null
              ? null
              : `Lifetime £${draft.optimisation.maxLifetimeSpend}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </ReviewPanel>

      <ReviewPanel title="Audiences">
        <ChipList
          values={[
            ...Object.values(draft.audiences.interestCategoryLabels),
            ...Object.values(draft.audiences.behaviourCategoryLabels),
            ...Object.values(draft.audiences.customAudienceLabels),
            ...Object.values(draft.audiences.lookalikeAudienceLabels),
            ...draft.audiences.locationCodes,
            ...draft.audiences.genders,
            ...draft.audiences.languages,
          ]}
        />
      </ReviewPanel>

      <ReviewPanel title="Creatives">
        <div className="space-y-2">
          {draft.creatives.items.map((creative) => (
            <div key={creative.id} className="rounded border border-border p-3">
              <p className="font-medium">{creative.name}</p>
              <p className="text-xs text-muted-foreground">{creative.adText}</p>
              <p className="text-xs text-muted-foreground">
                {creative.displayName} · {creative.landingPageUrl || "No landing page"} ·{" "}
                {creative.cta ?? "No CTA"}
              </p>
            </div>
          ))}
          {draft.creatives.items.length === 0 && <Empty />}
        </div>
      </ReviewPanel>

      <ReviewPanel title="Budget">
        <KeyValue label="Mode" value={draft.budgetSchedule.budgetMode} />
        <KeyValue
          label="Amount"
          value={
            draft.budgetSchedule.budgetAmount == null
              ? null
              : `£${draft.budgetSchedule.budgetAmount}`
          }
        />
        <KeyValue
          label="Schedule"
          value={`${draft.budgetSchedule.scheduleStartAt ?? "—"} → ${
            draft.budgetSchedule.scheduleEndAt ?? "—"
          }`}
        />
        <KeyValue
          label="Frequency cap"
          value={
            draft.budgetSchedule.frequencyCap == null
              ? null
              : String(draft.budgetSchedule.frequencyCap)
          }
        />
      </ReviewPanel>

      <ReviewPanel title="Assignments">
        <div className="space-y-2">
          {adGroups.map((adGroup) => (
            <div key={adGroup.id} className="rounded border border-border p-3">
              <p className="font-medium">{adGroup.name}</p>
              <p className="text-xs text-muted-foreground">
                {(draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [])
                  .map((id) => draft.creatives.items.find((item) => item.id === id)?.name ?? id)
                  .join(", ") || "No creatives assigned"}
              </p>
            </div>
          ))}
        </div>
      </ReviewPanel>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled
          title="TikTok writes coming soon — this draft is saved and will be launchable when the writes API is enabled."
        >
          Launch on TikTok
        </Button>
        <Button type="button" variant="outline" onClick={downloadBrief}>
          Download as brief (Markdown)
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => void markReviewReady()}
        >
          Mark review ready
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {draft.reviewReadyAt
          ? `Marked review ready at ${draft.reviewReadyAt}.`
          : "Review-ready state is stored inside the draft JSON; no status migration required."}
      </p>
    </div>
  );
}

function ReviewPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4">
      <h3 className="font-heading text-lg">{title}</h3>
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function KeyValue({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value || "—"}</span>
    </div>
  );
}

function ChipList({ values }: { values: string[] }) {
  if (values.length === 0) return <Empty />;
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((value) => (
        <span key={value} className="rounded-full bg-muted px-3 py-1 text-xs">
          {value}
        </span>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">—</p>;
}
