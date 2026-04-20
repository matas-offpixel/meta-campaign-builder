"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { DailyEntry, PortalEvent } from "@/lib/db/client-portal-server";

/**
 * Per-venue daily tracker rendered inside each VenueSection of the
 * client portal. Mirrors the Excel sheet the client team currently
 * keeps by hand — one row per calendar day, one block per event in
 * the venue.
 *
 * Read-only on the public portal (the sibling POST /daily endpoint
 * exists for a future internal admin UI). Collapsed by default to
 * keep the venue table the primary surface; the toggle reveals one
 * sub-block per event.
 *
 * Row generation: pads the calendar from the *earliest* tracker entry
 * for the event up to *today* (UTC). Days without an entry render
 * with em-dashes so the timeline reads continuously and the running
 * totals carry forward correctly.
 *
 * Layout: two column groups separated by a thicker vertical divider —
 *   [Daily]   Date | Day Spend | Tickets | Revenue | CPT | ROAS | Link Clicks | Notes
 *   [Running] Spend | Tickets | Avg CPT | Revenue | ROAS
 * One wide table with `overflow-x-auto`; same wrapper pattern as the
 * main venue table so the column boundary is consistent.
 */

interface Props {
  /** Token kept on the props surface for the future write path; the
   *  read-only render doesn't use it today, but baking it in now means
   *  flipping to editable later doesn't change the call site. */
  token: string;
  /** Events belonging to the venue. The tracker renders one collapsible
   *  sub-block per event so the per-event running totals stay sane. */
  events: PortalEvent[];
  /** All tracker rows for the *client*. Filtered to this venue's
   *  events on render. */
  entries: DailyEntry[];
  /** Future hook for the editable mode. Read-only render never calls
   *  this, but exposing it now keeps the API stable. */
  onEntryChanged?: () => void;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
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
 * Render a YYYY-MM-DD date string as `Mon 14 Apr` in en-GB.
 * Anchored to UTC midnight so the rendered weekday matches the way
 * the data was keyed (the API persists ISO date strings, not
 * timestamps).
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

/** Inclusive range of YYYY-MM-DD strings between start and end (UTC). */
function dateRangeUtc(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return startIso === endIso ? [startIso] : [];
  }
  // Cap the range defensively. A bad earliest-entry date would
  // otherwise generate thousands of rows; 365 days is more than any
  // single campaign window we expect to track.
  const MAX_DAYS = 365;
  for (let i = 0; i <= MAX_DAYS; i++) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getTime() > end.getTime()) break;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
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
  // Running totals up to and including this row.
  runSpend: number;
  runTickets: number;
  runRevenue: number;
  runCpt: number | null;
  runRoas: number | null;
}

/**
 * Build the padded-calendar timeline for one event: one row per day
 * from the earliest entry to today, with empty days filled in. Daily
 * arithmetic (CPT, ROAS) needs spend AND tickets; running arithmetic
 * accumulates whichever side it has.
 */
