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
 * Presale bucket:
 *   When `events.general_sale_at` is set, every row whose date is
 *   strictly before that cutoff collapses into a single "Presale"
 *   row at the top. Server computes the bucket via
 *   /api/ticketing/rollup so the client doesn't need the cutoff
 *   semantics. Running cols include the bucket as the first
 *   contributor, matching the xlsx behaviour.
 *
 * Empty state:
 *   When the event has neither a Meta event_code nor an Eventbrite
 *   link, the table renders a CTA pointing to the connect/link flow
 *   instead of an empty grid. This is intentionally upstream of the
 *   "no rows yet" state — those two cases want different copy.
 *
 * Sync model:
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
}

interface DisplayRow {
  key: string;
  /** Label shown in the Date column ("Presale", or formatted date). */
  label: string;
  /** True for the Presale bucket — used for subtle styling. */
  isPresale: boolean;
  /** True when this row is "today" — used for highlight. */
  isToday: boolean;
  /** True for the synthetic empty "today" row. */
  isSynthetic: boolean;
  /** Source date string for the row (used as PATCH key for notes). */
  date: string | null;
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
}: Props) {
  const [rows, setRows] = useState<DailyRollup[]>([]);
  const [presale, setPresale] = useState<PresaleBucket | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legErrors, setLegErrors] = useState<{
    meta?: string;
    eventbrite?: string;
  } | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(
      `/api/ticketing/rollup?eventId=${encodeURIComponent(eventId)}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as RollupResponse;
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Failed to load rollup data.");
    }
    setRows(json.rows ?? []);
    setPresale(json.presale ?? null);
  }, [eventId]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setError(null);
    setLegErrors(null);
    try {
      const res = await fetch(
        `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(eventId)}`,
        { method: "POST" },
      );
      const json = (await res.json()) as SyncResponse;
      // 207 means partial success — surface per-leg errors but keep
      // refreshing so the working leg's data lands.
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
  }, [eventId, refresh]);

  // Initial load
  useEffect(() => {
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
  }, [refresh]);

  // Auto-sync when stale or empty.
  useEffect(() => {
    if (autoTried || loading) return;
    if (!hasMetaScope && !hasEventbriteLink) return;
    const stale = isStale(rows);
    if (rows.length > 0 && !stale) return;
    setAutoTried(true);
    void syncNow();
  }, [autoTried, loading, rows, syncNow, hasMetaScope, hasEventbriteLink]);

  const display = useMemo(
    () => buildDisplayRows({ rows, presale }),
    [rows, presale],
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
          Refresh
        </Button>
      </header>

      {error ? (
        <p className="mx-4 mt-3 inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
      {legErrors?.meta ? (
        <p className="mx-4 mt-3 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertCircle className="h-3 w-3" />
          Meta: {legErrors.meta}
        </p>
      ) : null}
      {legErrors?.eventbrite ? (
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
                  onNotesSaved={(date, notes) => {
                    setRows((prev) =>
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
  onNotesSaved,
}: {
  row: DisplayRow;
  eventId: string;
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

  return (
    <tr className={rowClass}>
      <Td align="left">
        <span className={row.isPresale ? "tracking-wide" : ""}>
          {row.label}
        </span>
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
          <NotesCell
            eventId={eventId}
            date={row.date}
            initial={row.notes}
            onSaved={(n) => onNotesSaved(row.date as string, n)}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
    </tr>
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
  rows,
  presale,
}: {
  rows: DailyRollup[];
  presale: PresaleBucket | null;
}): DisplayRow[] {
  const todayStr = ymd(new Date());
  const generalSaleCutoff = presale?.cutoffDate ?? null;

  // Rows after the cutoff (or all rows when there is no cutoff). Sort
  // ascending so we can compute running totals in chronological order;
  // we'll reverse at the end to render newest-first.
  const dailyRows = (
    generalSaleCutoff
      ? rows.filter((r) => r.date >= generalSaleCutoff)
      : rows.slice()
  ).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Synthetic "today" row when today isn't in the dataset yet — keeps
  // the table responsive even before the first sync writes anything
  // for today.
  const hasToday = dailyRows.some((r) => r.date === todayStr);
  if (!hasToday && (!generalSaleCutoff || todayStr >= generalSaleCutoff)) {
    dailyRows.push({
      id: `synthetic-${todayStr}`,
      user_id: "",
      event_id: "",
      date: todayStr,
      ad_spend: null,
      link_clicks: null,
      tickets_sold: null,
      revenue: null,
      source_meta_at: null,
      source_eventbrite_at: null,
      notes: null,
      created_at: "",
      updated_at: "",
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
    const isSynthetic = r.id.startsWith("synthetic-");
    return {
      key: `d-${r.date}`,
      label: fmtDateLabel(r.date),
      isPresale: false,
      isToday: r.date === todayStr,
      isSynthetic,
      date: r.date,
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

function isStale(rows: DailyRollup[]): boolean {
  if (rows.length === 0) return true;
  let newest = 0;
  for (const r of rows) {
    const m = r.source_meta_at ? new Date(r.source_meta_at).getTime() : 0;
    const e = r.source_eventbrite_at
      ? new Date(r.source_eventbrite_at).getTime()
      : 0;
    if (m > newest) newest = m;
    if (e > newest) newest = e;
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
