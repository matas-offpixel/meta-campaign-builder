"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import {
  additionalSpendBreakdownLinesByDate,
  additionalSpendTotalsByDate,
} from "@/lib/db/additional-spend-sum";
import { trimTimelineForTrackerDisplay } from "@/lib/dashboard/trim-timeline-for-tracker-display";
import { ADDITIONAL_SPEND_CHANGED } from "@/components/dashboard/events/additional-spend-card";
import {
  EventSummaryHeader,
  type PerformanceSummaryTimeframe,
} from "@/components/dashboard/events/event-summary-header";
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
  tiktok_spend: number | null;
  tiktok_clicks: number | null;
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

interface SyncSummary {
  metaOk: boolean;
  metaError: string | null;
  metaReason: string | null;
  metaRowsUpserted: number;
  eventbriteOk: boolean;
  eventbriteError: string | null;
  eventbriteReason: string | null;
  eventbriteRowsUpserted: number;
  allocatorOk?: boolean | null;
  allocatorError?: string | null;
  allocatorReason?: string | null;
  allocatorRowsUpserted?: number;
  allocatorClassErrors?: number;
  rowsUpserted: number;
  /** PR #121 semantic success signal — treats `not_linked`,
   *  `no_event_code`, `no_ad_account` skips as success. Older
   *  servers won't return this; the consumer falls back to `ok`. */
  synced?: boolean;
}

interface SyncDiagnostics {
  metaAdAccountId: string | null;
  metaCodeBracketed: string | null;
  metaCampaignsMatched: string[];
  metaDaysReturned: number;
  metaRowsAttempted: number;
  eventbriteTokenKeyPresent: boolean;
  eventbriteLinksCount: number;
  eventbriteEventIds: string[];
  eventbriteRowsAttempted: number;
  windowSince: string;
  windowUntil: string;
  eventTimezone: string | null;
}

interface SyncResponse {
  ok: boolean;
  summary?: SyncSummary;
  /** Legacy per-leg shape kept for older clients — same data as
   *  `summary` but in the original {meta,eventbrite} object form. */
  meta?: { ok: boolean; rowsWritten?: number; error?: string; reason?: string };
  eventbrite?: {
    ok: boolean;
    rowsWritten?: number;
    error?: string;
    reason?: string;
  };
  diagnostics?: SyncDiagnostics;
  error?: string;
}

interface LastSync {
  /** ISO timestamp of when the sync request resolved (success OR
   *  failure — both are valuable to display). */
  at: string;
  /** Whether the response indicated overall success. */
  ok: boolean;
  /** Top-level error string when the request itself blew up (vs. a
   *  per-leg error, which lives on `summary`). */
  topLevelError: string | null;
  summary: SyncSummary | null;
  diagnostics: SyncDiagnostics | null;
}

interface EventLike {
  id: string;
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  general_sale_at: string | null;
  capacity?: number | null;
  event_date?: string | null;
  /** First-paint cadence for the embedded DailyTracker — comes from
   *  `events.report_cadence` (migration 040). Optional so legacy
   *  callers that haven't been re-wired keep defaulting to 'daily'. */
  report_cadence?: "daily" | "weekly";
}

const DEFAULT_PERF_SUMMARY: PerformanceSummaryTimeframe = {
  datePreset: "maximum",
  metaSpend: null,
  ticketsInWindow: null,
};

interface DashboardProps {
  mode?: "dashboard";
  event: EventLike;
  hasMetaScope: boolean;
  hasEventbriteLink: boolean;
  /** Mirrors Meta timeframe pill + windowed tickets/spend for Performance summary. */
  performanceSummary?: PerformanceSummaryTimeframe;
  /** Optional pre-loaded data for first paint (avoids the fetch
   *  flicker on the dashboard event page). When omitted, the block
   *  loads on mount. */
  initialTimeline?: TimelineRow[];
  initialPresale?: PresaleBucketShape | null;
  /** When true, the embedded DailyTracker shows the per-row edit
   *  pencil + opens the manual-entry editor. Defaults to true on
   *  dashboard mode (operators are signed in and own the data) and
   *  is forced false on share mode. */
  isEditable?: boolean;
}

