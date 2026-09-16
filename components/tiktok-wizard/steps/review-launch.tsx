"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface, useIsDrawer } from "@/components/steps/step-surface";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TikTokLaunchPanel } from "@/components/tiktok-wizard/launch-panel";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import { duplicateTikTokDraft } from "@/lib/db/tiktok-drafts";
import { createClient } from "@/lib/supabase/client";
import { buildTikTokAdsManagerUrl } from "@/lib/tiktok/ads-manager-url";
import {
  applyTikTokLaunchProgress,
  buildTikTokLaunchPanelModel,
  emptyTikTokLaunchProgress,
  type TikTokLaunchProgressView,
} from "@/lib/tiktok-wizard/launch-progress";
import {
  isTikTokLaunchPaused,
  tikTokLaunchButtonLabel,
  tikTokLaunchConfirmMessage,
  tikTokLaunchLiveSuccessDescription,
  tikTokLaunchPausedSuccessDescription,
  tikTokLaunchWasDeliveredPaused,
} from "@/lib/tiktok-wizard/launch-live";
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
import { buildTikTokWizardValidationIssues } from "@/lib/tiktok-wizard/validation";
import { tikTokTargetingWideningNotes } from "@/lib/tiktok-wizard/targeting-warnings";
import { filterClientResolvableTikTokPreflightIssues } from "@/lib/tiktok-wizard/migrate-draft";
import { TIKTOK_WRITES_DISABLED_REASON } from "@/lib/tiktok/write/feature-flag";
import {
  readTikTokLaunchStream,
  type TikTokLaunchStreamResultEvent,
} from "@/lib/tiktok/write/launch-stream";
import { tikTokAdvertiserClockLabel } from "@/lib/plan/tiktok-early";
import {
  reviewScheduleFieldDisabled,
  shouldPersistReviewSchedule,
} from "@/lib/tiktok-wizard/review-schedule";
import {
  collectTikTokLaunchPreflight,
  type TikTokLaunchPreflightIssue,
} from "@/lib/tiktok/write/preflight";
import type {
  TikTokAdGroupDraft,
  TikTokCampaignDraft,
} from "@/lib/types/tiktok-draft";
import { formatTikTokImportEnhancementLine } from "@/lib/tiktok/import/types";

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
  surface = "wizard",
  onOpenStep,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  context?: TikTokWizardContext;
  surface?: StepSurface;
  onOpenStep?: (step: number) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState<string | null>(null);
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
  const wizardIssues = buildTikTokWizardValidationIssues(draft, {
    eventEditPath: context?.eventEditPath ?? null,
  });
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
  const alreadyLaunched = Boolean(draft.publishedIds?.campaignId);
  const [launchPaused, setLaunchPaused] = useState(() =>
    isTikTokLaunchPaused(draft),
  );
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
    alreadyLaunched,
  });
  const launchTitle =
    launch.status === "launching"
      ? undefined
      : !launchSummary.ok
        ? "Resolve the launch blockers above"
        : !writesEnabled
          ? writesDisabledReason
          : undefined;
  const firstLaunchBlocker = clientIssues[0]?.message;
  const scheduleStartIssue = clientIssues.find(
    (issue) => issue.id === "schedule-start-soon",
  );
  const scheduleOrderIssue = clientIssues.find(
    (issue) => issue.id === "schedule-order",
  );
  const smartPlus = draft.optimisation.smartPlusEnabled;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [startDraft, setStartDraft] = useState(
    draft.budgetSchedule.scheduleStartAt ?? "",
  );
  const [endDraft, setEndDraft] = useState(
    draft.budgetSchedule.scheduleEndAt ?? "",
  );
  const scheduleDisabled = reviewScheduleFieldDisabled({
    alreadyLaunched,
    smartPlus,
  });

  async function persistSchedule(
    patch: Partial<TikTokCampaignDraft["budgetSchedule"]>,
  ) {
    await onSave({
      budgetSchedule: {
        ...draftRef.current.budgetSchedule,
        ...patch,
      },
    });
  }

  async function relaunchAsNewDraft() {
    if (relaunching) return;
    setRelaunching(true);
    setRelaunchError(null);
    try {
      await context?.flushPendingSaves?.();
      const source = context?.readWorkingDraft?.() ?? draft;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRelaunchError("Not signed in");
        setRelaunching(false);
        return;
      }
      const copy = await duplicateTikTokDraft(
        supabase,
        source.id,
        user.id,
        source,
      );
      if (!copy) {
        setRelaunchError("Could not duplicate this draft");
        setRelaunching(false);
        return;
      }
      router.push(`/tiktok-campaign/${copy.id}`);
    } catch (err) {
      setRelaunchError(
        err instanceof Error ? err.message : "Could not duplicate this draft",
      );
      setRelaunching(false);
    }
  }

  async function markReviewReady() {
    setSaving(true);
    try {
      await onSave({ reviewReadyAt: new Date().toISOString() });
    } finally {
      setSaving(false);
    }
  }

  const launchConfirmMessage = tikTokLaunchConfirmMessage(
    { ...draft, launchPaused },
    { advertiserName: context?.advertiserName },
  );

  async function persistLaunchPaused(paused: boolean) {
    setLaunchPaused(paused);
    await onSave({ launchPaused: paused });
  }

  async function launchOnTikTok() {
    if (launchDisabled) return;
    if (!window.confirm(launchConfirmMessage)) return;
    const paused = launchPaused;
    setLaunch({ status: "launching" });
    setProgress(emptyTikTokLaunchProgress());
    try {
      const res = await fetch("/api/tiktok/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, launchPaused: paused }),
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
        launchPaused: paused,
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
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-6">
      

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
        <div className="space-y-4 rounded-md border border-border bg-background p-4">
          {!alreadyLaunched && (
          <div>
            <Datum className="text-sm font-medium">Launch blockers</Datum>
            {clientIssues.length === 0 ? (
              <Datum className="mt-2 text-sm text-muted-foreground">
                No launch blockers.
              </Datum>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {clientIssues.map((issue) => (
                  <li key={issue.id}>
                    {formatPreflightIssue(issue, draft, adGroups)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
          {!alreadyLaunched && (
          <div>
            <Datum className="text-sm font-medium">Wizard validation</Datum>
            
            {wizardIssues.length === 0 ? (
              <Datum className="mt-2 text-sm text-muted-foreground">
                No wizard validation issues.
              </Datum>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {wizardIssues.map((issue) => (
                  <li key={issue.id}>
                    {onOpenStep ? (
                      <button
                        type="button"
                        className="text-left underline-offset-2 hover:underline"
                        onClick={() => onOpenStep(issue.step)}
                      >
                        {issue.label}: {issue.message}
                      </button>
                    ) : (
                      <>
                        {issue.label}: {issue.message}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
        </div>
      )}

      {!alreadyLaunched && (
      <section className="space-y-3">
        <div>
          <Datum className="text-sm font-medium">
            Wizard checks (not launch blockers)
          </Datum>
          <Datum className="mt-1 text-xs text-muted-foreground">
            Informational wizard cards. They do not disable Launch.
          </Datum>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {checks.map((check) => (
            <div
              key={check.id}
              className={`rounded-md border p-3 ${
                check.severity === "green"
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-red-500/30 bg-red-500/10"
              }`}
            >
              <Datum className="text-sm font-medium">{check.label}</Datum>
              <Datum className="text-xs text-muted-foreground">{check.detail}</Datum>
            </div>
          ))}
        </div>
      </section>
      )}

      {!alreadyLaunched && wizardIssues.length > 0 && (
        <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
          <Datum className="text-sm font-medium">Wizard validation</Datum>
          
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {wizardIssues.map((issue) => (
              <li key={issue.id}>
                {onOpenStep ? (
                  <button
                    type="button"
                    className="text-left underline-offset-2 hover:underline"
                    onClick={() => onOpenStep(issue.step)}
                  >
                    {issue.label}: {issue.message}
                  </button>
                ) : (
                  <>
                    {issue.label}: {issue.message}
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!alreadyLaunched && !clientPreflightOk && (
        <section className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <Datum className="text-sm font-medium">Launch blockers</Datum>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {clientIssues.map((issue) => (
              <li key={issue.id}>
                {formatPreflightIssue(issue, draft, adGroups)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!alreadyLaunched && launchPreflight.warnings.length > 0 && (
        <section className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
          <Datum className="text-sm font-medium">Launch warnings</Datum>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {launchPreflight.warnings.map((warning) => (
              <li key={warning.id}>{warning.message}</li>
            ))}
          </ul>
        </section>
      )}

      {draft.importMeta && (
        <section className="space-y-2 rounded-md border border-border bg-background p-4">
          <Datum className="text-sm">
            {formatTikTokImportEnhancementLine(draft.importMeta)}
          </Datum>
          <Datum className="text-xs text-muted-foreground">
            The source campaign is not touched. Pause it in Ads Manager when you
            are ready. Launch creates a new paused campaign through the
            existing writer.
          </Datum>
        </section>
      )}

      <section className="rounded-md border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-heading text-lg">Creative Integrity Mode</h3>
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            ALWAYS ON
          </span>
        </div>
        
      </section>

      <ReviewPanel title="Account" onOpen={onOpenStep ? () => onOpenStep(0) : undefined}>
        <KeyValue
          label="Advertiser"
          value={draft.accountSetup.advertiserId}
          onEdit={onOpenStep ? () => onOpenStep(0) : undefined}
        />
        <KeyValue
          label="Identity"
          value={
            draft.accountSetup.identityDisplayName ??
            draft.accountSetup.identityManualName
          }
          onEdit={onOpenStep ? () => onOpenStep(0) : undefined}
        />
        <KeyValue
          label="Pixel"
          value={draft.accountSetup.pixelName ?? draft.accountSetup.pixelId}
          onEdit={onOpenStep ? () => onOpenStep(0) : undefined}
        />
        <KeyValue
          label="Optimisation event"
          value={draft.accountSetup.optimisationEvent}
          onEdit={onOpenStep ? () => onOpenStep(0) : undefined}
        />
        <KeyValue
          label="Currency"
          value={draft.accountSetup.currency}
          onEdit={onOpenStep ? () => onOpenStep(0) : undefined}
        />
      </ReviewPanel>

      <ReviewPanel title="Campaign" onOpen={onOpenStep ? () => onOpenStep(1) : undefined}>
        <KeyValue
          label="Name"
          value={draft.campaignSetup.campaignName}
          onEdit={onOpenStep ? () => onOpenStep(1) : undefined}
        />
        <KeyValue
          label="Objective"
          value={
            draft.campaignSetup.objective
              ? TIKTOK_OBJECTIVE_LABELS[draft.campaignSetup.objective]
              : draft.campaignSetup.objective
          }
          onEdit={onOpenStep ? () => onOpenStep(1) : undefined}
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
          onEdit={onOpenStep ? () => onOpenStep(1) : undefined}
        />
        {draft.campaignSetup.objective === "LEAD_GENERATION" && (
          <KeyValue
            label="Optimization location"
            value="Website (Instant Form not yet supported)"
            onEdit={onOpenStep ? () => onOpenStep(1) : undefined}
          />
        )}
        <KeyValue
          label="Bid strategy"
          value={bidStrategy ? TIKTOK_BID_STRATEGY_LABELS[bidStrategy] : null}
          tone={bidStrategy ? "default" : "warning"}
          emptyWarning="Not set — launch will publish the ad group with no bid"
          onEdit={onOpenStep ? () => onOpenStep(1) : undefined}
        />
      </ReviewPanel>

      <ReviewPanel title="Optimisation" onOpen={onOpenStep ? () => onOpenStep(2) : undefined}>
        <KeyValue
          label="Smart+"
          value={draft.optimisation.smartPlusEnabled ? "On" : "Off"}
          onEdit={onOpenStep ? () => onOpenStep(2) : undefined}
        />
        <KeyValue
          label="Pacing"
          value={draft.optimisation.pacing}
          onEdit={onOpenStep ? () => onOpenStep(2) : undefined}
        />
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
          onEdit={onOpenStep ? () => onOpenStep(2) : undefined}
        />
      </ReviewPanel>

      <ReviewPanel title="Audiences" onOpen={onOpenStep ? () => onOpenStep(3) : undefined}>
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

      <ReviewPanel title="Creatives" onOpen={onOpenStep ? () => onOpenStep(4) : undefined}>
        <div className="space-y-2">
          {draft.creatives.items.map((creative) => (
            <div key={creative.id} className="rounded border border-border p-3">
              <Datum className="font-medium">{creative.name}</Datum>
              <Datum className="text-xs text-muted-foreground">{creative.adText}</Datum>
              <Datum className="text-xs text-muted-foreground">
                {creative.displayName} · {creative.landingPageUrl || "No landing page"} ·{" "}
                {creative.cta ?? "No CTA"}
              </Datum>
            </div>
          ))}
          {draft.creatives.items.length === 0 && <Empty />}
        </div>
      </ReviewPanel>

      <ReviewPanel title="Budget" onOpen={onOpenStep ? () => onOpenStep(5) : undefined}>
        <KeyValue
          label="Mode"
          value={draft.budgetSchedule.budgetMode}
          onEdit={onOpenStep ? () => onOpenStep(5) : undefined}
        />
        <KeyValue
          label="Amount"
          value={
            draft.budgetSchedule.budgetAmount == null
              ? null
              : `£${draft.budgetSchedule.budgetAmount}`
          }
          onEdit={onOpenStep ? () => onOpenStep(5) : undefined}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="tiktok-review-schedule-start"
            label="Schedule start"
            type="datetime-local"
            value={startDraft}
            disabled={scheduleDisabled}
            onChange={(event) => {
              const value = event.target.value;
              setStartDraft(value);
              if (shouldPersistReviewSchedule("change")) {
                void persistSchedule({ scheduleStartAt: value || null });
              }
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              setStartDraft(value);
              if (shouldPersistReviewSchedule("blur")) {
                void persistSchedule({ scheduleStartAt: value || null });
              }
            }}
            error={scheduleStartIssue?.message}
          />
          <Input
            id="tiktok-review-schedule-end"
            label="Schedule end"
            type="datetime-local"
            value={endDraft}
            disabled={scheduleDisabled}
            onChange={(event) => {
              const value = event.target.value;
              setEndDraft(value);
              if (shouldPersistReviewSchedule("change")) {
                void persistSchedule({ scheduleEndAt: value || null });
              }
            }}
            onBlur={(event) => {
              const value = event.currentTarget.value;
              setEndDraft(value);
              if (shouldPersistReviewSchedule("blur")) {
                void persistSchedule({ scheduleEndAt: value || null });
              }
            }}
            error={scheduleOrderIssue?.message}
          />
        </div>
        {draft.accountSetup.timezone ? (
          <Datum className="text-xs text-muted-foreground">
            {tikTokAdvertiserClockLabel(draft.accountSetup.timezone)}
          </Datum>
        ) : null}
        <KeyValue
          label="Frequency cap"
          value={
            draft.budgetSchedule.frequencyCap == null
              ? null
              : String(draft.budgetSchedule.frequencyCap)
          }
          onEdit={onOpenStep ? () => onOpenStep(5) : undefined}
        />
      </ReviewPanel>

      <ReviewPanel title="Assignments" onOpen={onOpenStep ? () => onOpenStep(6) : undefined}>
        <div className="space-y-2">
          {adGroups.map((adGroup) => (
            <div key={adGroup.id} className="rounded border border-border p-3">
              <Datum className="font-medium">{adGroup.name}</Datum>
              <Datum className="text-xs text-muted-foreground">
                {(draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [])
                  .map((id) => draft.creatives.items.find((item) => item.id === id)?.name ?? id)
                  .join(", ") || "No creatives assigned"}
              </Datum>
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
            launchPaused: tikTokLaunchWasDeliveredPaused(draft),
            successDescription: tikTokLaunchWasDeliveredPaused(draft)
              ? tikTokLaunchPausedSuccessDescription()
              : tikTokLaunchLiveSuccessDescription({
                  scheduleStartAt: draft.budgetSchedule.scheduleStartAt,
                  timezone: draft.accountSetup.timezone,
                }),
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
        {!alreadyLaunched ? (
          <Datum className="text-sm">{launchConfirmMessage}</Datum>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          {alreadyLaunched ? (
            <Button
              type="button"
              disabled={relaunching}
              onClick={() => void relaunchAsNewDraft()}
            >
              {relaunching
                ? "Duplicating…"
                : "Already launched — Relaunch as a new draft"}
            </Button>
          ) : (
            <>
              <Select
                id="tiktok-launch-mode"
                label="Launch as"
                className="w-44"
                value={launchPaused ? "paused" : "live"}
                disabled={launch.status === "launching"}
                options={[
                  { value: "live", label: "Launch live" },
                  { value: "paused", label: "Launch paused" },
                ]}
                onChange={(event) => {
                  void persistLaunchPaused(event.target.value === "paused");
                }}
              />
              <Button
                type="button"
                disabled={launchDisabled}
                title={launchTitle}
                onClick={() => void launchOnTikTok()}
              >
                {launch.status === "launching"
                  ? "Launching…"
                  : tikTokLaunchButtonLabel(launchPaused)}
              </Button>
            </>
          )}
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
        {!alreadyLaunched && firstLaunchBlocker ? (
          <StatusLine tone="alert" className="text-sm text-red-700">{firstLaunchBlocker}</StatusLine>
        ) : null}
        {relaunchError ? (
          <StatusLine tone="alert" className="text-sm text-red-700">{relaunchError}</StatusLine>
        ) : null}
        
      </div>
      <StatusLine className="text-xs text-muted-foreground">
        {draft.reviewReadyAt
          ? `Marked review ready at ${draft.reviewReadyAt}.`
          : "Review-ready state is stored inside the draft JSON; no status migration required."}
        {draft.publishedIds?.campaignId
          ? ` Published TikTok campaign ${draft.publishedIds.campaignId}.`
          : ""}
      </StatusLine>
    </div>
      </StepSurfaceProvider>
  );
}

function formatPreflightIssue(
  issue: TikTokLaunchPreflightIssue,
  draft: TikTokCampaignDraft,
  adGroups: TikTokAdGroupDraft[],
): string {
  const members =
    issue.adGroupIds?.length
      ? issue.adGroupIds
          .map(
            (id) => adGroups.find((group) => group.id === id)?.name ?? id,
          )
          .join(", ")
      : issue.creativeIds?.length
        ? issue.creativeIds
            .map(
              (id) =>
                draft.creatives.items.find((item) => item.id === id)?.name ??
                id,
            )
            .join(", ")
        : null;
  return members ? `${issue.message} — ${members}` : issue.message;
}

function ReviewPanel({
  title,
  children,
  onOpen,
}: {
  title: string;
  children: React.ReactNode;
  onOpen?: () => void;
}) {
  return (
    <section className="rounded-md border border-border bg-background p-4">
      {onOpen ? (
        <button
          type="button"
          className="font-heading text-lg underline-offset-2 hover:underline"
          onClick={onOpen}
        >
          {title}
        </button>
      ) : (
        <h3 className="font-heading text-lg">{title}</h3>
      )}
      <div className="mt-3 space-y-2 text-sm">{children}</div>
    </section>
  );
}

function KeyValue({
  label,
  value,
  tone = "default",
  emptyWarning,
  onEdit,
}: {
  label: string;
  value: string | null | undefined;
  tone?: "default" | "warning";
  emptyWarning?: string;
  onEdit?: () => void;
}) {
  const display = value || (tone === "warning" ? (emptyWarning ?? "Not set") : "—");
  const valueClass =
    tone === "warning"
      ? "text-right text-amber-700 dark:text-amber-300"
      : "text-right text-foreground";
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      {onEdit ? (
        <button
          type="button"
          className={`${valueClass} underline-offset-2 hover:underline`}
          onClick={onEdit}
        >
          {display}
        </button>
      ) : (
        <span className={valueClass}>{display}</span>
      )}
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
  return <Datum className="text-sm text-muted-foreground">—</Datum>;
}
