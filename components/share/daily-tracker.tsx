"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { DailyEntry, PortalEvent } from "@/lib/db/client-portal-server";

/**
 * Per-venue daily tracker rendered inside each VenueSection of the
 * client portal. Mirrors the Excel sheet the client team currently
 * keeps by hand — one row per calendar day, aggregated across every
 * event at the venue. Read-only on the public portal (the sibling
 * POST /daily endpoint exists for a future internal admin UI).
 *
 * Aggregation: sums day_spend / tickets / revenue / link_clicks across
 * events sharing a date. Notes are concatenated so multi-event days
 * don't lose context. Derived columns (CPT, ROAS) are recomputed from
 * the daily totals — never averaged across pre-computed per-event
 * values, which would weight by date and lie about the venue rate.
 *
 * Row generation: pads the calendar from the *earliest* tracker entry
 * for any event at the venue up to *today* (UTC). Days without any
 * entry render with em-dashes so the timeline reads continuously and
 * the running totals carry forward correctly.
 *
 * Layout: two column groups separated by a thicker vertical divider —
 *   [Daily]   Date | Day Spend | Tickets | Revenue | CPT | ROAS | Link Clicks | Notes
 *   [Running] Spend | Tickets | Avg CPT | Revenue | ROAS
 */

interface Props {
  /** Token kept on the props surface for the future write path; the
   *  read-only render doesn't use it today, but baking it in now means
   *  flipping to editable later doesn't change the call site. */
  token: string;
  /** Events belonging to the venue. Used only to label the empty-state
   *  ("no entries across N events"); the table itself aggregates by
   *  date and is event-agnostic. Kept on the API so a future editable
   *  mode can still attribute writes back to a specific event. */
  events: PortalEvent[];
  /** All tracker rows for the venue (parent already filtered by
   *  event_id so every entry here is in-scope). */
  entries: DailyEntry[];
  /** Future hook for the editable mode. Read-only render never calls
   *  this, but exposing it now keeps the API stable. */
  onEntryChanged?: () => void;
}

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

function formatGBP2(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return GBP2.format(n);
}
function formatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}
function formatRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

/**
 * Render a YYYY-MM-DD date string as `Mon 14 Apr` in en-GB. UTC-
 * anchored so the rendered weekday matches the API's date storage
 * (which is a date, not a timestamp).
 */
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Today as YYYY-MM-DD in UTC (matches how the API stores `date`). */
function todayUtcIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Inclusive range of YYYY-MM-DD strings between start and end (UTC),
 *  capped at 365 entries so a malformed earliest-entry date can't
 *  blow up the row count. */
function dateRangeUtc(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return startIso === endIso ? [startIso] : [];
  }
  const MAX_DAYS = 365;
  for (let i = 0; i <= MAX_DAYS; i++) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getTime() > end.getTime()) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Per-date aggregate of the venue's daily tracker entries.
 *
 *  Nulls propagate: a date where every contributing entry has a null
 *  for a given field stays null (rather than coalescing to 0) so the
 *  UI can render "—" instead of a misleading "£0.00 spend on a day
 *  with no data". */
interface DateAgg {
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  notes: string | null;
}

function aggregateByDate(entries: DailyEntry[]): Map<string, DateAgg> {
  const map = new Map<string, DateAgg>();
  for (const e of entries) {
    const cur =
      map.get(e.date) ??
      ({
        spend: null,
        tickets: null,
        revenue: null,
        linkClicks: null,
        notes: null,
      } as DateAgg);
    if (e.day_spend !== null) cur.spend = (cur.spend ?? 0) + e.day_spend;
    if (e.tickets !== null) cur.tickets = (cur.tickets ?? 0) + e.tickets;
    if (e.revenue !== null) cur.revenue = (cur.revenue ?? 0) + e.revenue;
    if (e.link_clicks !== null)
      cur.linkClicks = (cur.linkClicks ?? 0) + e.link_clicks;
    if (e.notes && e.notes.trim() !== "") {
      // Concatenate distinct notes from multiple events on the same
      // day with a typographic divider. Dedup so a single note
      // duplicated across events doesn't render twice.
      const next = e.notes.trim();
      cur.notes =
        cur.notes === null
          ? next
          : cur.notes.split(" · ").includes(next)
            ? cur.notes
            : `${cur.notes} · ${next}`;
    }
    map.set(e.date, cur);
  }
  return map;
}

interface DayRow {
  date: string;
  daySpend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  notes: string | null;
  cpt: number | null;
  roas: number | null;
  runSpend: number;
  runTickets: number;
  runRevenue: number;
  runCpt: number | null;
  runRoas: number | null;
}

