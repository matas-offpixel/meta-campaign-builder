"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pencil,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fmtCurrency } from "@/lib/dashboard/format";
import {
  paidLinkClicksOf,
  paidSpendOf,
} from "@/lib/dashboard/paid-spend";
import { trimTimelineForTrackerDisplay } from "@/lib/dashboard/trim-timeline-for-tracker-display";
import type { SpendCategoryLine } from "@/lib/db/additional-spend-sum";
import { sortSpendCategoryLines } from "@/lib/db/additional-spend-sum";
import type {
  TimelineRow,
  TimelineSource,
} from "@/lib/db/event-daily-timeline";

/**
 * components/dashboard/events/daily-tracker.tsx
 *
 * Real-time daily tracker table on the event Overview tab — mirrors
 * Matas's manual xlsx tracker. Renders one row per calendar day with
 * day-level metrics on the left and running cumulative columns on
 * the right, plus a click-to-edit notes field per row.
 *
 * Column order matches the xlsx so cross-checking is paste-friendly:
 *   Date | Day spend | Tickets | Revenue | CPT | ROAS | Link clicks
 *   | CPL | Running spend | Running tickets | Running avg CPT
 *   | Running revenue | Running ROAS | Notes
 *
 * Two render modes:
 *   - Uncontrolled (default): the component owns its own data
 *     lifecycle — initial GET /rollup, auto-sync on stale/empty,
 *     manual Refresh, in-place notes edits via PATCH /rollup.
 *     Used standalone (e.g. legacy callers / direct embedding).
 *   - Controlled (`controlled` prop set): an orchestrator
 *     (`EventDailyReportBlock`) supplies the timeline + presale +
 *     sync state via props. The component renders the table only
 *     and forwards Refresh clicks to the parent. Notes editing is
 *     suppressed when `controlled.readOnly` is true (public share
 *     page) and when the row's data source is "manual" — manual
 *     entries live in `daily_tracking_entries`, not the rollup
 *     table the PATCH endpoint targets.
 *
 * Source badge (per-row "Manual" / "Live"):
 *   The unified timeline tags every day with the upstream table
 *   that fed it (manual operator entry vs. auto-synced rollup).
 *   Each row renders a small pill so it's clear at a glance which
 *   number an operator can override and which is live.
 *
 * Presale bucket:
 *   When `events.general_sale_at` is set, every row whose date is
 *   strictly before that cutoff collapses into a single "Presale"
 *   row at the top. The presale bucket is rollup-only (operators
 *   don't type presale rows) so the badge is suppressed for it.
 *
 * Empty state:
 *   When the event has neither a Meta event_code nor an Eventbrite
 *   link, the table renders a CTA pointing to the connect/link flow
 *   instead of an empty grid. This is intentionally upstream of the
 *   "no rows yet" state — those two cases want different copy.
 *
 * Sync model (uncontrolled mode only):
 *   - Manual Refresh: POST /rollup-sync then GET /rollup. Mirrors
 *     the eventbrite-live-block UX 1:1.
 *   - Auto-sync on mount: when the freshest source_*_at on any row
 *     is older than 30 minutes (or no rows exist yet at all). Guarded
 *     by `autoTried` so a failed sync doesn't loop.
 *
 * Out of scope (per spec):
 *   - CRM signups column — we leave a deliberate gap in the column
 *     order ready for the follow-up PR. No column placeholder
 *     rendered yet (would mislead).
 *   - CSV export, charts, editable daily-budget column.
 */

const STALE_THRESHOLD_MS = 30 * 60 * 1000;

const EMPTY_OTHER_SPEND_MAP = new Map<string, number>();

