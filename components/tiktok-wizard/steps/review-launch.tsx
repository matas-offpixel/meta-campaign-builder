"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TikTokLaunchPanel } from "@/components/tiktok-wizard/launch-panel";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import { buildTikTokAdsManagerUrl } from "@/lib/tiktok/ads-manager-url";
import {
  applyTikTokLaunchProgress,
  buildTikTokLaunchPanelModel,
  emptyTikTokLaunchProgress,
  type TikTokLaunchProgressView,
} from "@/lib/tiktok-wizard/launch-progress";
import {
  buildTikTokBriefFilename,
  buildTikTokBriefMarkdown,
} from "@/lib/tiktok-wizard/brief";
import {
  TIKTOK_BID_STRATEGY_LABELS,
  TIKTOK_OBJECTIVE_LABELS,
  tikTokOptimisationGoalLabel,
} from "@/lib/tiktok-wizard/campaign-setup";
import {
  buildTikTokPreflightChecks,
  suggestTikTokAdGroups,
  tikTokLaunchReviewSummary,
  tikTokReviewValidationChip,
} from "@/lib/tiktok-wizard/review";
import { tikTokTargetingWideningNotes } from "@/lib/tiktok-wizard/targeting-warnings";
import { filterClientResolvableTikTokPreflightIssues } from "@/lib/tiktok-wizard/migrate-draft";
import { TIKTOK_WRITES_DISABLED_REASON } from "@/lib/tiktok/write/feature-flag";
import {
  readTikTokLaunchStream,
  type TikTokLaunchStreamResultEvent,
} from "@/lib/tiktok/write/launch-stream";
import { collectTikTokLaunchPreflight } from "@/lib/tiktok/write/preflight";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";

type LaunchState =
  | { status: "idle" }
  | { status: "launching" }
  | {
      status: "success";
      campaignId: string;
      adgroupIds: string[];
      adIds: string[];
      launchedAt: string | null;
    }
  | {
      status: "error";
      message: string;
      preflight?: Array<{ id: string; field: string; message: string }>;
      tiktok?: { code?: number; message: string; request_id?: string };
    };

