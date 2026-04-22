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
import { fmtCurrency } from "@/lib/dashboard/format";
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

interface DailyRollup {
  id: string;
  user_id: string;
  event_id: string;
  date: string;
  ad_spend: number | null;
  link_clicks: number | null;
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

interface Props {
  eventId: string;
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
    /** Suppresses notes editing + the per-table Refresh button.
     *  Used on the public share page where the token is read-only. */
    readOnly?: boolean;
  };
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
  link_clicks: number | null;
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
  hasMetaScope,
  hasEventbriteLink,
  controlled,
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

  const display = useMemo(
    () => buildDisplayRows({ timeline, presale }),
    [timeline, presale],
  );

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
              Last 60 days · Meta spend &amp; clicks aggregated by{" "}
              <code className="text-foreground/80">[event_code]</code>
              {hasEventbriteLink ? " · Eventbrite tickets & revenue per day" : ""}
              {presale ? " · Presale rolled up" : ""}
            </p>
          </div>
        </div>
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
              <Th align="left">Date</Th>
              <Th>Day spend</Th>
              <Th>Tickets</Th>
              <Th>Revenue</Th>
              <Th>CPT</Th>
              <Th>ROAS</Th>
              <Th>Link clicks</Th>
              <Th>CPL</Th>
              <Th>Running spend</Th>
              <Th>Running tickets</Th>
              <Th>Running avg CPT</Th>
              <Th>Running revenue</Th>
              <Th>Running ROAS</Th>
              <Th align="left">Notes</Th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" />{" "}
                  Loading…
                </td>
              </tr>
            ) : display.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
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
                  readOnly={readOnly}
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
    </section>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────

function RowEl({
  row,
  eventId,
  readOnly,
  onNotesSaved,
}: {
  row: DisplayRow;
  eventId: string;
  readOnly: boolean;
  onNotesSaved: (date: string, notes: string | null) => void;
}) {
  const cpt = derive(row.ad_spend, row.tickets_sold);
  const cpl = derive(row.ad_spend, row.link_clicks);
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
          {row.source && !row.isSynthetic && !row.isPresale ? (
            <SourceBadge source={row.source} />
          ) : null}
        </div>
      </Td>
      <Td>{fmtMoney(row.ad_spend)}</Td>
      <Td>{fmtInt(row.tickets_sold)}</Td>
      <Td>{fmtMoney(row.revenue)}</Td>
      <Td>{fmtMoney(cpt)}</Td>
      <Td>{fmtRoas(roas)}</Td>
      <Td>{fmtInt(row.link_clicks)}</Td>
      <Td>{fmtMoney(cpl)}</Td>
      <Td>{fmtMoney(row.running_spend)}</Td>
      <Td>{fmtInt(row.running_tickets)}</Td>
      <Td>{fmtMoney(runCpt)}</Td>
      <Td>{fmtMoney(row.running_revenue)}</Td>
      <Td>{fmtRoas(runRoas)}</Td>
      <Td align="left" wide>
        {row.date ? (
          notesReadOnly ? (
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
      </Td>
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

function buildDisplayRows({
  timeline,
  presale,
}: {
  timeline: TimelineRow[];
  presale: PresaleBucket | null;
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
    link_clicks: number | null;
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
      ad_spend: r.ad_spend,
      link_clicks: r.link_clicks,
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
  if (!hasToday && (!generalSaleCutoff || todayStr >= generalSaleCutoff)) {
    dailyRows.push({
      date: todayStr,
      source: "live",
      isSynthetic: true,
      ad_spend: null,
      link_clicks: null,
      tickets_sold: null,
      revenue: null,
      notes: null,
    });
    dailyRows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // Running totals start from the presale bucket (if any) so the
  // first daily row already includes pre-launch contribution.
  let runSpend = num(presale?.ad_spend);
  let runClicks = num(presale?.link_clicks);
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
      link_clicks: r.link_clicks,
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
      ad_spend: presale.ad_spend,
      link_clicks: presale.link_clicks,
      tickets_sold: presale.tickets_sold,
      revenue: presale.revenue,
      notes: null,
      running_spend: round2(num(presale.ad_spend)),
      running_clicks: num(presale.link_clicks),
      running_tickets: num(presale.tickets_sold),
      running_revenue: round2(num(presale.revenue)),
    };
    return [presaleRow, ...dailyDisplay];
  }

  return dailyDisplay;
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
