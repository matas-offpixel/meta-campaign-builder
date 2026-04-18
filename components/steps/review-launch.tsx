"use client";

import React, { useMemo, useEffect, useState, useCallback } from "react";
import { markPageCapabilityFailures, getCachedUserPages } from "@/lib/hooks/useMeta";
import { Card, CardTitle } from "@/components/ui/card";
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
import { validateStep } from "@/lib/validation";
import { METRIC_LABELS, TIME_WINDOW_LABELS } from "@/lib/optimisation-rules";

interface ReviewLaunchProps {
  draft: CampaignDraft;
  /** True while the launch API call is in-flight */
  isLaunching?: boolean;
  /** Set when the Meta campaign creation call fails */
  launchError?: string | null;
  onDismissLaunchError?: () => void;
  /** Populated after a successful launch — triggers the success state */
  launchSummary?: LaunchSummary | null;
  onGoToLibrary?: () => void;
  /**
   * Optional escape hatch for review-only fields (currently the Creative
   * Integrity Mode toggle). If absent the toggle renders read-only.
   */
  onUpdateSettings?: (settings: CampaignSettings) => void;
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
  const attachedCampaignName = draft.settings.existingMetaCampaign?.name;
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
        ? `Attached to existing campaign${attachedCampaignName ? ` "${attachedCampaignName}"` : ""}`
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
        status: "success",
        label: `Engagement audience created (${a.type})`,
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
      status: "success",
      label: `Ad set created · ${ageLabel} age`,
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
        <p
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
        </p>
        {event.detail && event.detail !== event.label && (
          <p className="mt-0.5 text-[11px] text-muted-foreground/70 break-all">
            {event.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value || "—"}</span>
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
      <CountChip ok={summary.adSetsCreated.length} failed={summary.adSetsFailed.length - asSkipped} skipped={asSkipped} label="Ad Sets" />
      <CountChip ok={summary.creativesCreated.length} failed={summary.creativesFailed.length - crSkipped} skipped={crSkipped} label="Creatives" />
      <CountChip ok={summary.adsCreated} failed={summary.adsFailed} label="Ads" />
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

// ── Pre-launch health summary ─────────────────────────────────────────────────

// Client-side replica of the real-Meta-ID check (mirrors isRealMetaId in adset.ts).
function isRealId(id: string) { return /^\d{10,}$/.test(id); }

function PreLaunchHealthCard({ draft }: { draft: CampaignDraft }) {
  const cachedPages = getCachedUserPages();

  // ── Interest group health ────────────────────────────────────────────────
  const interestHealth = draft.audiences.interestGroups.map((g) => {
    const realCount = g.interests.filter((i) => isRealId(i.id)).length;
    return {
      id: g.id,
      name: g.name || "Untitled",
      total: g.interests.length,
      realCount,
      empty: g.interests.length === 0,
      allInvalid: g.interests.length > 0 && realCount === 0,
    };
  });

  // ── Page group health ─────────────────────────────────────────────────────
  const pageGroupHealth = draft.audiences.pageGroups.map((g) => {
    const noTypesSelected = !g.engagementTypes || g.engagementTypes.length === 0;
    const hasManualAudiences = (g.customAudienceIds ?? []).some(isRealId);

    const selectedPages = g.pageIds
      .map((id) => cachedPages.find((p) => p.id === id))
      .filter(Boolean);

    const hasIg = (p: (typeof selectedPages)[number]) => {
      if (!p) return false;
      if (p.capabilities?.igFollowersSource === false) return false;
      return !!(p.hasInstagramLinked ?? (p.instagram_business_account?.id ?? p.connected_instagram_account?.id));
    };
    const allPagesNoIg = selectedPages.length > 0 && selectedPages.every((p) => !hasIg(p));
    const fbCapFailed =
      selectedPages.some((p) => p?.capabilities?.fbLikesSource === false) ||
      selectedPages.some((p) => p?.capabilities?.fbEngagementSource === false);

    // Per engagement-type prediction
    const igTypesSelected =
      g.engagementTypes.includes("ig_followers") ||
      g.engagementTypes.includes("ig_engagement_365d");
    const fbTypesSelected =
      g.engagementTypes.includes("fb_likes") ||
      g.engagementTypes.includes("fb_engagement_365d");

    const typeHealth = {
      fb_likes: g.engagementTypes.includes("fb_likes")
        ? (selectedPages.some((p) => p?.capabilities?.fbLikesSource === false) ? "cap_failed" : "ok")
        : "not_selected",
      fb_engagement_365d: g.engagementTypes.includes("fb_engagement_365d")
        ? (selectedPages.some((p) => p?.capabilities?.fbEngagementSource === false) ? "cap_failed" : "ok")
        : "not_selected",
      ig_followers: g.engagementTypes.includes("ig_followers")
        ? (allPagesNoIg ? "no_ig" : "ok")
        : "not_selected",
      ig_engagement_365d: g.engagementTypes.includes("ig_engagement_365d")
        ? (allPagesNoIg ? "no_ig" : "ok")
        : "not_selected",
    } as Record<string, "ok" | "cap_failed" | "no_ig" | "not_selected">;

    // Any type expected to produce an audience?
    const anyTypeWillSucceed =
      typeHealth.fb_likes === "ok" ||
      typeHealth.fb_engagement_365d === "ok" ||
      typeHealth.ig_followers === "ok" ||
      typeHealth.ig_engagement_365d === "ok";

    const lookalikesExpected = !!(g.lookalike && !noTypesSelected);
    const lookalikeBlocked =
      lookalikesExpected &&
      !anyTypeWillSucceed;

    // Group will have empty targeting if no types selected AND no manual audiences
    const willHaveEmptyTargeting = noTypesSelected && !hasManualAudiences;

    return {
      id: g.id,
      name: g.name || "Untitled",
      pageCount: g.pageIds.length,
      noTypesSelected,
      hasManualAudiences,
      willHaveEmptyTargeting,
      lookalikesExpected,
      lookalikeBlocked,
      allPagesNoIg,
      fbCapFailed,
      fbTypesSelected,
      igTypesSelected,
      anyTypeWillSucceed,
      typeHealth,
    };
  });

  // ── Ad set targeting health ───────────────────────────────────────────────
  // Predict whether each enabled ad set will have audience targeting at launch.
  const adSetHealth = draft.adSetSuggestions
    .filter((s) => s.enabled)
    .map((s) => {
      let audiencesOk = true;
      let reason = "";
      let detail = "";

      switch (s.sourceType) {
        case "interest_group": {
          const g = draft.audiences.interestGroups.find((x) => x.id === s.sourceId);
          if (!g || g.interests.length === 0) {
            audiencesOk = false;
            reason = "No interests — will be ABORTED at launch";
            detail = g ? "Interest group is empty" : "Interest group not found";
          } else {
            const real = g.interests.filter((i) => isRealId(i.id)).length;
            if (real === 0) {
              audiencesOk = false;
              reason = "All interests invalid — will be ABORTED at launch";
              detail = `${g.interests.length} interests but none have valid Meta IDs`;
            } else {
              detail = `${real}/${g.interests.length} valid interests`;
            }
          }
          break;
        }
        case "page_group": {
          const g = draft.audiences.pageGroups.find((x) => x.id === s.sourceId);
          if (!g) { audiencesOk = false; reason = "Group not found"; break; }
          const hasManual = (g.customAudienceIds ?? []).some(isRealId);
          const noTypes = !g.engagementTypes || g.engagementTypes.length === 0;
          if (noTypes && !hasManual) {
            audiencesOk = false;
            reason = "No engagement types selected + no custom audiences — will be ABORTED";
            detail = "Select at least one engagement type or add a custom audience";
          } else if (g.pageIds.length === 0 && !hasManual) {
            audiencesOk = false;
            reason = "No pages selected and no custom audiences";
          } else {
            detail = noTypes
              ? `Standard-only (${g.customAudienceIds?.length ?? 0} manual audiences)`
              : `${g.pageIds.length} page${g.pageIds.length !== 1 ? "s" : ""} — ${g.engagementTypes.length} type${g.engagementTypes.length !== 1 ? "s" : ""} selected`;
          }
          break;
        }
        case "custom_group": {
          const g = draft.audiences.customAudienceGroups.find((x) => x.id === s.sourceId);
          const realCount = (g?.audienceIds ?? []).filter(isRealId).length;
          if (realCount === 0) {
            audiencesOk = false;
            reason = "No valid custom audience IDs — will be ABORTED";
          } else {
            detail = `${realCount} custom audience${realCount !== 1 ? "s" : ""}`;
          }
          break;
        }
        case "lookalike_group":
        case "selected_pages_lookalike":
          detail = "Lookalike audiences created at launch (requires source audiences)";
          break;
        case "saved_audience":
          detail = isRealId(s.sourceId) ? "Saved audience" : "Invalid saved audience ID";
          if (!isRealId(s.sourceId)) { audiencesOk = false; reason = "Invalid saved audience ID"; }
          break;
      }

      return { id: s.id, name: s.name, sourceType: s.sourceType, audiencesOk, reason, detail };
    });

  const hasInterestWarnings = interestHealth.some((g) => g.empty || g.allInvalid);
  const hasPageWarnings = pageGroupHealth.some(
    (g) => g.willHaveEmptyTargeting || g.lookalikeBlocked || g.allPagesNoIg || g.fbCapFailed ||
           Object.values(g.typeHealth).some((s) => s === "cap_failed" || s === "no_ig"),
  );
  const hasAdSetWarnings = adSetHealth.some((s) => !s.audiencesOk);
  const hasAnyWarning = hasInterestWarnings || hasPageWarnings || hasAdSetWarnings;

  const criticalCount = adSetHealth.filter((s) => !s.audiencesOk).length;

  if (!hasAnyWarning && interestHealth.length === 0 && pageGroupHealth.length === 0) {
    return null;
  }

  return (
    <Card className={hasAnyWarning ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className={`h-4 w-4 shrink-0 ${hasAnyWarning ? "text-warning" : "text-success"}`} />
          <CardTitle className={`text-sm ${hasAnyWarning ? "text-warning" : "text-success"}`}>
            Pre-launch health check
          </CardTitle>
        </div>
        {criticalCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">
            {criticalCount} ad set{criticalCount !== 1 ? "s" : ""} will be aborted
          </Badge>
        )}
      </div>

      <div className="mt-3 space-y-4">
        {/* Ad set targeting health — shown first and prominently */}
        {adSetHealth.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ad Set Targeting
            </p>
            <div className="space-y-1">
              {adSetHealth.map((s) => (
                <div key={s.id} className="flex items-start gap-2">
                  {s.audiencesOk ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  )}
                  <div className="text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                      {s.sourceType.replace(/_/g, " ")}
                    </span>
                    {s.audiencesOk ? (
                      <span className="ml-1 text-muted-foreground"> — {s.detail}</span>
                    ) : (
                      <>
                        <div className="mt-0.5 font-medium text-destructive">{s.reason}</div>
                        {s.detail && <div className="text-[11px] text-muted-foreground">{s.detail}</div>}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Interest groups */}
        {interestHealth.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Interest Groups
            </p>
            <div className="space-y-1">
              {interestHealth.map((g) => (
                <div key={g.id} className="flex items-start gap-2">
                  {g.empty || g.allInvalid ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  )}
                  <span className="text-xs">
                    <span className="font-medium">{g.name}</span>
                    {g.empty ? (
                      <span className="text-warning"> — no interests added</span>
                    ) : g.allInvalid ? (
                      <span className="text-warning"> — {g.total} interests but all have invalid IDs</span>
                    ) : (
                      <span className="text-muted-foreground"> — {g.realCount}/{g.total} valid</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Page groups */}
        {pageGroupHealth.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Page Groups
            </p>
            <div className="space-y-3">
              {pageGroupHealth.map((g) => {
                const warn = g.willHaveEmptyTargeting || g.lookalikeBlocked || g.allPagesNoIg || g.fbCapFailed;
                const TYPE_LABELS: Record<string, string> = {
                  fb_likes: "FB Likes",
                  fb_engagement_365d: "FB Engagement",
                  ig_followers: "IG Followers",
                  ig_engagement_365d: "IG Engagement",
                };
                const statusIcon = (s: string) => {
                  if (s === "ok") return <span className="text-success font-medium">✓</span>;
                  if (s === "not_selected") return <span className="text-muted-foreground">—</span>;
                  return <span className="text-warning font-medium">✗</span>;
                };
                const statusNote = (key: string, s: string) => {
                  if (s === "cap_failed") return " (permission failure)";
                  if (s === "no_ig") return " (no linked IG)";
                  if (s === "not_selected") return " (not selected)";
                  return "";
                };
                return (
                  <div key={g.id} className="flex items-start gap-2">
                    {g.willHaveEmptyTargeting ? (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                    ) : warn ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    )}
                    <div className="text-xs">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-muted-foreground">
                        {" "}({g.pageCount} page{g.pageCount !== 1 ? "s" : ""})
                      </span>
                      {g.willHaveEmptyTargeting && (
                        <div className="mt-0.5 font-medium text-destructive">
                          Will be ABORTED — no engagement types selected and no custom audiences
                        </div>
                      )}
                      {/* Per-type status grid */}
                      {!g.willHaveEmptyTargeting && (
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                          {(["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"] as const).map((key) => {
                            const s = g.typeHealth[key];
                            return (
                              <span
                                key={key}
                                className={
                                  s === "ok" ? "text-success" :
                                  s === "not_selected" ? "text-muted-foreground/60" :
                                  "text-warning"
                                }
                              >
                                {statusIcon(s)} {TYPE_LABELS[key]}{statusNote(key, s)}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {!g.noTypesSelected && g.lookalikeBlocked && (
                        <div className="mt-0.5 text-[11px] text-warning">
                          ✗ Lookalikes blocked — no types predicted to succeed
                        </div>
                      )}
                      {g.noTypesSelected && g.hasManualAudiences && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Standard-only (manual audiences selected)
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Retry lookalikes panel ────────────────────────────────────────────────────

function RetryLookalikesPanel({ draft }: { draft: CampaignDraft }) {
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
      const data = await res.json() as typeof result & { error?: string };
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
      <p className="text-xs text-amber-700 mb-3">
        Meta needs time to build the source engagement audiences before lookalikes can be created.
        Come back in a few minutes and use the button below to retry.
      </p>

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
                <p key={c.id} className="text-xs text-success flex items-center gap-1">
                  <CheckCheck className="h-3 w-3 inline" />
                  {c.name} created · ID {c.id}
                </p>
              ))}
            </div>
          )}
          {result.deferred.length > 0 && (
            <div className="space-y-0.5">
              {result.deferred.map((d, i) => (
                <p key={i} className="text-xs text-amber-600 flex items-center gap-1">
                  <Clock className="h-3 w-3 inline" />
                  {d.name} still populating (code {d.code}) — try again later
                </p>
              ))}
            </div>
          )}
          {result.failed.length > 0 && (
            <div className="space-y-0.5">
              {result.failed.map((f, i) => (
                <p key={i} className="text-xs text-destructive flex items-center gap-1">
                  <TriangleAlert className="h-3 w-3 inline" />
                  {f.name} failed: {f.error}
                </p>
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
          <p className="text-xs text-destructive">Request failed. Check console for details.</p>
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
  onDismissLaunchError,
  launchSummary,
  onGoToLibrary,
  onUpdateSettings,
}: ReviewLaunchProps) {
  const allValidation = validateStep(7, draft);
  const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);
  const bs = draft.budgetSchedule;
  const wizardMode = draft.settings.wizardMode ?? "new";
  const isAttachAdSet = wizardMode === "attach_adset";

  // Multi-select existing ad sets (with legacy fallback). Used by the
  // attach_adset summary card + the assignment summary section.
  const attachedAdSetSnapshots =
    draft.settings.existingMetaAdSets ??
    (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);

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

  const days = useMemo(() => {
    if (!bs.startDate || !bs.endDate) return 0;
    return Math.ceil(
      (new Date(bs.endDate).getTime() - new Date(bs.startDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
  }, [bs.startDate, bs.endDate]);

  const totalDaily = enabledSets.reduce((sum, s) => sum + s.budgetPerDay, 0);
  const totalAds = Object.values(draft.creativeAssignments).reduce(
    (sum, ids) => sum + ids.length,
    0,
  );

  const newAdCount = draft.creatives.filter(
    (c) => (c.sourceType ?? "new") === "new",
  ).length;
  const postAdCount = draft.creatives.filter(
    (c) => (c.sourceType ?? "new") === "existing_post",
  ).length;
  const totalVariations = draft.creatives.reduce(
    (sum, c) =>
      sum +
      ((c.sourceType ?? "new") === "new" ? (c.assetVariations ?? []).length : 0),
    0,
  );

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
        <h2 className="font-heading text-2xl tracking-wide">Review & Launch</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your campaign configuration before launching.
        </p>
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
                  <p className="font-heading text-lg tracking-wide">Launching…</p>
                </>
              ) : hasFailures ? (
                <>
                  <TriangleAlert className="h-5 w-5 text-warning" />
                  <p className="font-heading text-lg tracking-wide">Partially launched</p>
                </>
              ) : (
                <>
                  <Rocket className="h-5 w-5 text-success" />
                  <p className="font-heading text-lg tracking-wide text-success">
                    Campaign created
                  </p>
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
                <p className="text-xs text-muted-foreground">
                  Total launch time: {(launchSummary.totalDurationMs / 1000).toFixed(1)}s
                </p>
              )}

              {/* App mode blocking banner */}
              {appModeBlockedCreatives.length > 0 && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <div className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">
                        {allCreativesBlocked
                          ? "Campaign structure created — creatives not launched"
                          : `${appModeBlockedCreatives.length} creative${appModeBlockedCreatives.length !== 1 ? "s" : ""} blocked by Meta app mode`}
                      </p>
                      <p className="mt-1 text-xs text-destructive/80">
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
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Retry lookalikes panel — shown when lookalikes were deferred */}
          {launchSummary && (launchSummary.lookalikesDeferred?.length ?? 0) > 0 && (
            <RetryLookalikesPanel draft={draft} />
          )}

          {onGoToLibrary && launchSummary && (
            <div className="mt-4 flex justify-end">
              <Button onClick={onGoToLibrary}>
                Go to Campaign Library
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Validation */}
      {allValidation.errors.length > 0 ? (
        <Card className="border-warning bg-warning/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div>
              <CardTitle className="text-warning">Validation Warnings</CardTitle>
              <ul className="mt-2 space-y-1">
                {allValidation.errors.map((err, i) => (
                  <li key={i} className="text-sm text-warning">
                    • {err}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="border-success bg-success/10">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span className="text-sm font-medium text-success">
              All steps validated. Ready to launch.
            </span>
          </div>
        </Card>
      )}

      {/* Pre-launch health — only before first launch */}
      {!launchSummary && !isLaunching && <PreLaunchHealthCard draft={draft} />}

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
              <p className="mt-1 text-xs text-muted-foreground">
                Publish ads exactly as uploaded. Disables AI enhancements and
                automatic creative changes — no Advantage+, no music, no auto
                sitelinks, no dynamic creative, no catalog attachments.
              </p>
              {!creativeIntegrityMode && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  Meta may automatically apply Advantage+ enhancements to your
                  creatives.
                </p>
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

      {/* Campaign Summary */}
      <Card>
        <CardTitle>
          {wizardMode === "attach_adset"
            ? `Adding ads to ${attachedAdSetSnapshots.length === 1 ? "existing ad set" : `${attachedAdSetSnapshots.length} existing ad sets`}`
            : "Campaign Summary"}
        </CardTitle>
        {wizardMode === "attach_adset" &&
        draft.settings.existingMetaCampaign &&
        attachedAdSetSnapshots.length > 0 ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              This launch will only create new ads — no campaign or ad set will
              be created. These ads will inherit each selected ad set&rsquo;s
              existing{" "}
              <span className="font-medium text-foreground">
                audience, budget, schedule and optimisation
              </span>{" "}
              settings.
            </p>
            <div className="divide-y divide-border">
              <SummaryRow
                label="Existing Campaign"
                value={draft.settings.existingMetaCampaign.name}
              />
              <SummaryRow
                label="Campaign ID"
                value={draft.settings.existingMetaCampaign.id}
              />
              <SummaryRow
                label="Ad Account"
                value={adAccountId ? adAccountId.replace(/^act_/, "") : "—"}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Selected ad sets ({attachedAdSetSnapshots.length})
              </p>
              <ul className="space-y-2">
                {attachedAdSetSnapshots.map((adSet) => (
                  <li
                    key={adSet.id}
                    className="rounded-md border border-border bg-muted/30 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {adSet.name}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {adSet.effectiveStatus ?? adSet.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {adSet.id}
                      </code>
                      {adSet.optimizationGoal && (
                        <span>
                          Optimisation:{" "}
                          {adSet.optimizationGoal.replace(/_/g, " ")}
                        </span>
                      )}
                      {adSet.billingEvent && (
                        <span>
                          Billing: {adSet.billingEvent.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    {adSet.targetingSummary && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {adSet.targetingSummary}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : wizardMode === "attach_campaign" && draft.settings.existingMetaCampaign ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              This launch will create <span className="font-medium text-foreground">1 new ad set</span> and its ads under an
              existing campaign in your ad account. The campaign itself will not be modified.
            </p>
            <div className="divide-y divide-border">
              <SummaryRow
                label="Existing Campaign"
                value={draft.settings.existingMetaCampaign.name}
              />
              <SummaryRow
                label="Campaign ID"
                value={draft.settings.existingMetaCampaign.id}
              />
              <SummaryRow
                label="Objective"
                value={
                  draft.settings.objective.charAt(0).toUpperCase() +
                  draft.settings.objective.slice(1) +
                  ` (${draft.settings.existingMetaCampaign.objective})`
                }
              />
              <SummaryRow
                label="Optimisation"
                value={draft.settings.optimisationGoal.replace(/_/g, " ")}
              />
              <SummaryRow
                label="Ad Account"
                value={adAccountId ? adAccountId.replace(/^act_/, "") : "—"}
              />
            </div>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-border">
            <SummaryRow label="Campaign" value={draft.settings.campaignName} />
            <SummaryRow label="Code" value={draft.settings.campaignCode} />
            <SummaryRow
              label="Objective"
              value={
                draft.settings.objective.charAt(0).toUpperCase() +
                draft.settings.objective.slice(1)
              }
            />
            <SummaryRow
              label="Optimisation"
              value={draft.settings.optimisationGoal.replace(/_/g, " ")}
            />
            <SummaryRow
              label="Ad Account"
              value={adAccountId ? adAccountId.replace(/^act_/, "") : "—"}
            />
          </div>
        )}
      </Card>

      {/* Optimisation Strategy Summary — hidden in attach_adset mode (inherited) */}
      {!isAttachAdSet && (
      <Card>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle>Optimisation Strategy</CardTitle>
          <Badge
            variant={
              draft.optimisationStrategy?.mode === "none" ? "default" : "success"
            }
          >
            {draft.optimisationStrategy?.mode === "none"
              ? "Manual"
              : draft.optimisationStrategy?.mode === "benchmarks"
                ? "Benchmark Rules"
                : "Custom Rules"}
          </Badge>
        </div>
        {draft.optimisationStrategy?.mode !== "none" &&
        (draft.optimisationStrategy?.rules ?? []).length > 0 ? (
          <div className="mt-3 space-y-2">
            {(draft.optimisationStrategy?.rules ?? [])
              .filter((r) => r.enabled)
              .map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-lg border px-3 py-2 ${
                    rule.priority === "primary"
                      ? "border-primary/30"
                      : rule.priority === "secondary"
                        ? "border-warning/20"
                        : "border-border"
                  }`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {rule.priority && (
                      <Badge
                        variant={
                          rule.priority === "primary" ? "primary" : "warning"
                        }
                        className="text-[10px] uppercase tracking-wider"
                      >
                        {rule.priority}
                      </Badge>
                    )}
                    <span className="text-sm font-medium">{rule.name}</span>
                    <Badge variant="outline">{METRIC_LABELS[rule.metric]}</Badge>
                    <Badge variant="outline">
                      {TIME_WINDOW_LABELS[rule.timeWindow]}
                    </Badge>
                    {rule.useOverride && rule.campaignTargetValue != null && (
                      <Badge variant="warning" className="text-[10px]">
                        Target:{" "}
                        {rule.metric === "roas" ? "" : "£"}
                        {rule.campaignTargetValue}
                        {rule.metric === "roas" ? "×" : ""}
                      </Badge>
                    )}
                  </div>
                  {rule.useOverride &&
                    rule.accountBenchmarkValue != null &&
                    rule.campaignTargetValue != null && (
                      <p className="mb-0.5 text-xs text-warning">
                        Account:{" "}
                        {rule.metric === "roas" ? "" : "£"}
                        {rule.accountBenchmarkValue}
                        {rule.metric === "roas" ? "×" : ""} → Campaign:{" "}
                        {rule.metric === "roas" ? "" : "£"}
                        {rule.campaignTargetValue}
                        {rule.metric === "roas" ? "×" : ""}
                      </p>
                    )}
                  <div className="space-y-0.5">
                    {rule.thresholds.map((t) => (
                      <p key={t.id} className="text-xs text-muted-foreground">
                        {t.label}
                      </p>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {draft.optimisationStrategy?.mode === "none"
              ? "No automated rules — manual optimisation only."
              : "No rules configured."}
          </p>
        )}

        {/* Guardrails summary */}
        {draft.optimisationStrategy?.guardrails &&
          draft.optimisationStrategy.mode !== "none" &&
          (() => {
            const g = draft.optimisationStrategy.guardrails;
            const sym =
              bs.currency === "GBP"
                ? "£"
                : bs.currency === "USD"
                  ? "$"
                  : bs.currency === "EUR"
                    ? "€"
                    : bs.currency;
            const behaviourLabel =
              g.ceilingBehaviour === "stop"
                ? "Stop increases"
                : g.ceilingBehaviour === "partial"
                  ? "Partially apply"
                  : "Pause scaling";
            return (
              <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Budget Guardrails
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  <SummaryRow
                    label="Base budget"
                    value={`${sym}${g.baseCampaignBudget.toLocaleString()}`}
                  />
                  <SummaryRow
                    label="Max expansion"
                    value={`${g.maxExpansionPercent}%`}
                  />
                  <SummaryRow
                    label="Hard ceiling"
                    value={`${sym}${g.hardBudgetCeiling.toLocaleString()}`}
                  />
                  <SummaryRow label="At ceiling" value={behaviourLabel} />
                  {g.maxDailyIncreasePercent != null && (
                    <SummaryRow
                      label="Max daily increase"
                      value={`+${g.maxDailyIncreasePercent}%`}
                    />
                  )}
                  {g.cooldownHours != null && (
                    <SummaryRow
                      label="Cooldown"
                      value={`${g.cooldownHours}h`}
                    />
                  )}
                </div>
              </div>
            );
          })()}
      </Card>
      )}

      {/* Audience Summary — hidden in attach_adset mode (inherited) */}
      {!isAttachAdSet && (
      <Card>
        <CardTitle>Audience Summary</CardTitle>
        <div className="mt-3 space-y-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Page Groups ({draft.audiences.pageGroups.length})
            </span>
            {draft.audiences.pageGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.pageGroups.map((g) => (
                  <Badge key={g.id} variant="primary">
                    {g.name || "Untitled"} ({g.pageIds.length} pages)
                    {g.customAudienceIds.length > 0 &&
                      ` + ${g.customAudienceIds.length} custom`}
                    {g.lookalike && ` · ${(g.lookalikeRanges ?? []).join(", ") || "0-1%"} LAL`}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None</p>
            )}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Custom Audience Groups ({draft.audiences.customAudienceGroups.length})
            </span>
            {draft.audiences.customAudienceGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.customAudienceGroups.map((g) => (
                  <Badge key={g.id} variant="warning">
                    {g.name || "Untitled"} ({g.audienceIds.length})
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None</p>
            )}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved Audiences ({draft.audiences.savedAudiences.audienceIds.length})
            </span>
            {draft.audiences.savedAudiences.audienceIds.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.savedAudiences.audienceIds.map((id) => (
                  <Badge key={id} variant="default">
                    {id}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None</p>
            )}
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Interest Groups ({draft.audiences.interestGroups.length})
            </span>
            {draft.audiences.interestGroups.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {draft.audiences.interestGroups.map((g) => (
                  <Badge key={g.id} variant="default">
                    {g.name || "Untitled"} ({g.interests.length} interests)
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">None</p>
            )}
          </div>
        </div>
      </Card>
      )}

      {/* Creatives Summary */}
      <Card>
        <div className="flex items-center gap-2">
          <CardTitle>Ads ({draft.creatives.length})</CardTitle>
          {newAdCount > 0 && <Badge variant="primary">{newAdCount} new</Badge>}
          {postAdCount > 0 && (
            <Badge variant="warning">{postAdCount} existing post</Badge>
          )}
          {totalVariations > 0 && (
            <Badge variant="outline">{totalVariations} asset variations</Badge>
          )}
        </div>
        {draft.creatives.length > 0 ? (
          <div className="mt-3 space-y-2">
            {draft.creatives.map((c, i) => {
              const varCount =
                (c.sourceType ?? "new") === "new"
                  ? (c.assetVariations ?? []).length
                  : 0;
              const captionCount = (c.captions ?? []).length;
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      #{i + 1}
                    </span>
                    <span className="text-sm font-medium">{c.name || "Untitled"}</span>
                    {c.identity?.pageId && (
                      <span className="text-xs text-muted-foreground">
                        · Page {c.identity.pageId}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        (c.sourceType ?? "new") === "existing_post"
                          ? "warning"
                          : "primary"
                      }
                    >
                      {(c.sourceType ?? "new") === "existing_post"
                        ? "post"
                        : (c.assetMode ?? "dual")}
                    </Badge>
                    {(c.sourceType ?? "new") === "new" && (
                      <>
                        <Badge variant="outline">{varCount} var</Badge>
                        {captionCount > 1 && (
                          <Badge variant="outline">{captionCount} captions</Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No ads added.</p>
        )}

        {/* Enhancements policy */}
        <div className="mt-3 flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2">
          <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            All Meta AI creative enhancements are OFF
          </span>
        </div>
      </Card>

      {/* Budget Breakdown — hidden in attach_adset mode (inherited) */}
      {!isAttachAdSet && (
      <Card>
        <CardTitle>Budget & Schedule</CardTitle>
        <div className="mt-3 divide-y divide-border">
          <SummaryRow
            label="Budget Type"
            value={`${bs.budgetType === "daily" ? "Daily" : "Lifetime"} · ${bs.budgetLevel === "ad_set" ? "Ad Set Level" : "CBO"}`}
          />
          <SummaryRow
            label="Daily Total"
            value={`${bs.currency} ${totalDaily.toFixed(2)}/day`}
          />
          <SummaryRow label="Duration" value={days > 0 ? `${days} days` : "—"} />
          <SummaryRow
            label="Total Estimated Spend"
            value={
              days > 0 ? `${bs.currency} ${(totalDaily * days).toFixed(2)}` : "—"
            }
          />
        </div>
        {enabledSets.length > 0 && (
          <div className="mt-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per Ad Set
            </span>
            <div className="mt-1 space-y-1">
              {enabledSets.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{s.name}</span>
                  <span className="font-medium">
                    {bs.currency} {s.budgetPerDay.toFixed(2)}/day
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
      )}

      {/* Assignment Summary */}
      <Card>
        <CardTitle>Assignment Summary</CardTitle>
        {isAttachAdSet && attachedAdSetSnapshots.length > 0 ? (
          <div className="mt-3 space-y-3">
            <div className="divide-y divide-border">
              <SummaryRow
                label="Selected ad sets"
                value={String(attachedAdSetSnapshots.length)}
              />
              <SummaryRow label="Ads" value={String(draft.creatives.length)} />
              <SummaryRow label="Total Assigned" value={String(totalAds)} />
            </div>
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Per ad set
              </p>
              <ul className="space-y-1.5 text-xs">
                {attachedAdSetSnapshots.map((adSet) => {
                  const key = `attached:${adSet.id}`;
                  const assignedIds = draft.creativeAssignments[key] ?? [];
                  const ads = draft.creatives.filter((c) =>
                    assignedIds.includes(c.id),
                  );
                  return (
                    <li
                      key={adSet.id}
                      className="flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {adSet.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {ads.length === 0
                            ? "no ads assigned"
                            : ads
                                .map((c, i) => c.name?.trim() || `Ad #${i + 1}`)
                                .join(", ")}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {ads.length} ad{ads.length !== 1 ? "s" : ""}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-border">
            <SummaryRow label="Ad Sets" value={String(enabledSets.length)} />
            <SummaryRow label="Ads" value={String(draft.creatives.length)} />
            <SummaryRow label="Total Assigned" value={String(totalAds)} />
          </div>
        )}
      </Card>

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
                  <p className="font-heading text-lg tracking-wide">
                    Launch Failed
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Meta returned an error. Your draft has not been changed.
                  </p>
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
              <p className="text-sm text-destructive">{launchError}</p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              {onDismissLaunchError && (
                <>
                  <Button variant="outline" onClick={onDismissLaunchError}>
                    Go Back
                  </Button>
                  <Button variant="outline" onClick={onDismissLaunchError}>
                    Retry
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
