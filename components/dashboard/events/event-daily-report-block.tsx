"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, RefreshCw, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import { EventSummaryHeader } from "@/components/dashboard/events/event-summary-header";
import { EventTrendChart } from "@/components/dashboard/events/event-trend-chart";
import { DailyTracker } from "@/components/dashboard/events/daily-tracker";

/**
 * components/dashboard/events/event-daily-report-block.tsx
 *
 * Top-level wrapper that renders the three-piece event report block:
 * a single-event summary header (mirrors the WC venue Total row),
 * a daily trend chart with metric pill toggles, and the existing
 * daily tracker table at the bottom.
 *
 * Owns the data lifecycle (fetch + sync) so all three children render
 * from a single source of truth — keeping numbers identical between
 * the summary, the chart, and the table. The DailyTracker still
 * supports its uncontrolled mode (used elsewhere); this block always
 * drives it via the `controlled` prop so we don't double-fetch.
 *
 * Two render modes:
 *   - `mode="dashboard"` (default): the page is the authenticated
 *     event detail. Refresh button + auto-sync-on-mount + notes
 *     editing are wired through to the existing /api/ticketing/*
 *     routes.
 *   - `mode="share"`: the public report token route. Data arrives
 *     pre-loaded via `initialTimeline` and any sync controls are
 *     suppressed (the share token is read-only — operators sync from
 *     inside the dashboard).
 *
 * Empty-state guard mirrors the original DailyTracker: when the event
 * has no Meta scope AND no Eventbrite link, the block collapses to
 * the lightweight "connect a source" CTA and skips fetching entirely.
 */

interface PresaleBucketShape {
  cutoffDate: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  daysCount: number;
  earliestDate: string | null;
}

interface RollupResponse {
  ok: boolean;
  timeline?: TimelineRow[];
  presale?: PresaleBucketShape | null;
  generalSaleAt?: string | null;
  error?: string;
}

interface SyncResponse {
  ok: boolean;
  meta?: { ok: boolean; rowsWritten?: number; error?: string; reason?: string };
  eventbrite?: {
    ok: boolean;
    rowsWritten?: number;
    error?: string;
    reason?: string;
  };
  error?: string;
}

interface EventLike {
  id: string;
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  general_sale_at: string | null;
}

interface DashboardProps {
  mode?: "dashboard";
  event: EventLike;
  hasMetaScope: boolean;
  hasEventbriteLink: boolean;
  /** Optional pre-loaded data for first paint (avoids the fetch
   *  flicker on the dashboard event page). When omitted, the block
   *  loads on mount. */
  initialTimeline?: TimelineRow[];
  initialPresale?: PresaleBucketShape | null;
}

interface ShareProps {
  mode: "share";
  event: EventLike;
  hasMetaScope: boolean;
  hasEventbriteLink: boolean;
  /** Required on share: the public page server-loads everything. */
  initialTimeline: TimelineRow[];
  initialPresale: PresaleBucketShape | null;
}

type Props = DashboardProps | ShareProps;

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function EventDailyReportBlock(props: Props) {
  const { event, hasMetaScope, hasEventbriteLink } = props;
  const isShare = props.mode === "share";

  const [timeline, setTimeline] = useState<TimelineRow[]>(
    () => props.initialTimeline ?? [],
  );
  const [presale, setPresale] = useState<PresaleBucketShape | null>(
    () => props.initialPresale ?? null,
  );
  // Loading is true on the dashboard if no initial data; share always
  // arrives with data, so loading starts false there.
  const [loading, setLoading] = useState(
    !isShare && (props.initialTimeline === undefined),
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legErrors, setLegErrors] = useState<{
    meta?: string;
    eventbrite?: string;
  } | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  const refresh = useCallback(async () => {
    if (isShare) return; // share never refetches; token is the credential
    const res = await fetch(
      `/api/ticketing/rollup?eventId=${encodeURIComponent(event.id)}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as RollupResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Failed to load rollup data.");
    }
    setTimeline(json.timeline ?? []);
    setPresale(json.presale ?? null);
  }, [event.id, isShare]);

  const syncNow = useCallback(async () => {
    if (isShare) return;
    setSyncing(true);
    setError(null);
    setLegErrors(null);
    try {
      const res = await fetch(
        `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(event.id)}`,
        { method: "POST" },
      );
      const json = (await res.json()) as SyncResponse;
      // 207 = partial success: surface per-leg errors but still
      // refresh so whichever leg succeeded lands its rows.
      if (!res.ok && res.status !== 207) {
        throw new Error(json.error ?? "Sync failed.");
      }
      const lErrs: { meta?: string; eventbrite?: string } = {};
      if (json.meta && !json.meta.ok && json.meta.error) {
        lErrs.meta = json.meta.error;
      }
      if (json.eventbrite && !json.eventbrite.ok && json.eventbrite.error) {
        lErrs.eventbrite = json.eventbrite.error;
      }
      if (lErrs.meta || lErrs.eventbrite) setLegErrors(lErrs);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setSyncing(false);
    }
  }, [event.id, refresh, isShare]);

  // Initial load — dashboard only, only when no initial data was
  // server-prefetched.
  useEffect(() => {
    if (isShare) return;
    if (props.initialTimeline !== undefined) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, isShare, props.initialTimeline]);

  // Auto-sync on mount when stale or empty (dashboard only).
  useEffect(() => {
    if (isShare) return;
    if (autoTried || loading) return;
    if (!hasMetaScope && !hasEventbriteLink) return;
    const stale = isStaleTimeline(timeline);
    if (timeline.length > 0 && !stale) return;
    setAutoTried(true);
    void syncNow();
  }, [
    autoTried,
    loading,
    timeline,
    syncNow,
    hasMetaScope,
    hasEventbriteLink,
    isShare,
  ]);

  const controlled = useMemo(
    () => ({
      timeline,
      presale,
      syncing,
      error,
      legErrors,
      onSync: syncNow,
      readOnly: isShare,
    }),
    [timeline, presale, syncing, error, legErrors, syncNow, isShare],
  );

  // Empty-state shortcut — same gating as the original DailyTracker.
  if (!hasMetaScope && !hasEventbriteLink) {
    return (
      <section className="rounded-md border border-dashed border-border bg-muted/20 p-5">
        <div className="flex items-start gap-3">
          <TrendingUp className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="font-heading text-base tracking-wide">
              Event reporting
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect Meta campaign or Eventbrite event to start tracking.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg tracking-wide">
          Event reporting
        </h2>
        {!isShare && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void syncNow()}
            disabled={syncing || loading}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh all
          </Button>
        )}
      </div>

      {error ? (
        <p className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
      {legErrors?.meta ? (
        <p className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Meta: {legErrors.meta}
        </p>
      ) : null}
      {legErrors?.eventbrite ? (
        <p className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Eventbrite: {legErrors.eventbrite}
        </p>
      ) : null}

      <EventSummaryHeader event={event} timeline={timeline} />
      <EventTrendChart timeline={timeline} />
      <DailyTracker
        eventId={event.id}
        hasMetaScope={hasMetaScope}
        hasEventbriteLink={hasEventbriteLink}
        controlled={controlled}
      />
    </div>
  );
}

function isStaleTimeline(rows: TimelineRow[]): boolean {
  if (rows.length === 0) return true;
  let newest = 0;
  for (const r of rows) {
    if (!r.freshness_at) continue;
    const t = new Date(r.freshness_at).getTime();
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!newest) return true;
  return Date.now() - newest > STALE_THRESHOLD_MS;
}