function buildRows(entries: DailyEntry[]): DayRow[] {
  if (entries.length === 0) return [];
  const byDate = new Map<string, DailyEntry>();
  for (const e of entries) byDate.set(e.date, e);

  const earliest = entries[0].date;
  const dates = dateRangeUtc(earliest, todayUtcIso());

  const rows: DayRow[] = [];
  let runSpend = 0;
  let runTickets = 0;
  let runRevenue = 0;
  for (const date of dates) {
    const e = byDate.get(date) ?? null;
    const daySpend = e?.day_spend ?? null;
    const tickets = e?.tickets ?? null;
    const revenue = e?.revenue ?? null;
    const linkClicks = e?.link_clicks ?? null;
    const notes = e?.notes ?? null;
    const cpt =
      daySpend !== null && daySpend > 0 && tickets !== null && tickets > 0
        ? daySpend / tickets
        : null;
    const roas =
      revenue !== null && daySpend !== null && daySpend > 0
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

  // Group entries by event_id. Sort lookup once at this level so the
  // per-event blocks below can stay dumb.
  const byEvent = useMemo(() => {
    const map = new Map<string, DailyEntry[]>();
    for (const e of entries) {
      const list = map.get(e.event_id) ?? [];
      list.push(e);
      map.set(e.event_id, list);
    }
    return map;
  }, [entries]);

  const venueHasEntries = events.some(
    (ev) => (byEvent.get(ev.id)?.length ?? 0) > 0,
  );

  return (
    <div className="border-t border-zinc-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-600 transition-colors hover:bg-zinc-50"
      >
        <span className="flex items-center gap-2">
          Daily Tracker
          {!venueHasEntries && (
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-normal normal-case text-zinc-500">
              no entries yet
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
        <div className="space-y-6 border-t border-zinc-200 bg-zinc-50/50 px-4 py-4">
          {events.map((ev) => {
            const eventEntries = byEvent.get(ev.id) ?? [];
            return (
              <EventTrackerBlock
                key={ev.id}
                event={ev}
                entries={eventEntries}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function EventTrackerBlock({
  event,
  entries,
}: {
  event: PortalEvent;
  entries: DailyEntry[];
}) {
  const rows = useMemo(() => buildRows(entries), [entries]);

  return (
    <div className="rounded border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold text-zinc-900">{event.name}</h3>
          {event.event_code && (
            <span className="text-[11px] text-zinc-500">{event.event_code}</span>
          )}
        </div>
        <span className="text-[11px] text-zinc-500">
          {rows.length === 0
            ? "No tracker entries yet"
            : `${entries.length} day${entries.length === 1 ? "" : "s"} logged`}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-zinc-500">
          No daily entries recorded for this event yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-xs">
            <thead>
              {/* Two-row header so the [Daily | Running] grouping is
                  visually unambiguous. The tall divider style on the
                  Running cells carries through to every row below via
                  `border-l-2`. */}
              <tr className="bg-zinc-100 text-[10px] uppercase tracking-wider text-zinc-500">
                <th
                  className="px-2 py-1.5 text-left font-medium"
                  colSpan={8}
                >
                  Daily
                </th>
                <th
                  className="border-l-2 border-zinc-300 px-2 py-1.5 text-left font-medium"
                  colSpan={5}
                >
                  Running
                </th>
              </tr>
              <tr className="bg-zinc-900 text-left text-[10px] font-medium uppercase tracking-wide text-white">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2 text-right">Day Spend</th>
                <th className="px-2 py-2 text-right">Tickets</th>
                <th className="px-2 py-2 text-right">Revenue</th>
                <th className="px-2 py-2 text-right">CPT</th>
                <th className="px-2 py-2 text-right">ROAS</th>
                <th className="px-2 py-2 text-right">Link Clicks</th>
                <th className="px-2 py-2 text-left">Notes</th>
                <th className="border-l-2 border-zinc-700 px-2 py-2 text-right">
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
                  className={`border-t border-zinc-200 ${
                    i % 2 === 1 ? "bg-zinc-50" : "bg-white"
                  }`}
                >
                  <td className="px-2 py-1.5 whitespace-nowrap text-zinc-700">
                    {formatDate(r.date)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatGBP(r.daySpend, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatNumber(r.tickets)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatGBP(r.revenue, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatGBP(r.cpt, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatRoas(r.roas)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-zinc-700">
                    {formatNumber(r.linkClicks)}
                  </td>
                  <td
                    className="max-w-[20ch] truncate px-2 py-1.5 text-zinc-600"
                    title={r.notes ?? ""}
                  >
                    {r.notes ?? "—"}
                  </td>
                  <td className="border-l-2 border-zinc-300 px-2 py-1.5 text-right tabular-nums font-medium text-zinc-900">
                    {formatGBP(r.runSpend, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-zinc-900">
                    {formatNumber(r.runTickets)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-zinc-900">
                    {formatGBP(r.runCpt, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-zinc-900">
                    {formatGBP(r.runRevenue, 2)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium text-zinc-900">
                    {formatRoas(r.runRoas)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