interface ShareProps {
  mode: "share";
  event: EventLike;
  hasMetaScope: boolean;
  hasEventbriteLink: boolean;
  performanceSummary: PerformanceSummaryTimeframe;
  additionalSpendEntries: ReadonlyArray<{
    date: string;
    amount: number;
    category: string;
  }>;
  /** Required on share: the public page server-loads everything. */
  initialTimeline: TimelineRow[];
  initialPresale: PresaleBucketShape | null;
  /** Share renders are never editable — accepted on the prop type
   *  for shape uniformity but ignored. */
  isEditable?: false;
}

type Props = DashboardProps | ShareProps;

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function EventDailyReportBlock(props: Props) {
  const { event, hasMetaScope, hasEventbriteLink } = props;
  const isShare = props.mode === "share";

  const performanceSummary: PerformanceSummaryTimeframe = isShare
    ? props.performanceSummary
    : (props.performanceSummary ?? DEFAULT_PERF_SUMMARY);

  const [additionalSpendRows, setAdditionalSpendRows] = useState<
    ReadonlyArray<{ date: string; amount: number; category: string }>
  >(() => (props.mode === "share" ? props.additionalSpendEntries : []));

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
  const [lastSync, setLastSync] = useState<LastSync | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const loadAdditionalSpend = useCallback(async () => {
    if (isShare) return;
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(event.id)}/additional-spend`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        entries?: ReadonlyArray<{
          date: string;
          amount: number;
          category?: string;
        }>;
      };
      if (res.ok && json.ok && json.entries) {
        setAdditionalSpendRows(
          json.entries.map((e) => ({
            date: e.date,
            amount: Number(e.amount),
            category:
              typeof e.category === "string" ? e.category : "OTHER",
          })),
        );
      }
    } catch {
      // Non-fatal — summary degrades to Meta + pre-reg only.
    }
  }, [event.id, isShare]);

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
    await loadAdditionalSpend();
  }, [event.id, isShare, loadAdditionalSpend]);

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
      let json: SyncResponse;
      try {
        json = (await res.json()) as SyncResponse;
      } catch {
        // Non-JSON response (e.g. an HTML 5xx from a crashed
        // serverless function). Surface what we can and bail.
        throw new Error(
          `Sync route returned ${res.status} ${res.statusText} (non-JSON body).`,
        );
      }

      // Capture every sync attempt's result — success OR failure —
      // so the operator can see the diagnostic block instead of
      // staring at an empty table. Records the attempt before any
      // throw so the visible state always reflects the latest call.
      // PR #121: prefer the semantic `synced` signal over the strict
      // `ok` flag so events without an Eventbrite link don't flash a
      // red "failed" status when the Meta leg wrote rows cleanly.
      // Fall back to the legacy `ok` for older deployments that
      // haven't yet surfaced `summary.synced`.
      const syncedOk =
        typeof json.summary?.synced === "boolean"
          ? json.summary.synced
          : (json.ok ?? false);
      setLastSync({
        at: new Date().toISOString(),
        ok: syncedOk,
        topLevelError:
          !res.ok && res.status !== 207 ? (json.error ?? null) : null,
        summary: json.summary ?? null,
        diagnostics: json.diagnostics ?? null,
      });

      // 207 = partial success: render per-leg errors but still
      // refresh so whichever leg succeeded lands its rows.
      if (!res.ok && res.status !== 207) {
        throw new Error(json.error ?? "Sync failed.");
      }
      const lErrs: { meta?: string; eventbrite?: string } = {};
      if (json.summary?.metaError) lErrs.meta = json.summary.metaError;
      if (json.summary?.eventbriteError)
        lErrs.eventbrite = json.summary.eventbriteError;
      // Fallback to legacy shape — keeps the orchestrator working
      // against an older server before the next deploy lands.
      if (!lErrs.meta && json.meta && !json.meta.ok && json.meta.error) {
        lErrs.meta = json.meta.error;
      }
      if (
        !lErrs.eventbrite &&
        json.eventbrite &&
        !json.eventbrite.ok &&
        json.eventbrite.error
      ) {
        lErrs.eventbrite = json.eventbrite.error;
      }
      if (lErrs.meta || lErrs.eventbrite) setLegErrors(lErrs);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      setError(msg);
      setLastSync((prev) =>
        prev
          ? { ...prev, topLevelError: msg, ok: false }
          : {
              at: new Date().toISOString(),
              ok: false,
              topLevelError: msg,
              summary: null,
              diagnostics: null,
            },
      );
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

  useEffect(() => {
    if (!isShare) {
      void loadAdditionalSpend();
    }
  }, [isShare, loadAdditionalSpend]);

  useEffect(() => {
    if (props.mode === "share") {
      setAdditionalSpendRows(props.additionalSpendEntries);
    }
  }, [props]);

  useEffect(() => {
    if (isShare) return;
    const onChanged = (ev: Event) => {
      const d = (ev as CustomEvent<{ eventId: string }>).detail;
      if (d?.eventId === event.id) void loadAdditionalSpend();
    };
    window.addEventListener(ADDITIONAL_SPEND_CHANGED, onChanged);
    return () =>
      window.removeEventListener(ADDITIONAL_SPEND_CHANGED, onChanged);
  }, [event.id, isShare, loadAdditionalSpend]);

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

  // Edit pencil + manual-entry dialog are dashboard-only by default.
  // Share mode hard-disables it; dashboard callers can opt out via
  // an explicit `isEditable={false}` (no current call site does, but
  // the prop is there for symmetry).
  const isEditable = isShare ? false : props.isEditable !== false;

  const otherSpendByDate = useMemo(
    () => additionalSpendTotalsByDate(additionalSpendRows),
    [additionalSpendRows],
  );
  const otherSpendBreakdownByDate = useMemo(
    () => additionalSpendBreakdownLinesByDate(additionalSpendRows),
    [additionalSpendRows],
  );

  /** Same trim as Daily Tracker — chart x-axis starts at first activity. */
  const chartTimeline = useMemo(
    () =>
      trimTimelineForTrackerDisplay(timeline, {
        generalSaleCutoff: presale?.cutoffDate ?? null,
        otherSpendByDate,
      }),
    [timeline, presale?.cutoffDate, otherSpendByDate],
  );

  const controlled = useMemo(
    () => ({
      timeline,
      presale,
      syncing,
      error,
      legErrors,
      onSync: syncNow,
      // Refresh is wired to the same `refresh()` the Sync button
      // calls — the manual-entry editor uses it to reload the
      // canonical timeline after a successful PATCH so the running
      // totals + per-row source badges resettle.
      onRefresh: refresh,
      readOnly: isShare,
      isEditable,
      defaultCadence: event.report_cadence ?? "daily",
      otherSpendByDate,
      otherSpendBreakdownByDate,
    }),
    [
      timeline,
      presale,
      syncing,
      error,
      legErrors,
      syncNow,
      refresh,
      isShare,
      isEditable,
      event.report_cadence,
      otherSpendByDate,
      otherSpendBreakdownByDate,
    ],
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
            Sync now
          </Button>
        )}
      </div>

      {/* Sync status panel — renders the result of the last sync
          attempt (auto or manual) inline, so a sync that returns
          success-with-zero-rows or a partial 207 doesn't read as a
          mysterious empty table. The diagnostics dropdown reveals
          the env/scope/count detail the sync route logs server-side
          so we never need to redeploy with extra console.logs again. */}
      {!isShare && (lastSync || error || legErrors) ? (
        <SyncStatusPanel
          lastSync={lastSync}
          topLevelError={error}
          legErrors={legErrors}
          showDiagnostics={showDiagnostics}
          onToggleDiagnostics={() => setShowDiagnostics((v) => !v)}
        />
      ) : null}

      <EventSummaryHeader
        event={event}
        timeline={timeline}
        timeframe={performanceSummary}
        additionalSpendEntries={additionalSpendRows}
      />
      <EventTrendChart timeline={chartTimeline} />
      <DailyTracker
        eventId={event.id}
        hasMetaScope={hasMetaScope}
        hasEventbriteLink={hasEventbriteLink}
        controlled={controlled}
      />
    </div>
  );
}

interface SyncStatusPanelProps {
  lastSync: LastSync | null;
  topLevelError: string | null;
  legErrors: { meta?: string; eventbrite?: string } | null;
  showDiagnostics: boolean;
  onToggleDiagnostics: () => void;
}

function SyncStatusPanel({
  lastSync,
  topLevelError,
  legErrors,
  showDiagnostics,
  onToggleDiagnostics,
}: SyncStatusPanelProps) {
  const summary = lastSync?.summary ?? null;
  const diagnostics = lastSync?.diagnostics ?? null;

  // Headline status — biased toward "something went wrong" so a
  // silent zero-rows sync still reads as worth investigating.
  const isFatal = !!topLevelError;
  const isPartial =
    !isFatal &&
    summary !== null &&
    !(summary.metaOk && summary.eventbriteOk) &&
    (summary.metaOk || summary.eventbriteOk);
  const isAllOk =
    !isFatal && !isPartial && summary !== null && summary.metaOk && summary.eventbriteOk;
  const totalRows = summary?.rowsUpserted ?? 0;

  // Pick the panel chrome based on the most severe state. Top-level
  // errors → destructive; partial / leg errors → amber; clean run →
  // muted success. We deliberately never collapse the panel away
  // entirely so a working sync confirms "yes, it ran".
  const tone = isFatal
    ? "border-destructive/40 bg-destructive/5"
    : isPartial
      ? "border-amber-500/40 bg-amber-500/5"
      : "border-border bg-muted/30";

  return (
    <section
      className={`rounded-md border ${tone} p-3 text-xs space-y-2`}
      aria-label="Sync status"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {isFatal ? (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5" /> Sync failed
          </span>
        ) : isPartial ? (
          <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5" /> Sync partially succeeded
          </span>
        ) : isAllOk ? (
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Sync ok
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" /> Sync pending
          </span>
        )}
        {summary ? (
          <span className="text-muted-foreground">
            wrote{" "}
            <strong className="tabular-nums text-foreground">
              {totalRows}
            </strong>{" "}
            row{totalRows === 1 ? "" : "s"} (Meta{" "}
            <strong className="tabular-nums text-foreground">
              {summary.metaRowsUpserted}
            </strong>
            , Eventbrite{" "}
            <strong className="tabular-nums text-foreground">
              {summary.eventbriteRowsUpserted}
            </strong>
            )
          </span>
        ) : null}
        {lastSync?.at ? (
          <span className="text-muted-foreground">
            · {fmtRelative(lastSync.at)}
          </span>
        ) : null}
        {diagnostics ? (
          <button
            type="button"
            onClick={onToggleDiagnostics}
            className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`h-3 w-3 transition-transform ${
                showDiagnostics ? "rotate-180" : ""
              }`}
            />
            {showDiagnostics ? "Hide diagnostics" : "Show diagnostics"}
          </button>
        ) : null}
      </div>

      {topLevelError ? (
        <p className="text-destructive">{topLevelError}</p>
      ) : null}
      {legErrors?.meta ? (
        <p className="text-amber-700 dark:text-amber-300">
          <strong>Meta:</strong> {legErrors.meta}
        </p>
      ) : null}
      {legErrors?.eventbrite ? (
        <p className="text-amber-700 dark:text-amber-300">
          <strong>Eventbrite:</strong> {legErrors.eventbrite}
        </p>
      ) : null}

      {showDiagnostics && diagnostics ? (
        <div className="rounded border border-border/60 bg-background p-2 text-[11px] font-mono leading-relaxed text-muted-foreground">
          <div>
            <span className="text-foreground/80">window:</span>{" "}
            {diagnostics.windowSince} → {diagnostics.windowUntil} (tz{" "}
            {diagnostics.eventTimezone ?? "<null>"})
          </div>
          <div>
            <span className="text-foreground/80">meta_ad_account_id:</span>{" "}
            {diagnostics.metaAdAccountId ?? "<null>"}
          </div>
          <div>
            <span className="text-foreground/80">event_code filter:</span>{" "}
            {diagnostics.metaCodeBracketed ?? "<null>"}
          </div>
          <div>
            <span className="text-foreground/80">campaigns matched:</span>{" "}
            {diagnostics.metaCampaignsMatched.length === 0
              ? "<none>"
              : diagnostics.metaCampaignsMatched.join(", ")}
          </div>
          <div>
            <span className="text-foreground/80">meta days returned:</span>{" "}
            {diagnostics.metaDaysReturned}{" "}
            <span className="text-foreground/40">
              (rows attempted {diagnostics.metaRowsAttempted})
            </span>
          </div>
          <div>
            <span className="text-foreground/80">EVENTBRITE_TOKEN_KEY:</span>{" "}
            {diagnostics.eventbriteTokenKeyPresent ? "present" : "missing"}
          </div>
          <div>
            <span className="text-foreground/80">eventbrite links:</span>{" "}
            {diagnostics.eventbriteLinksCount}{" "}
            {diagnostics.eventbriteEventIds.length > 0
              ? `[${diagnostics.eventbriteEventIds.join(", ")}]`
              : ""}
          </div>
          <div>
            <span className="text-foreground/80">
              eventbrite rows attempted:
            </span>{" "}
            {diagnostics.eventbriteRowsAttempted}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
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