function launchStateFromDraft(draft: TikTokCampaignDraft): LaunchState {
  const published = draft.publishedIds;
  if (!published?.campaignId) return { status: "idle" };
  return {
    status: "success",
    campaignId: published.campaignId,
    adgroupIds: published.adgroupIds,
    adIds: published.adIds,
    launchedAt: published.launchedAt,
  };
}

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
  const [launch, setLaunch] = useState<LaunchState>(() =>
    launchStateFromDraft(draft),
  );
  const [progress, setProgress] = useState<TikTokLaunchProgressView>(
    emptyTikTokLaunchProgress(),
  );
  const bidStrategy =
    draft.optimisation.bidStrategy ?? draft.campaignSetup.bidStrategy;
  const checks = buildTikTokPreflightChecks(draft);
  const adGroups = suggestTikTokAdGroups(draft);
  const wideningNotes = tikTokTargetingWideningNotes(draft.audiences);
  const launchPreflight = collectTikTokLaunchPreflight(draft);
  const clientIssues = filterClientResolvableTikTokPreflightIssues(
    launchPreflight.issues,
    draft,
    context?.identityBcIdResolution ?? "idle",
  );
  const launchSummary = tikTokLaunchReviewSummary(clientIssues);
  const clientPreflightOk = launchSummary.ok;
  const writesEnabled = context?.writesEnabled === true;
  const writesDisabledReason =
    context?.writesDisabledReason ?? TIKTOK_WRITES_DISABLED_REASON;
  const launchDisabled =
    launch.status === "launching" ||
    !writesEnabled ||
    !launchSummary.ok;
  const validationChip = tikTokReviewValidationChip({
    launchDisabled,
    writesEnabled,
    writesDisabledReason,
    launching: launch.status === "launching",
    blockerCount: launchSummary.blockerCount,
  });
  const launchTitle = !writesEnabled
    ? writesDisabledReason
    : !launchSummary.ok
      ? clientIssues.map((issue) => issue.message).join(" · ")
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
    setProgress(emptyTikTokLaunchProgress());
    try {
      const res = await fetch("/api/tiktok/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      const collected: { result: TikTokLaunchStreamResultEvent | null } = {
        result: null,
      };
      await readTikTokLaunchStream(res, (event) => {
        if (event.type === "progress") {
          setProgress(applyTikTokLaunchProgress(event));
          return;
        }
        collected.result = event;
      });
      const body = collected.result?.body;
      if (!body || !body.ok) {
        setLaunch({
          status: "error",
          message: body && !body.ok ? body.error : "TikTok launch failed",
          preflight: body && !body.ok ? body.preflight : undefined,
          tiktok: body && !body.ok ? body.tiktok : undefined,
        });
        return;
      }
      const publishedIds = {
        campaignId: body.campaign_id,
        adgroupIds: body.adgroup_ids,
        adIds: body.ad_ids,
        launchedAt: body.launched_at,
      };
      await onSave({
        status: "published",
        publishedIds,
      });
      setLaunch({
        status: "success",
        ...publishedIds,
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
          validationChip.pass
            ? "bg-emerald-500/10 text-emerald-700"
            : "bg-red-500/10 text-red-700"
        }`}
      >
        Validation summary: {validationChip.message}
      </button>

      {validationOpen && (
        <div className="rounded-md border border-border bg-background p-4">
          <p className="text-sm font-medium">Launch blockers</p>
          {clientIssues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No launch blockers.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {clientIssues.map((issue) => (
                <li key={issue.id}>{issue.message}</li>
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

      {!clientPreflightOk && (
        <section className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-medium">Launch blockers</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {clientIssues.map((issue) => (
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
        <KeyValue
          label="Objective"
          value={
            draft.campaignSetup.objective
              ? TIKTOK_OBJECTIVE_LABELS[draft.campaignSetup.objective]
              : draft.campaignSetup.objective
          }
        />
        <KeyValue
          label="Optimisation goal"
          value={
            draft.campaignSetup.optimisationGoal
              ? tikTokOptimisationGoalLabel(
                  draft.campaignSetup.optimisationGoal,
                  draft.campaignSetup.objective,
                )
              : draft.campaignSetup.optimisationGoal
          }
        />
        {draft.campaignSetup.objective === "LEAD_GENERATION" && (
          <KeyValue
            label="Optimization location"
            value="Website (Instant Form not yet supported)"
          />
        )}
        <KeyValue
          label="Bid strategy"
          value={bidStrategy ? TIKTOK_BID_STRATEGY_LABELS[bidStrategy] : null}
          tone={bidStrategy ? "default" : "warning"}
          emptyWarning="Not set — launch will publish the ad group with no bid"
        />
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
        {wideningNotes.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-warning-foreground">
            {wideningNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
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
        <TikTokLaunchPanel
          model={buildTikTokLaunchPanelModel({
            status: launch.status,
            progress,
            campaignId:
              launch.status === "success" ? launch.campaignId : null,
            adGroupCount:
              launch.status === "success" ? launch.adgroupIds.length : null,
            adCount: launch.status === "success" ? launch.adIds.length : null,
            launchedAt:
              launch.status === "success" ? launch.launchedAt : null,
            adsManagerUrl: buildTikTokAdsManagerUrl(
              draft.accountSetup.advertiserId,
            ),
            errorMessage: launch.status === "error" ? launch.message : null,
            tiktok: launch.status === "error" ? launch.tiktok : null,
          })}
        />
      )}
      {launch.status === "error" &&
        launch.preflight &&
        launch.preflight.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-red-700">
            {launch.preflight.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        )}

      <div className="space-y-2">
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
        {!writesEnabled && (
          <p className="text-sm text-muted-foreground">
            TikTok launches are behind a killswitch that is intentionally off.
            Download as brief / Mark review ready are the available actions.
          </p>
        )}
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
  tone = "default",
  emptyWarning,
}: {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "warning";
  emptyWarning?: string;
}) {
  const display = value || (tone === "warning" ? (emptyWarning ?? "Not set") : "—");
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          tone === "warning"
            ? "text-right text-amber-700 dark:text-amber-300"
            : "text-right text-foreground"
        }
      >
        {display}
      </span>
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