interface DailyRollup {
  id: string;
  user_id: string;
  event_id: string;
  date: string;
  ad_spend: number | null;
  link_clicks: number | null;
  tiktok_spend: number | null;
  tiktok_clicks: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  source_meta_at: string | null;
  source_eventbrite_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PresaleBucket {
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
  rows?: DailyRollup[];
  /** Unified per-day view: live rollups + manual entries merged with
   *  per-date precedence (manual wins). Each row carries `source` for
   *  the badge. */
  timeline?: TimelineRow[];
  presale?: PresaleBucket | null;
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

/**
 * Daily- vs weekly-rollup of the same dataset. Only affects render —
 * the underlying timeline rows are always per-day; weekly mode buckets
 * them client-side into ISO weeks (Mon W/C, UTC). See `buildWeeklyDisplayRows`.
 */
export type TrackerCadence = "daily" | "weekly";

interface Props {
  eventId: string;
  kind?: string | null;
  /** True when the event has an event_code AND the client has a Meta ad account. */
  hasMetaScope: boolean;
  hasEventbriteLink: boolean;
  /**
   * When provided, the component runs in controlled mode: it skips
   * its own fetch + sync and renders from the supplied props. Used
   * by the report-block orchestrator so the summary header, chart,
   * and table all read from one timeline.
   */
  controlled?: {
    timeline: TimelineRow[];
    presale: PresaleBucket | null;
    syncing?: boolean;
    error?: string | null;
    legErrors?: { meta?: string; eventbrite?: string } | null;
    onSync?: () => void | Promise<void>;
    /** Re-fetch the canonical timeline from the orchestrator. The
     *  manual-entry editor calls this after a successful PATCH so the
     *  running totals + per-row source badges reflect the new value. */
    onRefresh?: () => void | Promise<void>;
    /** Suppresses notes editing + the per-table Refresh button.
     *  Used on the public share page where the token is read-only. */
    readOnly?: boolean;
    /** Whether the per-row edit pencil + manual-entry editor are
     *  available. Defaults to false. Forced false on share. */
    isEditable?: boolean;
    /** First-paint cadence default — comes from `events.report_cadence`
     *  (migration 040). Per-session sessionStorage override on the
     *  client wins on subsequent paints; this only seeds initial render
     *  + acts as the SSR-safe value. Falls back to 'daily'. */
    defaultCadence?: TrackerCadence;
    /** Off-Meta additional spend per day (Performance Summary / migration 044). */
    otherSpendByDate?: ReadonlyMap<string, number>;
    /** Category breakdown per day for Day other tooltips. */
    otherSpendBreakdownByDate?: ReadonlyMap<string, SpendCategoryLine[]>;
    /**
     * Timeframe-scoped report embeds pass a pre-filtered timeline. In
     * that mode, avoid adding today's placeholder when today is outside
     * the selected window (e.g. Yesterday).
     */
    suppressSyntheticToday?: boolean;
  };
  /** Top-level fallback for callers that don't go through the
   *  controlled orchestrator. Default false. Controlled value wins
   *  when both are set. */
  isEditable?: boolean;
}

interface DisplayRow {
  key: string;
  /** Label shown in the Date column ("Presale", or formatted date). */
  label: string;
  /** True for the Presale bucket — used for subtle styling + suppresses badge. */
  isPresale: boolean;
  /** True when this row is "today" — used for highlight. */
  isToday: boolean;
  /** True for the synthetic empty "today" row (no data, no badge). */
  isSynthetic: boolean;
  /** Source date string for the row (used as PATCH key for notes). */
  date: string | null;
  /** Which upstream table fed this row — null for synthetic / presale.
   *  Drives the "Manual" / "Live" badge in the Date column. */
  source: TimelineSource | null;
  ad_spend: number | null;
  /** Meta-only spend, used for Meta registration CPR. */
  meta_ad_spend: number | null;
  /** Off-Meta spend attributed to this calendar day. */
  other_spend: number | null;
  /** Native title tooltip: "PR £100, Influencer £50" */
  other_spend_tooltip: string | null;
  link_clicks: number | null;
  /** Meta complete_registration count for the day (rollup-sync). */
  meta_regs: number | null;
  impressions: number | null;
  video_views: number | null;
  tickets_sold: number | null;
  revenue: number | null;
  notes: string | null;
  /** Cumulative tally including this row (oldest-first contribution). */
  running_spend: number;
  running_clicks: number;
  running_tickets: number;
  running_revenue: number;
}

export function DailyTracker({
  eventId,
  kind,
  hasMetaScope,
  hasEventbriteLink,
  controlled,
  isEditable: isEditableProp,
}: Props) {
  const isControlled = controlled !== undefined;

  // Internal state — only ever populated in uncontrolled mode. In
  // controlled mode we read straight from `controlled.*` and skip
  // the fetch/sync side effects entirely.
  const [internalTimeline, setInternalTimeline] = useState<TimelineRow[]>([]);
  const [internalPresale, setInternalPresale] = useState<PresaleBucket | null>(
    null,
  );
  const [loading, setLoading] = useState(!isControlled);
  const [internalSyncing, setInternalSyncing] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const [internalLegErrors, setInternalLegErrors] = useState<{
    meta?: string;
    eventbrite?: string;
  } | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  const timeline = isControlled ? controlled.timeline : internalTimeline;
  const presale = isControlled ? controlled.presale : internalPresale;
  const syncing = isControlled ? !!controlled.syncing : internalSyncing;
  const error = isControlled
    ? (controlled.error ?? null)
    : internalError;
  const legErrors = isControlled
    ? (controlled.legErrors ?? null)
    : internalLegErrors;
  const readOnly = isControlled ? !!controlled.readOnly : false;
  const isBrandCampaign = kind === "brand_campaign";
  // Editable mode requires both: the prop opt-in AND not-readOnly. The
  // controlled value wins when both are set (orchestrator owns the
  // dashboard-vs-share discriminator).
  const isEditable =
    !readOnly &&
    (isControlled
      ? !!controlled.isEditable
      : isEditableProp === true);
  const defaultCadence: TrackerCadence =
    (isControlled && controlled.defaultCadence) || "daily";

  // Per-session toggle override. Initial state matches the SSR-safe
  // `defaultCadence` so the first client paint is identical to the
  // server's; we then re-hydrate from sessionStorage in an effect to
  // avoid a hydration mismatch. Key includes eventId so a client
  // hopping between events doesn't carry the wrong setting.
  const [cadence, setCadence] = useState<TrackerCadence>(defaultCadence);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.sessionStorage.getItem(
        `tracker-cadence:${eventId}`,
      );
      if (stored === "daily" || stored === "weekly") setCadence(stored);
    } catch {
      // sessionStorage can throw in privacy modes — silently fall back
      // to the SSR default; the toggle still works for the live session.
    }
  }, [eventId]);
  const onCadenceChange = useCallback(
    (next: TrackerCadence) => {
      setCadence(next);
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.setItem(`tracker-cadence:${eventId}`, next);
      } catch {
        // Same defensive swallow as the read path.
      }
    },
    [eventId],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(
      `/api/ticketing/rollup?eventId=${encodeURIComponent(eventId)}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as RollupResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Failed to load rollup data.");
    }
    setInternalTimeline(json.timeline ?? []);
    setInternalPresale(json.presale ?? null);
  }, [eventId]);

  const internalSyncNow = useCallback(async () => {
    setInternalSyncing(true);
    setInternalError(null);
    setInternalLegErrors(null);
    try {
      const res = await fetch(
        `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(eventId)}`,
        { method: "POST" },
      );
      const json = (await res.json()) as SyncResponse;
      // 207 = partial success: surface per-leg errors but still
      // refresh so the working leg's data lands.
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
      if (lErrs.meta || lErrs.eventbrite) setInternalLegErrors(lErrs);
      await refresh();
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setInternalSyncing(false);
    }
  }, [eventId, refresh]);

  // Initial load — uncontrolled only.
  useEffect(() => {
    if (isControlled) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setInternalError(
            err instanceof Error ? err.message : "Unknown error.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, isControlled]);

  // Auto-sync when stale or empty — uncontrolled only.
  useEffect(() => {
    if (isControlled) return;
    if (autoTried || loading) return;
    if (!hasMetaScope && !hasEventbriteLink) return;
    const stale = isStaleTimeline(internalTimeline);
    if (internalTimeline.length > 0 && !stale) return;
    setAutoTried(true);
    void internalSyncNow();
  }, [
    autoTried,
    loading,
    internalTimeline,
    internalSyncNow,
    hasMetaScope,
    hasEventbriteLink,
    isControlled,
  ]);

  const onSyncClick = useCallback(() => {
    if (isControlled) {
      if (controlled?.onSync) void controlled.onSync();
      return;
    }
    void internalSyncNow();
  }, [isControlled, controlled, internalSyncNow]);

  // Pending optimistic overrides keyed by ISO date. Each entry holds
  // whichever subset of the editable columns the operator just saved
  // through the manual-entry editor — applied on top of the canonical
  // timeline so the UI updates the moment the dialog closes, well
  // before the orchestrator's `onRefresh()` round-trip lands. Cleared
  // per-key when refresh completes (the canonical row now matches).
  // The value type mirrors the editor's payload.
  const [pendingOverrides, setPendingOverrides] = useState<
    Record<
      string,
      {
        tickets_sold?: number | null;
        revenue?: number | null;
        notes?: string | null;
      }
    >
  >({});

  const effectiveTimeline = useMemo<TimelineRow[]>(() => {
    if (Object.keys(pendingOverrides).length === 0) return timeline;
    // Merge per-date. Rows present in the timeline get the override
    // applied as a partial; dates that only exist in the override map
    // (operator wrote a value for a Monday with no sync row yet) get
    // a synthetic `manual`-tagged row so they're visible immediately.
    const byDate = new Map<string, TimelineRow>();
    for (const r of timeline) byDate.set(r.date, r);
    for (const [date, patch] of Object.entries(pendingOverrides)) {
      const existing = byDate.get(date);
      if (existing) {
        byDate.set(date, {
          ...existing,
          tickets_sold:
            patch.tickets_sold !== undefined
              ? patch.tickets_sold
              : existing.tickets_sold,
          revenue:
            patch.revenue !== undefined ? patch.revenue : existing.revenue,
          notes: patch.notes !== undefined ? patch.notes : existing.notes,
        });
      } else {
        // Synthetic insert. Marked `manual` because operator-typed
        // entries are conceptually manual, even though the PATCH
        // route writes to `event_daily_rollups` (not the legacy
        // `daily_tracking_entries` table the live merge tags as
        // manual). Cleared on refresh, so any drift between the two
        // sources self-corrects within the round-trip window.
        byDate.set(date, {
          date,
          source: "manual",
          ad_spend: null,
          link_clicks: null,
          meta_regs: null,
          ad_spend_allocated: null,
          tiktok_spend: null,
          tiktok_impressions: null,
          tiktok_clicks: null,
          tiktok_video_views: null,
          tiktok_results: null,
          google_ads_spend: null,
          google_ads_impressions: null,
          google_ads_clicks: null,
          google_ads_video_views: null,
          tickets_sold: patch.tickets_sold ?? null,
          revenue: patch.revenue ?? null,
          notes: patch.notes ?? null,
          freshness_at: null,
        });
      }
    }
    return [...byDate.values()].sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    );
  }, [timeline, pendingOverrides]);

  const otherSpendMap = isControlled
    ? (controlled?.otherSpendByDate ?? EMPTY_OTHER_SPEND_MAP)
    : EMPTY_OTHER_SPEND_MAP;
  const otherBreakdownMap = isControlled
    ? controlled?.otherSpendBreakdownByDate
    : undefined;
  const suppressSyntheticToday = isControlled
    ? !!controlled?.suppressSyntheticToday
    : false;

  /** Hide leading zero-pad days (PR #99 sync window) — display-only; API + DB unchanged. */
  const trackerDisplayTimeline = useMemo(
    () =>
      trimTimelineForTrackerDisplay(effectiveTimeline, {
        generalSaleCutoff: presale?.cutoffDate ?? null,
        otherSpendByDate: otherSpendMap,
      }),
    [effectiveTimeline, presale?.cutoffDate, otherSpendMap],
  );

  const display = useMemo(
    () =>
      cadence === "weekly"
        ? buildWeeklyDisplayRows({
            timeline: trackerDisplayTimeline,
            presale,
            otherSpendByDate: otherSpendMap,
            otherSpendBreakdownByDate: otherBreakdownMap,
            isBrandCampaign,
          })
        : buildDisplayRows({
            timeline: trackerDisplayTimeline,
            presale,
            otherSpendByDate: otherSpendMap,
            otherSpendBreakdownByDate: otherBreakdownMap,
            suppressSyntheticToday,
            isBrandCampaign,
          }),
    [
      trackerDisplayTimeline,
      presale,
      cadence,
      otherSpendMap,
      otherBreakdownMap,
      suppressSyntheticToday,
      isBrandCampaign,
    ],
  );

  // Editor open / target state. Single editor shared by every row to
  // avoid mounting one dialog per visible row.
  const [editTarget, setEditTarget] = useState<DisplayRow | null>(null);

  const onRowSaved = useCallback(
    async (
      isoDate: string,
      patch: {
        tickets_sold?: number | null;
        revenue?: number | null;
        notes?: string | null;
      },
    ) => {
      // Apply the override immediately so the row re-renders with
      // the new values; close the editor; fire refresh in the
      // background. On refresh completion, drop the override so the
      // canonical row takes over.
      setPendingOverrides((prev) => ({ ...prev, [isoDate]: patch }));
      setEditTarget(null);
      try {
        if (isControlled) {
          if (controlled?.onRefresh) await controlled.onRefresh();
        } else {
          await refresh();
        }
      } catch {
        // Swallow — the override stays so the operator's edit is
        // still visible. Next manual sync click will reconcile.
      } finally {
        setPendingOverrides((prev) => {
          if (!(isoDate in prev)) return prev;
          const next = { ...prev };
          delete next[isoDate];
          return next;
        });
      }
    },
    [isControlled, controlled, refresh],
  );

  // Header copy + first column label switch with cadence. "Last 60
  // days" / "Last N weeks" comes straight from the spec; the actual
  // padding range follows the existing daily logic (earliest entry →
  // today / current week W/C) rather than a hard slice, so the
  // subtitle reads as guidance rather than a claim about row count.
  const WEEKLY_WINDOW_LABEL_WEEKS = Math.ceil(60 / 7); // = 9
  const dateColLabel = cadence === "weekly" ? "Week (W/C)" : "Date";
  const colSpan = isEditable ? (isBrandCampaign ? 9 : 18) : isBrandCampaign ? 8 : 17;
  const windowLabel =
    cadence === "weekly"
      ? `Last ${WEEKLY_WINDOW_LABEL_WEEKS} weeks`
      : "Last 60 days";

  // ── Empty / loading states ─────────────────────────────────────────

  if (!hasMetaScope && !hasEventbriteLink) {
    return (
      <section className="rounded-md border border-dashed border-border bg-muted/20 p-5">
        <div className="flex items-start gap-3">
          <TrendingUp className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="font-heading text-base tracking-wide">
              Daily tracker
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
    <section className="rounded-md border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="flex items-start gap-3 min-w-0">
          <TrendingUp className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">
              Daily tracker
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {windowLabel} ·{" "}
              {isBrandCampaign
                ? "Cross-platform spend aggregated by"
                : "Meta spend & clicks aggregated by"}{" "}
              <code className="text-foreground/80">[event_code]</code>
              {!isBrandCampaign && hasEventbriteLink
                ? cadence === "weekly"
                  ? " · Eventbrite tickets & revenue per ISO week"
                  : " · Eventbrite tickets & revenue per day"
                : ""}
              {presale ? " · Presale rolled up" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CadenceToggle value={cadence} onChange={onCadenceChange} />
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              onClick={onSyncClick}
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
      </header>

      {/* In controlled mode the orchestrator owns a richer SyncStatusPanel
          above the table — duplicating the leg-error chips here would just
          repeat the same message twice. Uncontrolled callers (the legacy
          embed sites) still need their own in-table error surface. */}
      {!isControlled && error ? (
        <p className="mx-4 mt-3 inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
      {!isControlled && legErrors?.meta ? (
        <p className="mx-4 mt-3 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Meta: {legErrors.meta}
        </p>
      ) : null}
      {!isControlled && legErrors?.eventbrite ? (
        <p className="mx-4 mt-3 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Eventbrite: {legErrors.eventbrite}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th align="left">{dateColLabel}</Th>
              <Th>Day spend</Th>
              {!isBrandCampaign ? <Th>Day other</Th> : null}
              {isBrandCampaign ? <Th>Impressions</Th> : <Th>Tickets</Th>}
              {isBrandCampaign ? <Th>Clicks (all)</Th> : <Th>Revenue</Th>}
              {isBrandCampaign ? <Th>Video views</Th> : <Th>CPT</Th>}
              {isBrandCampaign ? <Th>CPM</Th> : <Th>ROAS</Th>}
              {!isBrandCampaign ? <Th>Link clicks</Th> : null}
              {!isBrandCampaign ? <Th>CPL</Th> : null}
              {!isBrandCampaign ? <Th>Regs</Th> : null}
              {!isBrandCampaign ? <Th>CPR</Th> : null}
              <Th>Running spend</Th>
              {!isBrandCampaign ? <Th>Running tickets</Th> : null}
              {!isBrandCampaign ? <Th>Running avg CPT</Th> : null}
              {!isBrandCampaign ? <Th>Running revenue</Th> : null}
              {!isBrandCampaign ? <Th>Running ROAS</Th> : null}
              {!isBrandCampaign ? <Th align="left">Notes</Th> : null}
              {isEditable ? (
                <Th>
                  <span className="sr-only">Edit row</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" />{" "}
                  Loading…
                </td>
              </tr>
            ) : display.length === 0 ? (
              <tr>
                <td
                  colSpan={colSpan}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  No data yet — click Refresh to pull the latest.
                </td>
              </tr>
            ) : (
              display.map((row) => (
                <RowEl
                  key={row.key}
                  row={row}
                  eventId={eventId}
                  cadence={cadence}
                  // In weekly mode the row spans seven days, so the
                  // legacy NotesCell PATCH endpoint
                  // (`?date=YYYY-MM-DD`) has no single target and a
                  // save would silently no-op. Lock the notes column
                  // to read-only for the whole table. The new
                  // editor dialog handles weekly correctly by
                  // writing to the W/C Monday explicitly.
                  readOnly={readOnly || cadence === "weekly"}
                  // Edit-pencil column: present iff `isEditable`.
                  // Suppressed on the presale rolled-up bucket — its
                  // value is the sum of many dates and there's no
                  // single PATCH target.
                  isEditable={isEditable}
                  isBrandCampaign={isBrandCampaign}
                  onEditClick={(target) => setEditTarget(target)}
                  onNotesSaved={(date, notes) => {
                    // Note edits are only supported in uncontrolled
                    // mode (the orchestrator owns the timeline state
                    // when controlled). Bail to avoid a stale-write.
                    if (isControlled) return;
                    setInternalTimeline((prev) =>
                      prev.map((r) =>
                        r.date === date ? { ...r, notes } : r,
                      ),
                    );
                  }}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      {editTarget ? (
        <RowEditDialog
          eventId={eventId}
          row={editTarget}
          cadence={cadence}
          onClose={() => setEditTarget(null)}
          onSaved={(date, patch) => onRowSaved(date, patch)}
        />
      ) : null}
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

function OtherSpendCell({
  amount,
  tooltip,
}: {
  amount: number | null;
  tooltip: string | null;
}) {
  const shown = fmtMoney(amount);
  if (!tooltip) return <Td>{shown}</Td>;
  return (
    <Td>
      <span
        title={tooltip}
        className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2"
      >
        {shown}
      </span>
    </Td>
  );
}

function RowEl({
  row,
  eventId,
  readOnly,
  cadence,
  isEditable,
  isBrandCampaign,
  onEditClick,
  onNotesSaved,
}: {
  row: DisplayRow;
  eventId: string;
  readOnly: boolean;
  /** Drives the per-row source badge: weekly rows aggregate across
   *  potentially mixed sources (manual + live) so the badge is
   *  suppressed entirely. */
  cadence: TrackerCadence;
  /** Whether to render the trailing edit-pencil column. Suppressed
   *  entirely when false (no extra cell) so the colSpan math in the
   *  loading / empty rows in the parent stays in sync. */
  isEditable: boolean;
  isBrandCampaign: boolean;
  onEditClick: (row: DisplayRow) => void;
  onNotesSaved: (date: string, notes: string | null) => void;
}) {
  const cpt = derive(row.ad_spend, row.tickets_sold);
  const cpl = derive(row.ad_spend, row.link_clicks);
  const cprRegs = derive(row.meta_ad_spend, row.meta_regs);
  const cpm = row.ad_spend != null && row.impressions != null && row.impressions > 0
    ? (row.ad_spend / row.impressions) * 1000
    : null;
  const roas = row.ad_spend != null && row.ad_spend > 0 && row.revenue != null
    ? row.revenue / row.ad_spend
    : null;
  const runCpt =
    row.running_tickets > 0 ? row.running_spend / row.running_tickets : null;
  const runRoas =
    row.running_spend > 0 ? row.running_revenue / row.running_spend : null;

  const rowClass = [
    "border-b border-border/60 transition-colors",
    row.isPresale ? "bg-violet-500/[0.06] font-medium" : "",
    row.isToday ? "bg-amber-400/[0.08]" : "",
    row.isSynthetic ? "italic text-muted-foreground" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Manual rows live in daily_tracking_entries — the PATCH endpoint
  // targets event_daily_rollups, so editing a manual row from here
  // would silently no-op. Render the typed note read-only.
  // Same for the public share view (readOnly).
  const notesReadOnly = readOnly || row.source === "manual";

  return (
    <tr className={rowClass}>
      <Td align="left">
        <div className="flex items-center gap-2">
          <span className={row.isPresale ? "tracking-wide" : ""}>
            {row.label}
          </span>
          {cadence === "daily" &&
          row.source &&
          !row.isSynthetic &&
          !row.isPresale ? (
            <SourceBadge source={row.source} />
          ) : null}
        </div>
      </Td>
      <Td>{fmtMoney(row.ad_spend)}</Td>
      {!isBrandCampaign ? (
        <OtherSpendCell
          amount={row.other_spend}
          tooltip={row.other_spend_tooltip}
        />
      ) : null}
      {isBrandCampaign ? <Td>{fmtInt(row.impressions)}</Td> : <Td>{fmtInt(row.tickets_sold)}</Td>}
      {isBrandCampaign ? <Td>{fmtInt(row.link_clicks)}</Td> : <Td>{fmtMoney(row.revenue)}</Td>}
      {isBrandCampaign ? <Td>{fmtInt(row.video_views)}</Td> : <Td>{fmtMoney(cpt)}</Td>}
      {isBrandCampaign ? <Td>{fmtMoney(cpm)}</Td> : <Td>{fmtRoas(roas)}</Td>}
      {!isBrandCampaign ? <Td>{fmtInt(row.link_clicks)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtMoney(cpl)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtInt(row.meta_regs)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtMoney(cprRegs)}</Td> : null}
      <Td>{fmtMoney(row.running_spend)}</Td>
      {!isBrandCampaign ? <Td>{fmtInt(row.running_tickets)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtMoney(runCpt)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtMoney(row.running_revenue)}</Td> : null}
      {!isBrandCampaign ? <Td>{fmtRoas(runRoas)}</Td> : null}
      {!isBrandCampaign ? <Td align="left" wide>
        {row.date ? (
          // When the dialog editor is on (`isEditable`), notes are
          // edited from there alongside tickets / revenue. The
          // inline NotesCell would compete with the dialog and only
          // updates one column, so collapse to a read-only display.
          isEditable || notesReadOnly ? (
            <span
              className={row.notes ? "text-foreground" : "text-muted-foreground"}
            >
              {row.notes ?? "—"}
            </span>
          ) : (
            <NotesCell
              eventId={eventId}
              date={row.date}
              initial={row.notes}
              onSaved={(n) => onNotesSaved(row.date as string, n)}
            />
          )
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td> : null}
      {isEditable ? (
        <Td>
          {row.date && !row.isPresale ? (
            <button
              type="button"
              onClick={() => onEditClick(row)}
              className="inline-flex items-center justify-center rounded-md border border-border-strong bg-background px-1.5 py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label={`Edit ${row.label}`}
              title="Edit tickets / revenue / notes"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Td>
      ) : null}
    </tr>
  );
}

function SourceBadge({ source }: { source: TimelineSource }) {
  const isManual = source === "manual";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-px text-[9px] font-medium uppercase tracking-wider ${
        isManual
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      }`}
      title={
        isManual
          ? "Operator-typed entry from daily_tracking_entries"
          : "Auto-synced from Meta + Eventbrite"
      }
    >
      {isManual ? "Manual" : "Live"}
    </span>
  );
}