/**
 * Build the padded-calendar timeline for the venue: one row per day
 * from the earliest entry across every event at the venue to today.
 * Daily arithmetic (CPT, ROAS) is recomputed from the *aggregated*
 * daily totals — running arithmetic accumulates whichever side it has.
 */
function buildRows(entries: DailyEntry[]): DayRow[] {
  if (entries.length === 0) return [];
  const aggregate = aggregateByDate(entries);
  const dates = [...aggregate.keys()].sort();
  if (dates.length === 0) return [];
  const earliest = dates[0];
  const allDates = dateRangeUtc(earliest, todayUtcIso());

  const rows: DayRow[] = [];
  let runSpend = 0;
  let runTickets = 0;
  let runRevenue = 0;
  for (const date of allDates) {
    const agg = aggregate.get(date) ?? null;
    const daySpend = agg?.spend ?? null;
    const tickets = agg?.tickets ?? null;
    const revenue = agg?.revenue ?? null;
    const linkClicks = agg?.linkClicks ?? null;
    const notes = agg?.notes ?? null;
    const cpt =
      daySpend !== null && daySpend > 0 && tickets !== null && tickets > 0
        ? daySpend / tickets
        : null;
    const roas =
      revenue !== null && revenue > 0 && daySpend !== null && daySpend > 0
        ? revenue / daySpend
        : null;
    runSpend += daySpend ?? 0;
    runTickets += tickets ?? 0;
    runRevenue += revenue ?? 0;
    const runCpt =
      runSpend > 0 && runTickets > 0 ? runSpend / runTickets : null;
    const runRoas = runSpend > 0 && runRevenue > 0 ? runRevenue / runSpend : null;
    rows.push({
      date,
      daySpend,
      tickets,
      revenue,
      linkClicks,
      notes,
      cpt,
      roas,
      runSpend,
      runTickets,
      runRevenue,
      runCpt,
      runRoas,
    });
  }
  return rows;
}

export function DailyTracker({ events, entries }: Props) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => buildRows(entries), [entries]);
  const hasEntries = entries.length > 0;
  const eventCount = events.length;

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          Daily Tracker
          {!hasEntries ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal normal-case text-muted-foreground">
              no entries yet
            </span>
          ) : (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal normal-case text-muted-foreground">
              {entries.length} entr{entries.length === 1 ? "y" : "ies"} across{" "}
              {eventCount} event{eventCount === 1 ? "" : "s"}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="border-t border-border bg-muted/50 px-4 py-4">
          {rows.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No daily entries recorded for this venue yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[1100px] border-collapse text-xs">
                <thead>
                  {/* Two-row header so the [Daily | Running] grouping
                      is visually unambiguous. The tall divider on the
                      Running cells carries through every row below via
                      `border-l-2`. */}
                  <tr className="bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium" colSpan={8}>
                      Daily
                    </th>
                    <th
                      className="border-l-2 border-border-strong px-2 py-1.5 text-left font-medium"
                      colSpan={5}
                    >
                      Running
                    </th>
                  </tr>
                  <tr className="bg-foreground text-left text-[10px] font-medium uppercase tracking-wide text-background">
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Day Spend</th>
                    <th className="px-2 py-2 text-right">Tickets</th>
                    <th className="px-2 py-2 text-right">Revenue</th>
                    <th className="px-2 py-2 text-right">CPT</th>
                    <th className="px-2 py-2 text-right">ROAS</th>
                    <th className="px-2 py-2 text-right">Link Clicks</th>
                    <th className="px-2 py-2 text-left">Notes</th>
                    <th className="border-l-2 border-background/30 px-2 py-2 text-right">
                      Spend
                    </th>
                    <th className="px-2 py-2 text-right">Tickets</th>
                    <th className="px-2 py-2 text-right">Avg CPT</th>
                    <th className="px-2 py-2 text-right">Revenue</th>
                    <th className="px-2 py-2 text-right">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={r.date}
                      className={`border-t border-border ${
                        i % 2 === 1 ? "bg-muted/40" : "bg-card"
                      }`}
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap text-foreground">
                        {formatDate(r.date)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatGBP2(r.daySpend)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatNumber(r.tickets)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatGBP2(r.revenue)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatGBP2(r.cpt)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatRoas(r.roas)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
                        {formatNumber(r.linkClicks)}
                      </td>
                      <td
                        className="max-w-[24ch] truncate px-2 py-1.5 text-muted-foreground"
                        title={r.notes ?? ""}
                      >
                        {r.notes ?? "—"}
                      </td>
                      <td className="border-l-2 border-border-strong px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                        {formatGBP2(r.runSpend)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                        {formatNumber(r.runTickets)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                        {formatGBP2(r.runCpt)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                        {formatGBP2(r.runRevenue)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium text-foreground">
                        {formatRoas(r.runRoas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
