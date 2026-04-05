"use client";

import React, { useMemo, useEffect } from "react";
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
} from "lucide-react";
import type { CampaignDraft, LaunchSummary } from "@/lib/types";
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
}

// ── Launch event types ────────────────────────────────────────────────────────

type EventStatus = "success" | "failed" | "skipped" | "warning" | "pending";
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
function buildLaunchEvents(summary: LaunchSummary): LaunchEvent[] {
  let seq = 0;
  const uid = (prefix: string) => `${prefix}-${seq++}`;
  const events: LaunchEvent[] = [];

  // Preflight warnings
  if (summary.preflightWarnings?.length) {
    for (const w of summary.preflightWarnings) {
      events.push({
        id: uid("pf"),
        stage: "preflight",
        entity: w.stage,
        status: "warning",
        label: "Preflight",
        detail: w.message,
      });
    }
  }

  // Campaign
  events.push({
    id: uid("campaign"),
    stage: "campaign",
    entity: "Campaign",
    status: "success",
    label: `Campaign created`,
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
    events.push({
      id: uid("cr-fail"),
      stage: "creative",
      entity: c.name,
      status: c.skippedReason ? "skipped" : "failed",
      label: c.skippedReason ? `Creative skipped — ${c.skippedReason}` : "Creative failed",
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
  const lalOk = summary.lookalikeAudiencesCreated?.length ?? 0;
  const lalFail = summary.lookalikeAudiencesFailed?.length ?? 0;
  const lalSkipped = summary.lookalikeAudiencesFailed?.filter((f) => f.skippedReason).length ?? 0;
  const asSkipped = summary.adSetsFailed.filter((f) => f.skippedReason).length;
  const crSkipped = summary.creativesFailed.filter((f) => f.skippedReason).length;

  return (
    <div className="flex flex-wrap gap-2">
      <CountChip ok={1} failed={0} label="Campaign" />
      {(eaOk + eaFail > 0) && <CountChip ok={eaOk} failed={eaFail} label="Audiences" />}
      {(lalOk + lalFail > 0) && <CountChip ok={lalOk} failed={lalFail - lalSkipped} skipped={lalSkipped} label="Lookalikes" />}
      <CountChip ok={summary.adSetsCreated.length} failed={summary.adSetsFailed.length - asSkipped} skipped={asSkipped} label="Ad Sets" />
      <CountChip ok={summary.creativesCreated.length} failed={summary.creativesFailed.length - crSkipped} skipped={crSkipped} label="Creatives" />
      <CountChip ok={summary.adsCreated} failed={summary.adsFailed} label="Ads" />
      {(summary.interestReplacements?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1.5 rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-xs">
          <span className="font-medium text-warning">↻ {summary.interestReplacements!.length} deprecated interest{summary.interestReplacements!.length !== 1 ? "s" : ""} handled</span>
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

function PreLaunchHealthCard({ draft }: { draft: CampaignDraft }) {
  const cachedPages = getCachedUserPages();

  // ── Interest group health ────────────────────────────────────────────────
  const interestHealth = draft.audiences.interestGroups.map((g) => ({
    id: g.id,
    name: g.name || "Untitled",
    count: g.interests.length,
    empty: g.interests.length === 0,
  }));

  // ── Page group health ─────────────────────────────────────────────────────
  const pageGroupHealth = draft.audiences.pageGroups.map((g) => {
    const isStandardOnly = g.createEngagementAudiences === false;

    // If all selected pages have no IG, IG source audiences will be skipped
    const selectedPages = g.pageIds
      .map((id) => cachedPages.find((p) => p.id === id))
      .filter(Boolean);

    const noIgPages = selectedPages.filter((p) => {
      if (!p) return false;
      const caps = p.capabilities;
      if (caps?.igFollowersSource === false) return true;
      return !(p.hasInstagramLinked ?? !!p.instagram_business_account?.id);
    });
    const allPagesNoIg = selectedPages.length > 0 && noIgPages.length === selectedPages.length;
    const fbCapFailed =
      selectedPages.some((p) => p?.capabilities?.fbLikesSource === false) ||
      selectedPages.some((p) => p?.capabilities?.fbEngagementSource === false);

    const lookalikesExpected = g.lookalike && !isStandardOnly;
    const lookalikeBlocked =
      lookalikesExpected &&
      (allPagesNoIg || fbCapFailed || selectedPages.some((p) => p?.capabilities?.lookalikeEligible === false));

    return {
      id: g.id,
      name: g.name || "Untitled",
      pageCount: g.pageIds.length,
      isStandardOnly,
      lookalikesExpected,
      lookalikeBlocked,
      allPagesNoIg,
      fbCapFailed,
    };
  });

  const hasInterestWarnings = interestHealth.some((g) => g.empty);
  const hasPageWarnings = pageGroupHealth.some(
    (g) => g.isStandardOnly || g.lookalikeBlocked || g.allPagesNoIg || g.fbCapFailed,
  );
  const hasAnyWarning = hasInterestWarnings || hasPageWarnings;

  if (!hasAnyWarning && interestHealth.length === 0 && pageGroupHealth.length === 0) {
    return null;
  }

  return (
    <Card className={hasAnyWarning ? "border-warning/40 bg-warning/5" : "border-success/40 bg-success/5"}>
      <div className="flex items-center gap-2">
        <Info className={`h-4 w-4 shrink-0 ${hasAnyWarning ? "text-warning" : "text-success"}`} />
        <CardTitle className={`text-sm ${hasAnyWarning ? "text-warning" : "text-success"}`}>
          Pre-launch health check
        </CardTitle>
      </div>

      <div className="mt-3 space-y-3">
        {/* Interest groups */}
        {interestHealth.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Interest Groups
            </p>
            <div className="space-y-1">
              {interestHealth.map((g) => (
                <div key={g.id} className="flex items-start gap-2">
                  {g.empty ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  )}
                  <span className="text-xs">
                    <span className="font-medium">{g.name}</span>
                    {g.empty ? (
                      <span className="text-warning"> — no interests added, will use broad targeting</span>
                    ) : (
                      <span className="text-muted-foreground"> — {g.count} interest{g.count !== 1 ? "s" : ""}</span>
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
            <div className="space-y-2">
              {pageGroupHealth.map((g) => {
                const warn = g.isStandardOnly || g.lookalikeBlocked || g.allPagesNoIg || g.fbCapFailed;
                return (
                  <div key={g.id} className="flex items-start gap-2">
                    {warn ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                    )}
                    <div className="text-xs">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-muted-foreground">
                        {" "}({g.pageCount} page{g.pageCount !== 1 ? "s" : ""})
                      </span>
                      {g.isStandardOnly && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="text-success">✓ Standard targeting</span>
                          <span className="text-warning">✗ Engagement source audiences disabled</span>
                          {g.lookalikesExpected && (
                            <span className="text-warning">✗ Lookalikes disabled (no engagement source)</span>
                          )}
                        </div>
                      )}
                      {!g.isStandardOnly && g.allPagesNoIg && (
                        <div className="mt-0.5 text-[11px] text-warning">
                          No linked Instagram — IG source audiences will be skipped
                        </div>
                      )}
                      {!g.isStandardOnly && g.fbCapFailed && (
                        <div className="mt-0.5 text-[11px] text-warning">
                          FB source audience permission failures recorded from a previous launch
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

export function ReviewLaunch({
  draft,
  isLaunching = false,
  launchError,
  onDismissLaunchError,
  launchSummary,
  onGoToLibrary,
}: ReviewLaunchProps) {
  const allValidation = validateStep(7, draft);
  const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);
  const bs = draft.budgetSchedule;

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
    if (launchSummary) return buildLaunchEvents(launchSummary);
    return [];
  }, [isLaunching, launchSummary]);

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
            </div>
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

      {/* Campaign Summary */}
      <Card>
        <CardTitle>Campaign Summary</CardTitle>
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
      </Card>

      {/* Optimisation Strategy Summary */}
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

      {/* Audience Summary */}
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

      {/* Budget Breakdown */}
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

      {/* Assignment Summary */}
      <Card>
        <CardTitle>Assignment Summary</CardTitle>
        <div className="mt-3 divide-y divide-border">
          <SummaryRow label="Ad Sets" value={String(enabledSets.length)} />
          <SummaryRow label="Ads" value={String(draft.creatives.length)} />
          <SummaryRow label="Total Assigned" value={String(totalAds)} />
        </div>
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