// ─── Notes cell ───────────────────────────────────────────────────────

function NotesCell({
  eventId,
  date,
  initial,
  onSaved,
}: {
  eventId: string;
  date: string;
  initial: string | null;
  onSaved: (notes: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setDraft(initial ?? ""), [initial]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/ticketing/rollup?eventId=${encodeURIComponent(eventId)}&date=${encodeURIComponent(date)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: draft.trim() === "" ? null : draft }),
        },
      );
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        row?: DailyRollup;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Failed to save note.");
      }
      onSaved(json.row?.notes ?? null);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") {
              setDraft(initial ?? "");
              setEditing(false);
            }
          }}
          disabled={saving}
          placeholder="Add a note…"
          className="h-7 min-w-[160px] flex-1 rounded border border-border-strong bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        ) : null}
        {err ? (
          <span className="text-[10px] text-destructive" title={err}>
            !
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1 text-left text-xs text-foreground hover:text-primary"
    >
      <span className={initial ? "" : "text-muted-foreground"}>
        {initial ?? "Add note"}
      </span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}

// ─── Table cell helpers ───────────────────────────────────────────────

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 ${
        align === "left" ? "text-left" : "text-right"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  wide,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  wide?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 tabular-nums ${
        align === "left" ? "text-left" : "text-right"
      } ${wide ? "min-w-[200px]" : ""}`}
    >
      {children}
    </td>
  );
}

// ─── Display-row builder ─────────────────────────────────────────────

function categoryLabelForTooltip(cat: string): string {
  switch (cat) {
    case "INFLUENCER":
      return "Influencer";
    case "PRINT":
      return "Print";
    case "RADIO":
      return "Radio";
    case "OTHER":
      return "Other";
    case "PR":
      return "PR";
    default:
      return cat;
  }
}

function fmtOtherSpendTooltipLines(
  lines: SpendCategoryLine[] | undefined,
): string | null {
  if (!lines?.length) return null;
  return lines
    .map(
      (l) =>
        `${categoryLabelForTooltip(l.category)} ${fmtCurrency(l.amount)}`,
    )
    .join(", ");
}

function buildDisplayRows({
  timeline,
  presale,
  otherSpendByDate = EMPTY_OTHER_SPEND_MAP,
  otherSpendBreakdownByDate,
  suppressSyntheticToday = false,
  isBrandCampaign,
}: {
  timeline: TimelineRow[];
  presale: PresaleBucket | null;
  otherSpendByDate?: ReadonlyMap<string, number>;
  otherSpendBreakdownByDate?: ReadonlyMap<string, SpendCategoryLine[]>;
  suppressSyntheticToday?: boolean;
  isBrandCampaign: boolean;
}): DisplayRow[] {
  const todayStr = ymd(new Date());
  const generalSaleCutoff = presale?.cutoffDate ?? null;

  // Working shape — same fields as the upstream timeline row plus a
  // synthetic flag for the empty "today" placeholder.
  type Row = {
    date: string;
    source: TimelineSource;
    isSynthetic: boolean;
    ad_spend: number | null;
    meta_ad_spend: number | null;
    other_spend: number | null;
    other_spend_tooltip: string | null;
    link_clicks: number | null;
    meta_regs: number | null;
    impressions: number | null;
    video_views: number | null;
    tickets_sold: number | null;
    revenue: number | null;
    notes: string | null;
  };

  // Rows after the cutoff (or all rows when there is no cutoff). Sort
  // ascending so we can compute running totals in chronological order;
  // we'll reverse at the end to render newest-first.
  const dailyRows: Row[] = (
    generalSaleCutoff
      ? timeline.filter((r) => r.date >= generalSaleCutoff)
      : timeline.slice()
  )
    .map((r) => ({
      date: r.date,
      source: r.source,
      isSynthetic: false,
      ad_spend: paidSpendForDisplay(r, isBrandCampaign),
      meta_ad_spend: r.ad_spend,
      other_spend: otherSpendByDate.get(r.date) ?? null,
      other_spend_tooltip: fmtOtherSpendTooltipLines(
        otherSpendBreakdownByDate?.get(r.date),
      ),
      link_clicks: paidLinkClicksOf(r),
      meta_regs: r.meta_regs,
      impressions: totalImpressionsOf(r),
      video_views: totalVideoViewsOf(r),
      tickets_sold: r.tickets_sold,
      revenue: r.revenue,
      notes: r.notes,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Synthetic "today" row when today isn't in the dataset yet — keeps
  // the table responsive even before the first sync writes anything
  // for today. Tagged "live" but the badge is suppressed for synthetic
  // rows in the renderer.
  const hasToday = dailyRows.some((r) => r.date === todayStr);
  if (
    !suppressSyntheticToday &&
    !hasToday &&
    (!generalSaleCutoff || todayStr >= generalSaleCutoff)
  ) {
    dailyRows.push({
      date: todayStr,
      source: "live",
      isSynthetic: true,
      ad_spend: null,
      meta_ad_spend: null,
      other_spend: otherSpendByDate.get(todayStr) ?? null,
      other_spend_tooltip: fmtOtherSpendTooltipLines(
        otherSpendBreakdownByDate?.get(todayStr),
      ),
      link_clicks: null,
      meta_regs: null,
      impressions: null,
      video_views: null,
      tickets_sold: null,
      revenue: null,
      notes: null,
    });
    dailyRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Running totals start from the presale bucket (if any) so the
  // first daily row already includes pre-launch contribution.
  let runSpend = presale ? paidSpendOf(presale) : 0;
  let runClicks = presale ? paidLinkClicksOf(presale) : 0;
  let runTickets = num(presale?.tickets_sold);
  let runRevenue = num(presale?.revenue);

  const dailyDisplay: DisplayRow[] = dailyRows.map((r) => {
    runSpend += num(r.ad_spend);
    runClicks += num(r.link_clicks);
    runTickets += num(r.tickets_sold);
    runRevenue += num(r.revenue);
    return {
      key: `d-${r.date}`,
      label: fmtDateLabel(r.date),
      isPresale: false,
      isToday: r.date === todayStr,
      isSynthetic: r.isSynthetic,
      date: r.date,
      source: r.source,
      ad_spend: r.ad_spend,
      meta_ad_spend: r.meta_ad_spend,
      other_spend: r.other_spend,
      other_spend_tooltip: r.other_spend_tooltip,
      link_clicks: r.link_clicks,
      meta_regs: r.meta_regs,
      impressions: r.impressions,
      video_views: r.video_views,
      tickets_sold: r.tickets_sold,
      revenue: r.revenue,
      notes: r.notes,
      running_spend: round2(runSpend),
      running_clicks: runClicks,
      running_tickets: runTickets,
      running_revenue: round2(runRevenue),
    };
  });

  // Reverse so newest is on top to match the spec ("sorted date desc").
  dailyDisplay.reverse();

  if (presale) {
    const presaleRow: DisplayRow = {
      key: "presale",
      label: presale.earliestDate
        ? `Presale (from ${fmtDateLabel(presale.earliestDate)})`
        : "Presale",
      isPresale: true,
      isToday: false,
      isSynthetic: false,
      date: null,
      // Presale bucket is rollup-only by construction; the renderer
      // suppresses the badge for `isPresale` rows anyway, so this
      // value is just shape-completeness.
      source: null,
      ad_spend: paidSpendOf(presale),
      meta_ad_spend: presale.ad_spend,
      other_spend: null,
      other_spend_tooltip: null,
      link_clicks: paidLinkClicksOf(presale),
      meta_regs: null,
      impressions: null,
      video_views: null,
      tickets_sold: presale.tickets_sold,
      revenue: presale.revenue,
      notes: null,
      // Presale running totals = the bucket's own numbers — it sits
      // chronologically before every dated row, so cumulative-as-of-
      // end-of-presale is just the bucket sum. Reading the table
      // bottom-up (oldest → newest) the daily running totals already
      // start FROM these values, so the sequence stays monotonic.
      running_spend: round2(paidSpendOf(presale)),
      running_clicks: paidLinkClicksOf(presale),
      running_tickets: num(presale.tickets_sold),
      running_revenue: round2(num(presale.revenue)),
    };
    // Presale is the chronologically earliest activity in the
    // dataset (everything strictly before `general_sale_at`). With
    // the daily list reversed to newest-first, the presale rolled-up
    // bucket therefore belongs at the BOTTOM of the table — below
    // the oldest dated row — not at the top where it used to live
    // (PR #57 #1). Reading top → bottom now mirrors a calendar from
    // "today" back to "before sale opened".
    return [...dailyDisplay, presaleRow];
  }

  return dailyDisplay;
}

// ─── Cadence toggle ──────────────────────────────────────────────────

/**
 * Compact two-button segmented control for the cadence toggle. Inline
 * rather than a shared UI primitive so we don't expand the
 * `components/ui/**` boundary for a single use site. Matches the
 * existing tracker chrome (border + muted bg + xs/[10px] type).
 */
function CadenceToggle({
  value,
  onChange,
}: {
  value: TrackerCadence;
  onChange: (next: TrackerCadence) => void;
}) {
  const opts: { id: TrackerCadence; label: string }[] = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Tracker cadence"
      className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5 text-[11px]"
    >
      {opts.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={`rounded px-2 py-1 font-medium tracking-wide transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Weekly display-row builder ──────────────────────────────────────

/**
 * ISO-week (Monday W/C) aggregation of the same daily timeline the
 * daily view consumes. Pure function; reuses the `DisplayRow` shape so
 * the table render stays unchanged between modes.
 *
 * Aggregation rules (matches the spec):
 *   - Group rows by Monday W/C in UTC (handles dates anchored as
 *     YYYY-MM-DD by the API — see `mondayUtc`).
 *   - Sum spend / link clicks / tickets / revenue across the 7 daily
 *     rows. Null vs zero is preserved: a week where every contributing
 *     day is null stays null (renders "—"), distinct from a week with
 *     genuine zero sales (renders "£0.00" / "0").
 *   - CPT / ROAS / CPL are recomputed from the weekly sums (NEVER
 *     averaged across daily ratios — would weight by date, lying
 *     about the week rate). Same rule as the daily builder.
 *   - Padding: from the Monday of the earliest dated row to the
 *     Monday of today (current W/C). Empty weeks render em-dashes
 *     and the running totals carry forward unchanged.
 *   - Running totals are cumulative across the padded weeks, seeded
 *     from the presale bucket so the first weekly row already
 *     includes pre-launch contribution. Recomputed from the running
 *     numerators / denominators — never averaged.
 *   - Presale: surfaced as the same single bucket row at the bottom
 *     the daily view uses; weekly grouping starts from the general-
 *     sale week. Per the spec — keep the bucket as-is.
 */
function buildWeeklyDisplayRows({
  timeline,
  presale,
  otherSpendByDate = EMPTY_OTHER_SPEND_MAP,
  otherSpendBreakdownByDate,
  isBrandCampaign,
}: {
  timeline: TimelineRow[];
  presale: PresaleBucket | null;
  otherSpendByDate?: ReadonlyMap<string, number>;
  otherSpendBreakdownByDate?: ReadonlyMap<string, SpendCategoryLine[]>;
  isBrandCampaign: boolean;
}): DisplayRow[] {
  const generalSaleCutoff = presale?.cutoffDate ?? null;

  // Daily rows post-cutoff (or all rows when there's no cutoff).
  // Sort ascending so we can fold into weeks in order.
  const dailyRows = (
    generalSaleCutoff
      ? timeline.filter((r) => r.date >= generalSaleCutoff)
      : timeline.slice()
  ).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Working aggregate per week. We track null vs 0 explicitly so a
  // week with no Eventbrite reporting at all renders "—" instead of
  // a misleading "£0.00".
  type WeekAgg = {
    weekStart: string; // YYYY-MM-DD of Mon W/C (UTC)
    spend: number | null;
    metaSpend: number | null;
    otherSpend: number | null;
    /** Merged additional-spend categories for the week (tooltip). */
    otherCategoryTotals: Map<string, number> | null;
    clicks: number | null;
    regs: number | null;
    impressions: number | null;
    videoViews: number | null;
    tickets: number | null;
    revenue: number | null;
    /** True when at least one daily row in the week was synthesised
     *  from a `manual` source — used only to decide that the per-row
     *  source badge can't apply. The renderer hides the badge in
     *  weekly mode unconditionally; this is here for parity with the
     *  DisplayRow shape. */
    hasManualSource: boolean;
  };

  const weekMap = new Map<string, WeekAgg>();
  for (const r of dailyRows) {
    const wk = mondayUtc(r.date);
    if (!wk) continue;
    const cur =
      weekMap.get(wk) ??
      ({
        weekStart: wk,
        spend: null,
        metaSpend: null,
        otherSpend: null,
        otherCategoryTotals: null,
        clicks: null,
        regs: null,
        impressions: null,
        videoViews: null,
        tickets: null,
        revenue: null,
        hasManualSource: false,
      } satisfies WeekAgg);
    const spend = paidSpendForDisplay(r, isBrandCampaign);
    if (
      spend > 0 ||
      r.ad_spend !== null ||
      r.ad_spend_allocated != null ||
      r.tiktok_spend !== null ||
      r.google_ads_spend != null
    )
      cur.spend = (cur.spend ?? 0) + spend;
    if (r.ad_spend !== null)
      cur.metaSpend = (cur.metaSpend ?? 0) + Number(r.ad_spend);
    const od = otherSpendByDate.get(r.date);
    if (od != null)
      cur.otherSpend = (cur.otherSpend ?? 0) + od;
    const br = otherSpendBreakdownByDate?.get(r.date);
    if (br && br.length > 0) {
      if (!cur.otherCategoryTotals) cur.otherCategoryTotals = new Map();
      for (const line of br) {
        cur.otherCategoryTotals.set(
          line.category,
          (cur.otherCategoryTotals.get(line.category) ?? 0) + line.amount,
        );
      }
    }
    const clicks = paidLinkClicksOf(r);
    if (clicks > 0 || r.link_clicks !== null || r.tiktok_clicks !== null)
      cur.clicks = (cur.clicks ?? 0) + clicks;
    if (r.meta_regs != null)
      cur.regs = (cur.regs ?? 0) + Number(r.meta_regs);
    const impressions = totalImpressionsOf(r);
    if (impressions > 0)
      cur.impressions = (cur.impressions ?? 0) + impressions;
    const videoViews = totalVideoViewsOf(r);
    if (videoViews > 0)
      cur.videoViews = (cur.videoViews ?? 0) + videoViews;
    if (r.tickets_sold !== null)
      cur.tickets = (cur.tickets ?? 0) + Number(r.tickets_sold);
    if (r.revenue !== null)
      cur.revenue = (cur.revenue ?? 0) + Number(r.revenue);
    if (r.source === "manual") cur.hasManualSource = true;
    weekMap.set(wk, cur);
  }

  // Pad from the earliest data week up to the current week (Monday
  // containing today, UTC). Mirrors the daily padder so empty weeks
  // still render and the running totals advance through them.
  const todayWk = mondayUtcFromDate(new Date());
  const sortedWeeks = [...weekMap.keys()].sort();
  const earliestWk = sortedWeeks[0] ?? todayWk;
  const allWeeks = weekRangeUtc(earliestWk, todayWk);

  // Running totals seeded from presale, identical seeding to the
  // daily builder so the two cadences agree on the running spine.
  let runSpend = presale ? paidSpendOf(presale) : 0;
  let runClicks = presale ? paidLinkClicksOf(presale) : 0;
  let runTickets = num(presale?.tickets_sold);
  let runRevenue = num(presale?.revenue);

  const weeklyDisplay: DisplayRow[] = allWeeks.map((wk) => {
    const agg = weekMap.get(wk) ?? null;
    const spend = agg?.spend ?? null;
    const metaSpend = agg?.metaSpend ?? null;
    const otherSp = agg?.otherSpend ?? null;
    const clicks = agg?.clicks ?? null;
    const regs = agg?.regs ?? null;
    const impressions = agg?.impressions ?? null;
    const videoViews = agg?.videoViews ?? null;
    const tickets = agg?.tickets ?? null;
    const revenue = agg?.revenue ?? null;
    const otherTooltipLines =
      agg?.otherCategoryTotals && agg.otherCategoryTotals.size > 0
        ? sortSpendCategoryLines(
            [...agg.otherCategoryTotals.entries()].map(
              ([category, amount]) => ({ category, amount }),
            ),
          )
        : undefined;
    runSpend += num(spend);
    runClicks += num(clicks);
    runTickets += num(tickets);
    runRevenue += num(revenue);
    return {
      // Prefix prevents key collision with the daily `d-${date}` rows
      // when the same instance is reused across cadence flips.
      key: `w-${wk}`,
      label: fmtDateLabel(wk),
      isPresale: false,
      // "Today's row" highlight in daily mode marks the in-progress
      // entry; the weekly equivalent is the current W/C week.
      isToday: wk === todayWk,
      // No synthetic placeholder concept in weekly mode — empty weeks
      // are real weeks of the calendar, just zero-data.
      isSynthetic: false,
      // The notes column / source badge are both suppressed in
      // weekly mode by the renderer, so these per-row fields are
      // shape-completeness only.
      date: wk,
      source: agg?.hasManualSource ? "manual" : "live",
      ad_spend: spend,
      meta_ad_spend: metaSpend,
      other_spend: otherSp,
      other_spend_tooltip: fmtOtherSpendTooltipLines(otherTooltipLines),
      link_clicks: clicks,
      meta_regs: regs,
      impressions,
      video_views: videoViews,
      tickets_sold: tickets,
      revenue,
      notes: null,
      running_spend: round2(runSpend),
      running_clicks: runClicks,
      running_tickets: runTickets,
      running_revenue: round2(runRevenue),
    } satisfies DisplayRow;
  });

  // Newest week on top — matches the daily reverse so reading order
  // is identical between cadences.
  weeklyDisplay.reverse();

  if (presale) {
    // Same bucket row as the daily builder — see that function's
    // JSDoc for the chronological-bottom rationale.
    const presaleRow: DisplayRow = {
      key: "presale",
      label: presale.earliestDate
        ? `Presale (from ${fmtDateLabel(presale.earliestDate)})`
        : "Presale",
      isPresale: true,
      isToday: false,
      isSynthetic: false,
      date: null,
      source: null,
      ad_spend: paidSpendOf(presale),
      meta_ad_spend: presale.ad_spend,
      other_spend: null,
      other_spend_tooltip: null,
      link_clicks: paidLinkClicksOf(presale),
      meta_regs: null,
      impressions: null,
      video_views: null,
      tickets_sold: presale.tickets_sold,
      revenue: presale.revenue,
      notes: null,
      running_spend: round2(paidSpendOf(presale)),
      running_clicks: paidLinkClicksOf(presale),
      running_tickets: num(presale.tickets_sold),
      running_revenue: round2(num(presale.revenue)),
    };
    return [...weeklyDisplay, presaleRow];
  }

  return weeklyDisplay;
}

/** UTC Monday-of-week for a YYYY-MM-DD date string, returned as
 *  YYYY-MM-DD. ISO weeks start on Monday; JS getUTCDay() returns
 *  0=Sun..6=Sat, so we shift Sunday to 7 first. Returns `null` on a
 *  malformed input rather than guessing. */
function mondayUtc(yyyymmdd: string): string | null {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return mondayUtcFromDate(d);
}

function mondayUtcFromDate(d: Date): string {
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=Mon..7=Sun
  const monday = new Date(d.getTime());
  monday.setUTCDate(monday.getUTCDate() - (dow - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

/** Inclusive list of Mon W/C YYYY-MM-DD strings between two
 *  Monday-anchored weeks. Capped at 104 entries (~2 years) so a
 *  malformed earliest-week date can't blow up the row count — the
 *  daily builder enforces a similar 365-day cap for the same reason. */
function weekRangeUtc(startMonday: string, endMonday: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startMonday}T00:00:00Z`);
  const end = new Date(`${endMonday}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return startMonday === endMonday ? [startMonday] : [];
  }
  const MAX_WEEKS = 104;
  for (let i = 0; i <= MAX_WEEKS; i++) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i * 7);
    if (d.getTime() > end.getTime()) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────

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

function num(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return Number(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function derive(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null) return null;
  if (denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

function paidSpendForDisplay(row: TimelineRow, isBrandCampaign: boolean): number {
  if (!isBrandCampaign) return paidSpendOf(row);
  return (
    num(row.ad_spend_allocated ?? row.ad_spend) +
    num(row.google_ads_spend) +
    num(row.tiktok_spend)
  );
}

function totalImpressionsOf(row: {
  tiktok_impressions?: number | null;
  google_ads_impressions?: number | null;
}): number {
  return num(row.tiktok_impressions) + num(row.google_ads_impressions);
}

function totalVideoViewsOf(row: {
  tiktok_video_views?: number | null;
  google_ads_video_views?: number | null;
}): number {
  return num(row.tiktok_video_views) + num(row.google_ads_video_views);
}

function fmtMoney(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  // fmtCurrency renders "£0.00" for zero — reads as "spent £0", which
  // is what we want for a synced day with no Meta spend yet.
  return fmtCurrency(Number(n));
}

function fmtInt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(Number(n)).toLocaleString("en-GB");
}

function fmtRoas(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function fmtDateLabel(yyyymmdd: string): string {
  // Date-only string parsed as local midnight to avoid TZ drift, same
  // pattern as lib/dashboard/format.ts/fmtDate.
  const d = new Date(`${yyyymmdd}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return yyyymmdd;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Manual-entry editor dialog ──────────────────────────────────────
//
// Operator-facing modal for the per-row edit pencil. Three inputs:
// Tickets, Revenue, Notes. Save → PATCH /api/ticketing/rollup with
// only the columns that actually changed (so an untouched field
// preserves whatever the sync wrote vs. blanking it).
//
// Weekly mode: the row's `date` already points at the W/C Monday
// (set by `buildWeeklyDisplayRows`), so the PATCH lands on the
// Monday row. The aggregation logic re-runs on refresh and the
// week's totals reflect the new value. No spreading across days —
// per the spec "Write the value onto that Monday row".
//
// Validation matches the API:
//   - Tickets: empty -> null, else non-negative integer.
//   - Revenue: empty -> null, else non-negative number (£).
//   - Notes:   trimmed; empty -> null.

interface RowEditDialogProps {
  eventId: string;
  row: DisplayRow;
  cadence: TrackerCadence;
  onClose: () => void;
  /** Called after a successful PATCH with the patch the API
   *  accepted. Parent applies it as an optimistic override + fires
   *  the orchestrator's refresh. */
  onSaved: (
    isoDate: string,
    patch: {
      tickets_sold?: number | null;
      revenue?: number | null;
      notes?: string | null;
    },
  ) => void;
}

function RowEditDialog({
  eventId,
  row,
  cadence,
  onClose,
  onSaved,
}: RowEditDialogProps) {
  // Pre-fill from current row values. Empty string sentinel means
  // "operator hasn't entered a value" — the same input renders both
  // "user typed blank to clear" (saved as null) and "field was null
  // when the editor opened" (no change). We disambiguate at save
  // time by comparing the trimmed value to the initial.
  const [tickets, setTickets] = useState<string>(
    row.tickets_sold == null ? "" : String(row.tickets_sold),
  );
  const [revenue, setRevenue] = useState<string>(
    row.revenue == null ? "" : String(row.revenue),
  );
  const [notes, setNotes] = useState<string>(row.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isoDate = row.date;
  if (!isoDate) {
    // Defensive — RowEl already guards against opening the editor on
    // a presale / synthetic row, but render nothing in case the
    // guard slipped (e.g. a future caller).
    return null;
  }

  const handleSave = async () => {
    setError(null);

    // Build the partial body: include only the keys whose input
    // value differs from the row's initial value. `null` is
    // explicit "clear"; omitted is "leave alone".
    const patch: {
      tickets_sold?: number | null;
      revenue?: number | null;
      notes?: string | null;
    } = {};

    const ticketsTrim = tickets.trim();
    const initTickets = row.tickets_sold == null ? "" : String(row.tickets_sold);
    if (ticketsTrim !== initTickets) {
      if (ticketsTrim === "") {
        patch.tickets_sold = null;
      } else {
        const n = Number(ticketsTrim);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          setError("Tickets must be a whole non-negative number.");
          return;
        }
        patch.tickets_sold = n;
      }
    }

    const revenueTrim = revenue.trim();
    const initRevenue = row.revenue == null ? "" : String(row.revenue);
    if (revenueTrim !== initRevenue) {
      if (revenueTrim === "") {
        patch.revenue = null;
      } else {
        const n = Number(revenueTrim);
        if (!Number.isFinite(n) || n < 0) {
          setError("Revenue must be a non-negative number.");
          return;
        }
        // Round to 2dp — the column is numeric(12,2). Avoids the
        // float-tail problem on Excel pastes (e.g. 12.005).
        patch.revenue = Math.round(n * 100) / 100;
      }
    }

    const notesTrim = notes.trim();
    const initNotes = row.notes ?? "";
    if (notesTrim !== initNotes) {
      patch.notes = notesTrim === "" ? null : notesTrim;
    }

    if (Object.keys(patch).length === 0) {
      // Nothing changed — just close.
      onClose();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/ticketing/rollup?eventId=${encodeURIComponent(
          eventId,
        )}&date=${encodeURIComponent(isoDate)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Save failed.");
      }
      onSaved(isoDate, patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={saving ? () => {} : onClose}>
      <DialogContent>
        <DialogHeader onClose={saving ? undefined : onClose}>
          <DialogTitle>Edit {cadence === "weekly" ? "week" : "day"}</DialogTitle>
          <DialogDescription>
            {cadence === "weekly"
              ? `Editing W/C ${row.label}. Saved values land on the Monday row and the week aggregates around them.`
              : `Editing ${row.label}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Input
            id="row-edit-tickets"
            label="Tickets"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={tickets}
            placeholder="—"
            onChange={(e) => setTickets(e.target.value)}
            disabled={saving}
          />
          <Input
            id="row-edit-revenue"
            label="Revenue (£)"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={revenue}
            placeholder="—"
            onChange={(e) => setRevenue(e.target.value)}
            disabled={saving}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="row-edit-notes"
              className="text-sm font-medium text-foreground"
            >
              Notes
            </label>
            <textarea
              id="row-edit-notes"
              value={notes}
              placeholder="Optional context for this row"
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              rows={3}
              className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            />
          </div>
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
