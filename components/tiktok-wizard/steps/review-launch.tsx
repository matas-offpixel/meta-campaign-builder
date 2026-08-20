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
import { buildTikTokWizardValidationIssues } from "@/lib/tiktok-wizard/validation";
import { TIKTOK_WRITES_DISABLED_REASON } from "@/lib/tiktok/write/feature-flag";
import { collectTikTokLaunchPreflight } from "@/lib/tiktok/write/preflight";
import type { TikTokLaunchEntity } from "@/lib/tiktok/write/types";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

type LaunchState =
  | { status: "idle" }
  | { status: "launching" }
  | {
      status: "success";
      entities: TikTokLaunchEntity[];
      campaignId: string;
    }
  | {
      status: "error";
      message: string;
      preflight?: Array<{ id: string; field: string; message: string }>;
    };

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
  const [validationOpen, setValidationOpen] = useState(false);
  const [launch, setLaunch] = useState<LaunchState>({ status: "idle" });
  const checks = buildTikTokPreflightChecks(draft);
  const adGroups = suggestTikTokAdGroups(draft);
  const validationIssues = buildTikTokWizardValidationIssues(draft, {
    eventEditPath: context?.eventEditPath,
  });
  const failingIssues = validationIssues.filter(
    (issue) => issue.severity === "error",
  );
  const launchPreflight = collectTikTokLaunchPreflight(draft);
  const writesEnabled = context?.writesEnabled === true;
  const writesDisabledReason =
    context?.writesDisabledReason ?? TIKTOK_WRITES_DISABLED_REASON;
  const launchDisabled =
    launch.status === "launching" ||
    !writesEnabled ||
    !launchPreflight.ok;
  const launchTitle = !writesEnabled
    ? writesDisabledReason
    : !launchPreflight.ok
      ? launchPreflight.issues.map((issue) => issue.message).join(" · ")
      : undefined;

  async function markReviewReady() {
    setSaving(true);
    try {
      await onSave({ reviewReadyAt: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }

  async function launchOnTikTok() {
    if (launchDisabled) return;
    setLaunch({ status: "launching" });
    try {
      const res = await fetch("/api/tiktok/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const json = (await res.json().catch(() => null)) as
        | {
            ok: true;
            campaign_id: string;
            entities: TikTokLaunchEntity[];
          }
        | {
            ok: false;
            error: string;
            preflight?: Array<{ id: string; field: string; message: string }>;
          }
        | null;
      if (!res.ok || !json?.ok) {
        setLaunch({
          status: "error",
          message:
            json && !json.ok ? json.error : "TikTok launch failed",
          preflight: json && !json.ok ? json.preflight : undefined,
        });
        return;
      }
      await onSave({
        status: "published",
        publishedIds: {
          campaignId: json.campaign_id,
          adgroupIds: json.entities
            .filter((entity) => entity.kind === "adgroup")
            .map((entity) => entity.id),
          adIds: json.entities
            .filter((entity) => entity.kind === "ad")
            .map((entity) => entity.id),
        },
      });
      setLaunch({
        status: "success",
        entities: json.entities,
        campaignId: json.campaign_id,
      });
    } catch (err) {
      setLaunch({
        status: "error",
        message: err instanceof Error ? err.message : "TikTok launch failed",
      });
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
          Review the full TikTok plan. This launcher never enables Smart+ or
          automated ads — campaigns are created paused so you can inspect them
          before spend starts.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setValidationOpen((open) => !open)}
        className={`rounded-full px-3 py-1 text-xs font-medium ${
          failingIssues.length > 0
            ? "bg-red-500/10 text-red-700"
            : "bg-emerald-500/10 text-emerald-700"
        }`}
      >
        Validation summary:{" "}
        {failingIssues.length > 0
          ? `${failingIssues.length} failing`
          : "all checks pass"}
      </button>

      {validationOpen && (
        <div className="rounded-md border border-border bg-background p-4">
          <p className="text-sm font-medium">Failing validation checks</p>
          {failingIssues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No failing validation checks.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {failingIssues.map((issue) => (
                <li key={issue.id}>
                  <a
                    className="font-medium underline"
                    href={`#tiktok-step-${issue.step}`}
                  >
                    Step {issue.step + 1}
                  </a>
                  : {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {!launchPreflight.ok && (
        <section className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-medium">Launch blockers</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {launchPreflight.issues.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      {launchPreflight.warnings.length > 0 && (
        <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-sm font-medium">Launch warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {launchPreflight.warnings.map((warning) => (
              <li key={warning.id}>{warning.message}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-lg">Creative Integrity Mode</h3>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            ALWAYS ON
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          This launcher always publishes ads exactly as uploaded. Every ad is
          created with <code>is_aco=false</code> and{" "}
          <code>creative_authorized=false</code> — no Smart+, no Smart
          Creative, no automated ads. Campaign, ad groups, and ads are all
          created paused.
        </p>
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
        <KeyValue
          label="Optimisation event"
          value={draft.accountSetup.optimisationEvent}
        />
        <KeyValue label="Currency" value={draft.accountSetup.currency} />
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

      {(launch.status === "launching" ||
        launch.status === "success" ||
        launch.status === "error") && (
        <section className="rounded-md border border-border bg-background p-4">
          <h3 className="font-heading text-lg">Launch progress</h3>
          {launch.status === "launching" && (
            <p className="mt-2 text-sm text-muted-foreground">
              Creating campaign → ad groups → ads…
            </p>
          )}
          {launch.status === "success" && (
            <ul className="mt-3 space-y-2 text-sm">
              {launch.entities.map((entity) => (
                <li key={`${entity.kind}-${entity.id}`}>
                  <span className="text-muted-foreground">{entity.kind}</span>{" "}
                  {entity.name} · {entity.id}
                </li>
              ))}
            </ul>
          )}
          {launch.status === "error" && (
            <div className="mt-2 space-y-2 text-sm">
              <p className="text-red-700">{launch.message}</p>
              {launch.preflight && launch.preflight.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {launch.preflight.map((issue) => (
                    <li key={issue.id}>{issue.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={launchDisabled}
          title={launchTitle}
          onClick={() => void launchOnTikTok()}
        >
          {launch.status === "launching" ? "Launching…" : "Launch on TikTok"}
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
        {draft.publishedIds
          ? ` Published TikTok campaign ${draft.publishedIds.campaignId}.`
          : ""}
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
