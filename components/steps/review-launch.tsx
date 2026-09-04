"use client";

import React, { useMemo, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { markPageCapabilityFailures } from "@/lib/hooks/useMeta";
import { planContinuationHref } from "@/lib/plan/schedule";
import { Card, CardTitle } from "@/components/ui/card";
import { ThresholdBand } from "@/components/viz/threshold-band";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  CheckCircle2,
  ShieldOff,
  Zap,
  Shield,
  XCircle,
  X,
  Rocket,
  ArrowRight,
  ExternalLink,
  Loader2,
  CheckCheck,
  TriangleAlert,
  Info,
  Clock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { CampaignDraft, CampaignSettings, LaunchSummary } from "@/lib/types";
import { METRIC_LABELS, TIME_WINDOW_LABELS } from "@/lib/optimisation-rules";
import {
  failedAdLabelsFromSummary,
  RETRY_FAILED_ADS_CONFIRM,
} from "@/lib/meta/transient-retry";
import {
  formatBusinessUseCaseLimitMessage,
  type BusinessUseCaseBucket,
} from "@/lib/meta/app-usage";
import { type RateLimitUiState } from "@/lib/meta/rate-limit-ui";
import { useBucCooldown } from "@/lib/hooks/useBucCooldown";
import { AutomationArmControl } from "@/components/optimisation/automation-arm-control";
import { Datum, StatusLine } from "@/components/steps/step-surface";

function formatLaunchRateLimitMessage(
  state: RateLimitUiState,
  accountName?: string | null,
): string {
  if (state.kind === "business_use_case" && state.bucket && state.percent != null && state.adAccountId) {
    return formatBusinessUseCaseLimitMessage(
      {
        adAccountId: state.adAccountId,
        type: state.bucket,
        callCountPercent: state.percent,
        totalTimePercent: state.percent,
        totalCpuTimePercent: state.percent,
        maxPercent: state.percent,
        estimatedTimeToRegainAccessMinutes: state.estimatedTimeToRegainAccessMinutes,
      },
      accountName ?? state.accountLabel,
    );
  }
  return state.message;
}

interface ReviewLaunchProps {
  draft: CampaignDraft;
  /** True while the launch API call is in-flight */
  isLaunching?: boolean;
  /** Set when the Meta campaign creation call fails */
  launchError?: string | null;
  /** Named BUC / rate-limit state from a 429 launch abort. */
  launchRateLimit?: RateLimitUiState | null;
  onDismissLaunchError?: () => void;
  /** Re-runs launch from the failed-dialog Retry button (blocked during BUC cooldown). */
  onRetryLaunch?: () => void;
  /** Populated after a successful launch — triggers the success state */
  launchSummary?: LaunchSummary | null;
  onGoToLibrary?: () => void;
  /**
   * Set only for a draft a plan prepared. After launch, the review screen
   * offers a way back to Step 2 (derive TikTok & Google). Ordinary drafts
   * leave this unset and the continuation is not rendered.
   */
  linkedPlan?: { id: string; name: string | null } | null;
  /**
   * Optional escape hatch for review-only fields (currently the Creative
   * Integrity Mode toggle). If absent the toggle renders read-only.
   */
  onUpdateSettings?: (settings: CampaignSettings) => void;
  /**
   * Re-runs the launch flow through the Meta write ledger so succeeded
   * entities short-circuit and only failed ad / ad-set rows re-attempt.
   */
  onRetryFailedAds?: () => void;
}

// ── Launch event types ────────────────────────────────────────────────────────

type EventStatus = "success" | "failed" | "skipped" | "warning" | "pending" | "deferred";
type EventStage = "preflight" | "campaign" | "audience" | "lookalike" | "adset" | "creative" | "ad";

interface LaunchEvent {
  id: string;
  stage: EventStage;
  entity: string;
  status: EventStatus;
  label: string;
  detail?: string;
  durationMs?: number;
  metaId?: string;
}

/** Build a flat chronological event list from a completed LaunchSummary.
 *  Every event id is globally unique using a monotonic counter. */
function buildLaunchEvents(
  summary: LaunchSummary,
  draft: CampaignDraft,
): LaunchEvent[] {
  let seq = 0;
  const uid = (prefix: string) => `${prefix}-${seq++}`;
  const events: LaunchEvent[] = [];

  // Preflight warnings — red ones first, then amber
  if (summary.preflightWarnings?.length) {
    const sorted = [...summary.preflightWarnings].sort((a, b) => {
      if (a.severity === "red" && b.severity !== "red") return -1;
      if (b.severity === "red" && a.severity !== "red") return 1;
      return 0;
    });
    for (const w of sorted) {
      events.push({
        id: uid("pf"),
        stage: "preflight",
        entity: w.stage,
        // Red severity = failed, amber (default) = warning
        status: w.severity === "red" ? "failed" : "warning",
        label: w.severity === "red" ? "Launch blocked" : "Preflight",
        detail: w.message,
      });
    }
  }

  // Campaign — wording differs for the three wizard modes.
  const wizardMode = draft.settings.wizardMode ?? "new";
  // Prefer multi-select array; fall back to legacy singular field.
  const attachedCampaigns =
    draft.settings.existingMetaCampaigns ??
    (draft.settings.existingMetaCampaign ? [draft.settings.existingMetaCampaign] : []);
  const attachedCampaignName =
    attachedCampaigns.length === 1
      ? attachedCampaigns[0].name
      : attachedCampaigns.length > 1
        ? `${attachedCampaigns.length} campaigns`
        : (draft.settings.existingMetaCampaign?.name ?? undefined);
  const attachedAdSets =
    draft.settings.existingMetaAdSets ??
    (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
  const attachedAdSetSummary =
    attachedAdSets.length === 1
      ? `"${attachedAdSets[0].name}"`
      : attachedAdSets.length > 1
        ? `${attachedAdSets.length} ad sets`
        : "";
  events.push({
    id: uid("campaign"),
    stage: "campaign",
    entity:
      wizardMode === "attach_adset" || wizardMode === "attach_campaign"
        ? "Existing campaign"
        : "Campaign",
    status: "success",
    label:
      wizardMode === "attach_adset"
        ? `Adding ads to existing ${attachedAdSets.length === 1 ? "ad set" : "ad sets"}${
            attachedAdSetSummary ? ` ${attachedAdSetSummary}` : ""
          }${attachedCampaignName ? ` (campaign "${attachedCampaignName}")` : ""}`
        : wizardMode === "attach_campaign"
        ? attachedCampaigns.length > 1
          ? `Attached to ${attachedCampaigns.length} existing campaigns`
          : `Attached to existing campaign${attachedCampaignName ? ` "${attachedCampaignName}"` : ""}`
        : `Campaign created`,
    metaId: summary.metaCampaignId,
    durationMs: summary.phaseDurations?.campaign,
  });

  // Engagement audiences (Phase 1.5)
  if (summary.engagementAudiencesCreated?.length) {
    for (const a of summary.engagementAudiencesCreated) {
      events.push({
        id: uid("ea-ok"),
        stage: "audience",
        entity: a.name,
        // Recovery had to grant access before this create succeeded — still a
        // success, but flagged so the operator knows a permission was fixed on
        // their behalf rather than assuming it was clean.
        status: a.note ? "warning" : "success",
        label: `Engagement audience created (${a.type})`,
        detail: a.note,
        metaId: a.id,
        durationMs: a.durationMs,
      });
    }
  }
  if (summary.engagementAudiencesFailed?.length) {
    for (const a of summary.engagementAudiencesFailed) {
      events.push({
        id: uid("ea-fail"),
        stage: "audience",
        entity: a.name,
        status: "failed",
        label: `${a.type} audience failed`,
        detail: a.error,
      });
    }
  }
  // IG engagement types skipped (no linked IG account) — shown as skipped, not failed
  if (summary.engagementAudiencesSkipped?.length) {
    for (const a of summary.engagementAudiencesSkipped) {
      events.push({
        id: uid("ea-skip"),
        stage: "audience",
        entity: a.name,
        status: "skipped",
        label: `${a.type} skipped`,
        detail: a.reason,
      });
    }
  }

  // Lookalike audiences (Phase 1.75)
  if (summary.lookalikeAudiencesCreated?.length) {
    for (const a of summary.lookalikeAudiencesCreated) {
      events.push({
        id: uid("lal-ok"),
        stage: "lookalike",
        entity: a.name,
        status: "success",
        label: `Lookalike audience created (${a.range})`,
        metaId: a.id,
        durationMs: a.durationMs,
      });
    }
  }
  if (summary.lookalikeAudiencesFailed?.length) {
    for (const a of summary.lookalikeAudiencesFailed) {
      events.push({
        id: uid("lal-fail"),
        stage: "lookalike",
        entity: a.name,
        status: a.skippedReason ? "skipped" : "failed",
        label: a.skippedReason ? `Lookalike skipped — ${a.skippedReason}` : `Lookalike ${a.range} failed`,
        detail: a.error,
      });
    }
  }
  if (summary.lookalikesDeferred?.length) {
    for (const a of summary.lookalikesDeferred) {
      events.push({
        id: uid("lal-defer"),
        stage: "lookalike",
        entity: a.name,
        status: "deferred",
        label: `Lookalike deferred — source audience still populating`,
        detail: `Seed: ${a.seedType} (${a.seedAudienceId}) · ${a.reason}`,
      });
    }
  }

  // Interest replacements
  if (summary.interestReplacements?.length) {
    for (const r of summary.interestReplacements) {
      events.push({
        id: uid("int-repl"),
        stage: "adset",
        entity: r.adSetName,
        status: "warning",
        label: r.replacement
          ? `Deprecated interest "${r.deprecated}" → "${r.replacement}"`
          : `Deprecated interest "${r.deprecated}" removed`,
      });
    }
  }

  // Interests skipped because they are not currently available in Meta
  // targeting. These remain on the wizard chip for discovery context only;
  // the launch still succeeds without them.
  if (summary.interestsSkippedNotTargetable?.items?.length) {
    for (const s of summary.interestsSkippedNotTargetable.items) {
      events.push({
        id: uid("int-skip"),
        stage: "adset",
        entity: s.adSetName,
        status: "warning",
        label: `Interest "${s.name}" skipped — not currently available in Meta targeting (${s.status})`,
      });
    }
  }

  // Ad sets
  for (const s of summary.adSetsCreated) {
    const ageLabel = s.ageMode === "suggested" ? "Advantage+" : "strict";
    events.push({
      id: uid("as-ok"),
      stage: "adset",
      entity: s.name,
      // A note means a create-retry ladder had to salvage this ad set
      // (dropped a stale custom audience, or stripped an objective-
      // incompatible Advantage+ Audience automation) — still a success,
      // but flagged so the operator knows something was adjusted on their
      // behalf. See lib/audiences/ca-availability-recovery.ts and
      // isInvalidTargetingAutomationError in lib/meta/error-classify.ts.
      status: s.note ? "warning" : "success",
      label: `Ad set created · ${ageLabel} age`,
      detail: s.note,
      metaId: s.metaAdSetId,
      durationMs: s.durationMs,
    });
  }
  for (const s of summary.adSetsFailed) {
    events.push({
      id: uid("as-fail"),
      stage: "adset",
      entity: s.name,
      status: s.skippedReason ? "skipped" : "failed",
      label: s.skippedReason ? `Ad set skipped — ${s.skippedReason}` : "Ad set failed",
      detail: s.error,
    });
  }

  // Multi-campaign additional campaigns (campaigns 2..N)
  if (summary.campaignAttachResults && summary.campaignAttachResults.length > 1) {
    for (let ci = 1; ci < summary.campaignAttachResults.length; ci++) {
      const r = summary.campaignAttachResults[ci];
      events.push({
        id: uid(`mc-camp-${ci}`),
        stage: "campaign" as EventStage,
        entity: r.campaignName,
        status: "success",
        label: `Campaign ${ci + 1}/${summary.campaignAttachResults.length} — "${r.campaignName}"`,
        metaId: r.campaignId,
      });
      for (const s of r.adSetsCreated) {
        events.push({
          id: uid(`mc-as-ok-${ci}`),
          stage: "adset" as EventStage,
          entity: `${s.name} [${r.campaignName}]`,
          status: "success",
          label: `Ad set created · ${s.ageMode === "suggested" ? "Advantage+" : "strict"} age`,
          metaId: s.metaAdSetId,
          durationMs: s.durationMs,
        });
      }
      for (const s of r.adSetsFailed) {
        events.push({
          id: uid(`mc-as-fail-${ci}`),
          stage: "adset" as EventStage,
          entity: `${s.name} [${r.campaignName}]`,
          status: "failed",
          label: "Ad set failed",
          detail: s.error,
        });
      }
    }
  }

  // Creatives + their ads
  for (const c of summary.creativesCreated) {
    const identityLabel = c.identityMode === "page_and_ig" ? "Page + IG" : "Page only";
    events.push({
      id: uid("cr-ok"),
      stage: "creative",
      entity: c.name,
      status: "success",
      label: `Creative created · ${identityLabel}`,
      metaId: c.metaCreativeId,
      durationMs: c.durationMs,
    });
    for (const a of c.ads) {
      events.push({
        id: uid("ad-ok"),
        stage: "ad",
        entity: `${c.name} → ${a.adSetName}`,
        status: "success",
        label: "Ad linked",
        metaId: a.metaAdId,
        durationMs: a.durationMs,
      });
    }
    for (const a of c.adsFailed) {
      events.push({
        id: uid("ad-fail"),
        stage: "ad",
        entity: `${c.name} → ${a.adSetName}`,
        status: "failed",
        label: "Ad failed",
        detail: a.error,
      });
    }
  }
  for (const c of summary.creativesFailed) {
    const isAppModeBlocked = c.skippedReason === "app_mode_blocked";
    events.push({
      id: uid("cr-fail"),
      stage: "creative",
      entity: c.name,
      // app_mode_blocked is a hard failure (the creative was actively rejected),
      // not a skip — show it as failed so users understand it needs action.
      status: isAppModeBlocked ? "failed" : c.skippedReason ? "skipped" : "failed",
      label: isAppModeBlocked
        ? "Creative blocked — Meta app not in Live/Public mode"
        : c.skippedReason
          ? `Creative skipped — ${c.skippedReason}`
          : "Creative failed",
      detail: c.error,
    });
  }

  return events;
}

/** Placeholder events shown while the launch is in-flight */
const PENDING_EVENTS: LaunchEvent[] = [
  { id: "p-0", stage: "preflight", entity: "Preflight", status: "pending", label: "Validating configuration…" },
  { id: "p-1", stage: "campaign", entity: "Campaign", status: "pending", label: "Creating campaign…" },
  { id: "p-2", stage: "audience", entity: "Engagement Audiences", status: "pending", label: "Creating engagement audiences…" },
  { id: "p-3", stage: "adset", entity: "Ad Sets", status: "pending", label: "Creating ad sets…" },
  { id: "p-4", stage: "creative", entity: "Creatives", status: "pending", label: "Building creatives…" },
  { id: "p-5", stage: "lookalike", entity: "Lookalike Audiences", status: "pending", label: "Creating lookalike audiences (non-blocking)…" },
  { id: "p-6", stage: "ad", entity: "Ads", status: "pending", label: "Linking ads…" },
];

const STAGE_LABEL: Record<EventStage, string> = {
  preflight: "Preflight",
  campaign: "Campaign",
  audience: "Audience",
  lookalike: "Lookalike",
  adset: "Ad Set",
  creative: "Creative",
  ad: "Ad",
};

function StatusIcon({ status }: { status: EventStatus }) {
  switch (status) {
    case "pending":
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    case "success":
      return <CheckCheck className="h-4 w-4 text-success" />;
    case "failed":
      return <TriangleAlert className="h-4 w-4 text-destructive" />;
    case "skipped":
      return <X className="h-4 w-4 text-muted-foreground" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    case "deferred":
      return <Clock className="h-4 w-4 text-amber-500" />;
  }
}

function EventRow({ event }: { event: LaunchEvent }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 shrink-0">
        <StatusIcon status={event.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {STAGE_LABEL[event.stage]}
          </span>
          <span className="truncate text-sm font-medium">{event.entity}</span>
          {event.durationMs != null && (
            <span className="text-[10px] text-muted-foreground">
              {event.durationMs < 1000 ? `${event.durationMs}ms` : `${(event.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
        <Datum
          className={`mt-0.5 text-xs ${
            event.status === "failed"
              ? "text-destructive"
              : event.status === "warning"
                ? "text-warning"
                : event.status === "skipped"
                  ? "text-muted-foreground italic"
                  : event.status === "deferred"
                    ? "text-amber-600"
                    : "text-muted-foreground"
          }`}
        >
          {event.label}
          {event.metaId && (
            <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
              ID {event.metaId}
            </span>
          )}
        </Datum>
        {event.detail && event.detail !== event.label && (
          <Datum className="mt-0.5 text-[11px] text-muted-foreground/70 break-all">
            {event.detail}
          </Datum>
        )}
      </div>
    </div>
  );
}

function CountChip({ ok, failed, skipped, label }: { ok: number; failed: number; skipped?: number; label: string }) {
  const parts: React.ReactElement[] = [];
  if (ok > 0) parts.push(<span key="ok" className="text-success">✓ {ok}</span>);
  if (failed > 0) parts.push(<span key="fail" className="text-destructive">✗ {failed}</span>);
  if (skipped && skipped > 0) parts.push(<span key="skip" className="text-muted-foreground">⊘ {skipped}</span>);
  if (parts.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      {parts}
    </div>
  );
}

function SummaryCounts({ summary }: { summary: LaunchSummary }) {
  const eaOk = summary.engagementAudiencesCreated?.length ?? 0;
  const eaFail = summary.engagementAudiencesFailed?.length ?? 0;
  const eaSkipped = summary.engagementAudiencesSkipped?.length ?? 0;
  const lalOk = summary.lookalikeAudiencesCreated?.length ?? 0;
  const lalFail = summary.lookalikeAudiencesFailed?.length ?? 0;
  const lalDeferred = summary.lookalikesDeferred?.length ?? 0;
  const lalSkipped = summary.lookalikeAudiencesFailed?.filter((f) => f.skippedReason).length ?? 0;
  const asSkipped = summary.adSetsFailed.filter((f) => f.skippedReason).length;
  // app_mode_blocked is shown as a hard failure in the event log, so don't count
  // it as "skipped" in the summary chip — keeps the counts consistent.
  const crSkipped = summary.creativesFailed.filter(
    (f) => f.skippedReason && f.skippedReason !== "app_mode_blocked",
  ).length;

  return (
    <div className="flex flex-wrap gap-2">
      <CountChip ok={1} failed={0} label="Campaign" />
      {(eaOk + eaFail + eaSkipped > 0) && <CountChip ok={eaOk} failed={eaFail} skipped={eaSkipped} label="Audiences" />}
      {(lalOk + lalFail + lalDeferred > 0) && (
        <>
          <CountChip ok={lalOk} failed={lalFail - lalSkipped} skipped={lalSkipped} label="Lookalikes" />
          {lalDeferred > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border border-amber-300/40 bg-amber-50/40 px-2 py-1 text-xs">
              <Clock className="h-3 w-3 text-amber-500" />
              <span className="font-medium text-amber-600">{lalDeferred} deferred</span>
            </div>
          )}
        </>
      )}
      <CountChip
        ok={
          summary.adSetsCreated.length +
          (summary.campaignAttachResults?.slice(1).reduce((sum, r) => sum + r.adSetsCreated.length, 0) ?? 0)
        }
        failed={
          summary.adSetsFailed.length - asSkipped +
          (summary.campaignAttachResults?.slice(1).reduce((sum, r) => sum + r.adSetsFailed.length, 0) ?? 0)
        }
        skipped={asSkipped}
        label="Ad Sets"
      />
      <CountChip ok={summary.creativesCreated.length} failed={summary.creativesFailed.length - crSkipped} skipped={crSkipped} label="Creatives" />
      <CountChip
        ok={
          summary.adsCreated +
          (summary.campaignAttachResults?.slice(1).reduce((sum, r) => sum + r.adsCreated, 0) ?? 0)
        }
        failed={
          summary.adsFailed +
          (summary.campaignAttachResults?.slice(1).reduce((sum, r) => sum + r.adsFailed, 0) ?? 0)
        }
        label="Ads"
      />
      {(summary.interestReplacements?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs">
          <span className="font-medium text-warning">↻ {summary.interestReplacements!.length} deprecated interest{summary.interestReplacements!.length !== 1 ? "s" : ""} handled</span>
        </div>
      )}
      {(summary.interestsSkippedNotTargetable?.count ?? 0) > 0 && (
        <div
          className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs"
          title="These interests stayed on your audience chips for discovery context but were skipped at launch because Meta doesn't currently expose them as targetable interests."
        >
          <AlertTriangle className="h-3 w-3 text-warning" />
          <span className="font-medium text-warning">
            {summary.interestsSkippedNotTargetable!.count} interest{summary.interestsSkippedNotTargetable!.count !== 1 ? "s" : ""} skipped (not targetable)
          </span>
        </div>
      )}
      {/* Interest cluster diagnostics — show drop/fallback counts if any interests were dropped */}
      {(summary.interestClusterDiagnostics ?? []).some((d) => d.droppedCount > 0 || d.fallbacksAdded > 0) && (
        <div
          className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs"
          title={
            summary.interestClusterDiagnostics!
              .filter((d) => d.droppedCount > 0 || d.fallbacksAdded > 0)
              .map((d) => `${d.adSetName}: ${d.summaryLine}`)
              .join("\n")
          }
        >
          <AlertTriangle className="h-3 w-3 text-warning" />
          <span className="font-medium text-warning">
            {summary.interestClusterDiagnostics!.reduce((acc, d) => acc + d.droppedCount, 0)} interest{summary.interestClusterDiagnostics!.reduce((acc, d) => acc + d.droppedCount, 0) !== 1 ? "s" : ""} dropped
            {summary.interestClusterDiagnostics!.some((d) => d.fallbacksAdded > 0) &&
              ` · ${summary.interestClusterDiagnostics!.reduce((acc, d) => acc + d.fallbacksAdded, 0)} fallback${summary.interestClusterDiagnostics!.reduce((acc, d) => acc + d.fallbacksAdded, 0) !== 1 ? "s" : ""} added`}
          </span>
        </div>
      )}
      {/* IG audiences skipped (no linked account) */}
      {(summary.engagementAudiencesSkipped?.length ?? 0) > 0 && (
        <div
          className="flex items-center gap-1.5 rounded-md border border-muted/40 bg-muted/10 px-2 py-1 text-xs"
          title={summary.engagementAudiencesSkipped!.map((s) => `${s.name}: ${s.reason}`).join("\n")}
        >
          <span className="font-medium text-muted-foreground">
            {summary.engagementAudiencesSkipped!.length} IG audience{summary.engagementAudiencesSkipped!.length !== 1 ? "s" : ""} skipped (no linked IG account)
          </span>
        </div>
      )}
    </div>
  );
}

/** Build the Meta Ads Manager deep-link URL for a created campaign */
function buildMetaLink(
  adAccountId: string | undefined,
  campaignId: string,
): string {
  const numericId = adAccountId?.replace(/^act_/, "") ?? "";
  if (numericId) {
    return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${numericId}&selected_campaign_ids=${campaignId}`;
  }
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns`;
}

export function RetryFailedAdsPanel({
  draftId,
  launchSummary,
  onRetryFailedAds,
  isLaunching,
  cooldownBlocked,
  cooldownLabel,
}: {
  draftId: string;
  /** Absent when the draft is reopened after the launch session ended. */
  launchSummary?: LaunchSummary | null;
  onRetryFailedAds: () => void;
  isLaunching?: boolean;
  cooldownBlocked?: boolean;
  cooldownLabel?: string | null;
}) {
  const [failedLedgerCount, setFailedLedgerCount] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/meta/launch-retry?draftId=${encodeURIComponent(draftId)}`,
        );
        const body = (await res.json()) as { failed?: unknown };
        if (cancelled) return;
        setFailedLedgerCount(Array.isArray(body.failed) ? body.failed.length : 0);
      } catch {
        if (!cancelled) setFailedLedgerCount(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, launchSummary]);

  if (failedLedgerCount === 0) return null;
  if (failedLedgerCount === null) return null;

  const labels = launchSummary ? failedAdLabelsFromSummary(launchSummary) : [];
  const count = labels.length > 0 ? labels.length : failedLedgerCount;

  return (
    <div className="mt-3 rounded-lg border border-amber-300/50 bg-amber-50/50 p-3">
      <StatusLine className="text-sm font-semibold text-amber-900">
        {count} ad{count === 1 ? "" : "s"} failed
      </StatusLine>
      {labels.length > 0 ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-amber-900/90">
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : (
        <StatusLine className="mt-1 text-xs text-amber-900/80">
          {count} failed ad or ad-set write{count === 1 ? "" : "s"} on the ledger.
        </StatusLine>
      )}

      {confirming ? (
        <div className="mt-3 space-y-2">
          <Datum className="text-xs font-medium text-amber-950">
            These ads will be re-attempted:
          </Datum>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-900/90">
            {(labels.length > 0 ? labels : [`${count} failed ledger write${count === 1 ? "" : "s"}`]).map(
              (label) => (
                <li key={label}>{label}</li>
              ),
            )}
          </ul>
          <Datum className="text-xs text-amber-950">{RETRY_FAILED_ADS_CONFIRM}</Datum>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-amber-400 text-amber-700 hover:bg-amber-100"
              disabled={isLaunching || cooldownBlocked}
              onClick={() => {
                setConfirming(false);
                onRetryFailedAds();
              }}
            >
              {isLaunching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {cooldownBlocked && cooldownLabel
                ? `Retry in ${cooldownLabel}`
                : "Confirm retry"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isLaunching}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 border-amber-400 text-amber-700 hover:bg-amber-100"
          disabled={isLaunching || cooldownBlocked}
          onClick={() => setConfirming(true)}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {cooldownBlocked && cooldownLabel
            ? `Retry in ${cooldownLabel}`
            : "Retry failed ads"}
        </Button>
      )}
    </div>
  );
}

export function RetryLookalikesPanel({ draft }: { draft: CampaignDraft }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<{
    created: Array<{ name: string; id: string; range: string }>;
    deferred: Array<{ name: string; code: number; description: string }>;
    failed: Array<{ name: string; error: string }>;
  } | null>(null);

  const handleRetry = useCallback(async () => {
    setStatus("loading");
    setResult(null);
    try {
      const res = await fetch("/api/meta/lookalikes/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const data = (await res.json()) as typeof result & { error?: string };
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setResult(data);
      setStatus("done");
    } catch (err) {
      setResult(null);
      setStatus("error");
      console.error("[RetryLookalikesPanel]", err);
    }
  }, [draft]);

  return (
    <div className="mt-4 rounded-lg border border-amber-300/40 bg-amber-50/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-amber-500 shrink-0" />
        <span className="text-sm font-semibold text-amber-800">Lookalikes deferred — source audiences still populating</span>
      </div>
      <Datum className="text-xs text-amber-700 mb-3">
        Meta needs time to build the source engagement audiences before lookalikes can be created.
        Come back in a few minutes and use the button below to retry.
      </Datum>

      {status === "idle" && (
        <Button variant="outline" size="sm" onClick={handleRetry} className="border-amber-400 text-amber-700 hover:bg-amber-100">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry lookalikes from existing source audiences
        </Button>
      )}

      {status === "loading" && (
        <div className="flex items-center gap-2 text-sm text-amber-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking readiness and creating lookalikes…
        </div>
      )}

      {status === "done" && result && (
        <div className="space-y-1">
          {result.created.length > 0 && (
            <div className="space-y-0.5">
              {result.created.map((c) => (
                <Datum key={c.id} className="text-xs text-success flex items-center gap-1">
                  <CheckCheck className="h-3 w-3 inline" />
                  {c.name} created · ID {c.id}
                </Datum>
              ))}
            </div>
          )}
          {result.deferred.length > 0 && (
            <div className="space-y-0.5">
              {result.deferred.map((d, i) => (
                <Datum key={i} className="text-xs text-amber-600 flex items-center gap-1">
                  <Clock className="h-3 w-3 inline" />
                  {d.name} still populating (code {d.code}) — try again later
                </Datum>
              ))}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="space-y-0.5">
              {result.failed.map((f, i) => (
                <Datum key={i} className="text-xs text-destructive flex items-center gap-1">
                  <TriangleAlert className="h-3 w-3 inline" />
                  {f.name} failed: {f.error}
                </Datum>
              ))}
            </div>
          )}
          {result.deferred.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleRetry} className="mt-2 border-amber-400 text-amber-700 hover:bg-amber-100">
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </Button>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="space-y-2">
          <Datum className="text-xs text-destructive">Request failed. Check console for details.</Datum>
          <Button variant="outline" size="sm" onClick={handleRetry} className="border-amber-400 text-amber-700 hover:bg-amber-100">
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function ReviewLaunch({
  draft,
  isLaunching = false,
  launchError,
  launchRateLimit = null,
  onDismissLaunchError,
  onRetryLaunch,
  launchSummary,
  onGoToLibrary,
  linkedPlan,
  onUpdateSettings,
  onRetryFailedAds,
}: ReviewLaunchProps) {
  const bs = draft.budgetSchedule;
  const wizardMode = draft.settings.wizardMode ?? "new";
  const isAttachAdSet = wizardMode === "attach_adset";

  // Creative Integrity Mode — defaults to ON for any draft missing the flag.
  // The toggle below mirrors the wizard default so launches always disclose
  // the current behaviour even on legacy drafts.
  const creativeIntegrityMode = draft.settings.creativeIntegrityMode !== false;
  const setCreativeIntegrityMode = (value: boolean) => {
    if (!onUpdateSettings) return;
    onUpdateSettings({ ...draft.settings, creativeIntegrityMode: value });
  };

  const adAccountId =
    draft.settings.metaAdAccountId || draft.settings.adAccountId || undefined;
  const launchCooldown = useBucCooldown(adAccountId, launchRateLimit ?? null);
  const [prelaunchUsage, setPrelaunchUsage] = useState<{
    accountName: string | null;
    bucket: BusinessUseCaseBucket | null;
    warn: boolean;
  } | null>(null);

  useEffect(() => {
    if (!adAccountId || launchSummary) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/meta/usage?adAccountId=${encodeURIComponent(adAccountId)}`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          accountName?: string | null;
          adsManagement?: BusinessUseCaseBucket | null;
          warn?: boolean;
        };
        if (cancelled) return;
        setPrelaunchUsage({
          accountName: body.accountName ?? null,
          bucket: body.adsManagement ?? null,
          warn: body.warn === true,
        });
      } catch {
        /* pre-launch indicator is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adAccountId, launchSummary]);

  // Events to display in the feed
  const launchEvents = useMemo<LaunchEvent[]>(() => {
    if (isLaunching) return PENDING_EVENTS;
    if (launchSummary) return buildLaunchEvents(launchSummary, draft);
    return [];
  }, [isLaunching, launchSummary, draft]);

  // After a launch, persist any page capability failures back into the cache so
  // the page audience panel shows updated badges on the next visit.
  useEffect(() => {
    if (!launchSummary?.engagementAudiencesFailed?.length) return;
    const failures = launchSummary.engagementAudiencesFailed
      .filter((f) => f.pageId)
      .map((f) => ({
        pageId: f.pageId!,
        type: f.type,
        isPermissionFailure: f.isPermissionFailure ?? false,
        isNoInstagram:
          (f.error ?? "").toLowerCase().includes("no linked instagram") ||
          (f.error ?? "").toLowerCase().includes("instagram account found"),
      }));
    if (failures.length > 0) markPageCapabilityFailures(failures);
  }, [launchSummary]);

  const hasFailures =
    launchSummary &&
    (launchSummary.adSetsFailed.length > 0 ||
      launchSummary.creativesFailed.length > 0 ||
      launchSummary.adsFailed > 0);

  // App-mode blocking — creatives rejected because Meta app is in Development mode
  const appModeBlockedCreatives =
    launchSummary?.creativesFailed.filter((c) => c.skippedReason === "app_mode_blocked") ?? [];
  const allCreativesBlocked =
    appModeBlockedCreatives.length > 0 &&
    (launchSummary?.creativesCreated.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        {prelaunchUsage?.warn && prelaunchUsage.bucket && (
          <div
            className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2"
            role="status"
            data-testid="buc-prelaunch-warning"
          >
            <Datum className="text-sm font-medium text-amber-950">
              {formatBusinessUseCaseLimitMessage(
                prelaunchUsage.bucket,
                prelaunchUsage.accountName,
              )}
            </Datum>
            <Datum className="mt-0.5 text-xs text-amber-900/80">
              This ad account&apos;s ads_management budget is already above{" "}
              {Math.round(prelaunchUsage.bucket.maxPercent)}%. A launch that
              creates many audiences can hit the ceiling before it finishes.
            </Datum>
          </div>
        )}
      </div>

      {/* ── Live launch progress feed ──────────────────────────────────────── */}
      {(isLaunching || launchSummary) && (
        <Card className={launchSummary && !hasFailures ? "border-success" : undefined}>
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isLaunching ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <Datum className="font-heading text-lg tracking-wide">Launching…</Datum>
                </>
              ) : hasFailures ? (
                <>
                  <TriangleAlert className="h-5 w-5 text-warning" />
                  <Datum className="font-heading text-lg tracking-wide">Partially launched</Datum>
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 text-success" />
                  <Datum className="font-heading text-lg tracking-wide text-success">
                    Campaign created
                  </Datum>
                </>
              )}
            </div>

            {/* Open in Meta button */}
            {launchSummary && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() =>
                  window.open(
                    buildMetaLink(adAccountId, launchSummary.metaCampaignId),
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Meta
              </Button>
            )}
          </div>

          {/* Event feed */}
          <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-muted/30 px-4">
            {launchEvents.map((ev) => (
              <EventRow key={ev.id} event={ev} />
            ))}
          </div>

          {/* Summary counts + duration */}
          {launchSummary && (
            <div className="mt-3 space-y-2">
              <SummaryCounts summary={launchSummary} />
              {launchSummary.totalDurationMs != null && (
                <Datum className="text-xs text-muted-foreground">
                  Total launch time: {(launchSummary.totalDurationMs / 1000).toFixed(1)}s
                </Datum>
              )}

              {/* App mode blocking banner */}
              {appModeBlockedCreatives.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <Datum className="text-sm font-semibold text-destructive">
                        {allCreativesBlocked
                          ? "Campaign structure created — creatives not launched"
                          : `${appModeBlockedCreatives.length} creative${appModeBlockedCreatives.length !== 1 ? "s" : ""} blocked by Meta app mode`}
                      </Datum>
                      <Datum className="mt-1 text-xs text-destructive/80">
                        {allCreativesBlocked
                          ? "Your campaign and ad sets were created in Meta, but no creatives were launched because "
                          : "Some creatives could not launch because "}
                        your Meta app is in <strong>Development mode</strong>. Ads will not deliver until you switch to{" "}
                        <strong>Live/Public mode</strong> in{" "}
                        <span className="font-mono">Meta for Developers → App Settings → Status</span>.
                        {allCreativesBlocked && (
                          <span className="mt-1 block">
                            The campaign structure is live in Meta Ads Manager — you can relaunch creatives once the app is in Live mode.
                          </span>
                        )}
                      </Datum>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Retry failed ads — ledger-gated; absent when nothing failed */}
          {launchSummary && onRetryFailedAds && (
            <RetryFailedAdsPanel
              draftId={draft.id}
              launchSummary={launchSummary}
              onRetryFailedAds={onRetryFailedAds}
              isLaunching={isLaunching}
              cooldownBlocked={launchCooldown.blocked}
              cooldownLabel={launchCooldown.label}
            />
          )}

          {/* Retry lookalikes panel — shown when lookalikes were deferred */}
          {launchSummary && (launchSummary.lookalikesDeferred?.length ?? 0) > 0 && (
            <RetryLookalikesPanel draft={draft} />
          )}

          {launchSummary && (onGoToLibrary || linkedPlan) && (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {linkedPlan ? (
                <Link
                  href={planContinuationHref(linkedPlan.id)}
                  className="inline-flex h-9 items-center justify-center rounded-md border border-border-strong bg-transparent px-4 text-sm font-medium text-foreground transition-colors hover:bg-card"
                >
                  Continue plan {linkedPlan.name?.trim() || "Untitled plan"} — derive TikTok & Google
                </Link>
              ) : null}
              {onGoToLibrary ? (
                <Button onClick={onGoToLibrary}>
                  Go to Campaign Library
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          )}
        </Card>
      )}

      {/* Creative Integrity Mode — global publish-as-uploaded safeguard */}
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={`mt-0.5 h-5 w-5 shrink-0 ${
                creativeIntegrityMode ? "text-success" : "text-muted-foreground"
              }`}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Creative Integrity Mode</CardTitle>
                <Badge
                  variant={creativeIntegrityMode ? "primary" : "outline"}
                  className="text-[10px]"
                >
                  {creativeIntegrityMode ? "ON" : "OFF"}
                </Badge>
              </div>
              <Datum className="mt-1 text-xs text-muted-foreground">
                Publish ads exactly as uploaded. Disables AI enhancements and
                automatic creative changes — no Advantage+, no music, no auto
                sitelinks, no dynamic creative, no catalog attachments.
              </Datum>
              {!creativeIntegrityMode && (
                <Datum className="mt-1.5 text-[11px] text-amber-700">
                  Meta may automatically apply Advantage+ enhancements to your
                  creatives.
                </Datum>
              )}
            </div>
          </div>
          {/* Inline toggle — disabled when no settings updater is wired in. */}
          <button
            type="button"
            role="switch"
            aria-checked={creativeIntegrityMode}
            aria-label="Toggle Creative Integrity Mode"
            disabled={!onUpdateSettings || isLaunching || Boolean(launchSummary)}
            onClick={() => setCreativeIntegrityMode(!creativeIntegrityMode)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
              disabled:cursor-not-allowed disabled:opacity-60
              ${creativeIntegrityMode ? "bg-foreground" : "bg-border"}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform
                ${creativeIntegrityMode ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </div>
      </Card>

      {!isAttachAdSet && (
        <AutomationArmControl
          draftId={draft.id}
          currency={bs.currency}
          baseCampaignBudget={
            draft.optimisationStrategy?.guardrails?.baseCampaignBudget ??
            bs.budgetAmount
          }
          hardBudgetCeiling={
            draft.optimisationStrategy?.guardrails?.hardBudgetCeiling ??
            Math.round(
              (draft.optimisationStrategy?.guardrails?.baseCampaignBudget ??
                bs.budgetAmount) * 2,
            )
          }
          showDecisions={draft.status === "published"}
        />
      )}

      {/* ── Launch error modal ─────────────────────────────────────────────── */}
      {launchError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Campaign launch failed"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <Datum className="font-heading text-lg tracking-wide">
                    Launch Failed
                  </Datum>
                  <Datum className="mt-1 text-sm text-muted-foreground">
                    Meta returned an error. Your draft has not been changed.
                  </Datum>
                </div>
              </div>
              {onDismissLaunchError && (
                <button
                  type="button"
                  onClick={onDismissLaunchError}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <Datum className="text-sm text-destructive" data-testid="launch-error-message">
                {launchRateLimit
                  ? formatLaunchRateLimitMessage(launchRateLimit, prelaunchUsage?.accountName)
                  : launchError}
              </Datum>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {onDismissLaunchError && (
                <>
                  <Button variant="outline" onClick={onDismissLaunchError}>
                    Go Back
                  </Button>
                  <Button
                    variant="outline"
                    disabled={launchCooldown.blocked}
                    onClick={() => {
                      if (launchCooldown.blocked) return;
                      if (onRetryLaunch) {
                        onRetryLaunch();
                        return;
                      }
                      onDismissLaunchError();
                    }}
                  >
                    {launchCooldown.blocked && launchCooldown.label
                      ? `Retry in ${launchCooldown.label}`
                      : "Retry"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
