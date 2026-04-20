"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import type { PortalEvent } from "@/lib/db/client-portal-server";

interface Props {
  token: string;
  events: PortalEvent[];
  onSnapshotSaved: (
    eventId: string,
    snapshot: {
      tickets_sold: number;
      captured_at: string;
      week_start: string;
    },
  ) => void;
}

/**
 * Venue-grouped reporting table that replaces the old per-event card list
 * on /share/client/[token]. The shape mirrors the Google Sheets doc the
 * client used to maintain by hand: one section per venue, one data row per
 * event, plus a "Total" row that re-derives CPT / Revenue / ROAS from the
 * venue-level sums (not by averaging per-event values).
 *
 * Ticket input is preserved, just inline: each "Tickets Sold" cell flips
 * into an editable input on click. Save posts to the same
 * `/api/share/client/[token]/tickets` endpoint the cards used and bubbles
 * the new snapshot up via `onSnapshotSaved` so the parent can refresh
 * derived metrics without a full reload.
 *
 * All derived numbers are computed in the browser from the data the server
 * already returns — there's no network call for CPT, Revenue, or ROAS, so
 * the table re-renders instantly when a new snapshot lands.
 */

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

function formatChange(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}

function formatRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n === null) return "text-zinc-500";
  if (n >= 3) return "text-emerald-600 font-semibold";
  if (n < 1) return "text-red-600 font-semibold";
  return "text-zinc-700";
}

function cptDeltaClass(n: number | null): string {
  if (n === null) return "text-zinc-500";
  // CPT going down is good (cheaper per ticket).
  if (n < 0) return "text-emerald-600";
  if (n > 0) return "text-amber-600";
  return "text-zinc-500";
}

interface Metrics {
  prereg: number | null;
  ad: number | null;
  total: number;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  prevCpt: number | null;
  cptDelta: number | null;
  revenue: number | null;
  roas: number | null;
}

function computeMetrics(ev: PortalEvent): Metrics {
  const prereg = ev.prereg_spend;
  const ad = ev.ad_spend_actual;
  const total = (prereg ?? 0) + (ad ?? 0);
  const tickets = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
  const prev = ev.tickets_sold_previous ?? 0;
  const cpt = total > 0 && tickets > 0 ? total / tickets : null;
  const prevCpt = total > 0 && prev > 0 ? total / prev : null;
  const cptDelta = cpt !== null && prevCpt !== null ? cpt - prevCpt : null;
  const revenue = ev.ticket_price !== null ? tickets * ev.ticket_price : null;
  const roas = revenue !== null && total > 0 ? revenue / total : null;
  return {
    prereg,
    ad,
    total,
    tickets,
    prevTickets: prev,
    change: tickets - prev,
    cpt,
    prevCpt,
    cptDelta,
    revenue,
    roas,
  };
}

interface VenueGroup {
  key: string;
  displayName: string;
  city: string | null;
  budget: number | null;
  events: PortalEvent[];
}

function groupByVenue(events: PortalEvent[]): VenueGroup[] {
  const map = new Map<string, VenueGroup>();
  for (const ev of events) {
    const name = ev.venue_name ?? "Unknown venue";
    const city = ev.venue_city ?? "";
    const key = `${name}||${city}`;
    const existing = map.get(key);
    if (existing) {
      existing.events.push(ev);
      if (existing.budget === null && ev.budget_marketing !== null) {
        existing.budget = ev.budget_marketing;
      }
    } else {
      map.set(key, {
        key,
        displayName: name,
        city: ev.venue_city,
        budget: ev.budget_marketing,
        events: [ev],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

interface VenueTotals {
  prereg: number;
  ad: number;
  total: number;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  prevCpt: number | null;
  cptDelta: number | null;
  revenue: number | null;
  roas: number | null;
  hasTicketPrice: boolean;
}

function sumVenue(events: PortalEvent[]): VenueTotals {
  let prereg = 0;
  let ad = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasTicketPrice = false;
  for (const ev of events) {
    prereg += ev.prereg_spend ?? 0;
    ad += ev.ad_spend_actual ?? 0;
    const sold = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    tickets += sold;
    prevTickets += ev.tickets_sold_previous ?? 0;
    if (ev.ticket_price !== null) {
      hasTicketPrice = true;
      revenue += sold * ev.ticket_price;
    }
  }
  const total = prereg + ad;
  const cpt = total > 0 && tickets > 0 ? total / tickets : null;
  const prevCpt = total > 0 && prevTickets > 0 ? total / prevTickets : null;
  const cptDelta = cpt !== null && prevCpt !== null ? cpt - prevCpt : null;
  const finalRevenue = hasTicketPrice ? revenue : null;
  const roas = finalRevenue !== null && total > 0 ? finalRevenue / total : null;
  return {
    prereg,
    ad,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    prevCpt,
    cptDelta,
    revenue: finalRevenue,
    roas,
    hasTicketPrice,
  };
}

export function ClientPortalVenueTable({
  token,
  events,
  onSnapshotSaved,
}: Props) {
  const venues = useMemo(() => groupByVenue(events), [events]);

  if (venues.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-8 text-center">
        <p className="text-sm text-zinc-600">
          No events to report on yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {venues.map((group) => (
        <VenueSection
          key={group.key}
          token={token}
          group={group}
          onSnapshotSaved={onSnapshotSaved}
        />
      ))}
    </div>
  );
}

interface VenueSectionProps {
  token: string;
  group: VenueGroup;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

const COL_COUNT = 12;

function VenueSection({ token, group, onSnapshotSaved }: VenueSectionProps) {
  const totals = useMemo(() => sumVenue(group.events), [group.events]);
  const headerLabel = group.city
    ? `${group.displayName}, ${group.city}`
    : group.displayName;

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="font-heading text-lg tracking-wide text-zinc-900">
          {headerLabel}
        </h2>
        {group.budget !== null && (
          <p className="text-xs text-zinc-600">
            Ad Budget:{" "}
            <span className="font-semibold text-zinc-900">
              {formatGBP(group.budget)}
            </span>
          </p>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-900 text-left text-xs font-medium uppercase tracking-wide text-white">
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5 text-right">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets Sold</th>
              <th className="px-3 py-2.5 text-right">Prev</th>
              <th className="px-3 py-2.5 text-right">Change</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">Prev CPT</th>
              <th className="px-3 py-2.5 text-right">CPT Δ</th>
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {group.events.map((ev, i) => (
              <EventRow
                key={ev.id}
                token={token}
                event={ev}
                striped={i % 2 === 1}
                onSnapshotSaved={onSnapshotSaved}
              />
            ))}
            <tr className="border-t border-zinc-300 bg-zinc-100 text-zinc-900">
              <td className="px-3 py-2.5 font-semibold">Total</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.ad)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.total)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatNumber(totals.tickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-500">
                {formatNumber(totals.prevTickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatChange(totals.change)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-500">
                {formatGBP(totals.prevCpt, 2)}
              </td>
              <td
                className={`px-3 py-2.5 text-right font-semibold tabular-nums ${cptDeltaClass(totals.cptDelta)}`}
              >
                {totals.cptDelta === null
                  ? "—"
                  : `${totals.cptDelta > 0 ? "+" : ""}${GBP2.format(totals.cptDelta)}`}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(totals.roas)}`}
              >
                {formatRoas(totals.roas)}
              </td>
            </tr>
          </tbody>
        </table>
        {/* Defensive: keep the column count in sync with the header so a
            future edit doesn't silently desync the grid. */}
        <span aria-hidden="true" className="sr-only" data-col-count={COL_COUNT} />
      </div>
    </section>
  );
}

interface EventRowProps {
  token: string;
  event: PortalEvent;
  striped: boolean;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

function EventRow({ token, event, striped, onSnapshotSaved }: EventRowProps) {
  const m = computeMetrics(event);
  const rowBg = striped ? "bg-zinc-50" : "bg-white";

  return (
    <tr className={`border-t border-zinc-200 ${rowBg} hover:bg-zinc-100/50`}>
      <td className="px-3 py-2.5 align-top">
        <span className="block font-medium text-zinc-900">{event.name}</span>
        {event.event_code && (
          <span className="block text-[11px] text-zinc-500">
            {event.event_code}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {formatGBP(m.prereg)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {formatGBP(m.ad)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-zinc-900">
        {m.total > 0 ? formatGBP(m.total) : "—"}
      </td>
      <td className="px-3 py-2.5 text-right">
        <TicketsCell
          token={token}
          event={event}
          currentValue={m.tickets}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">
        {event.tickets_sold_previous === null
          ? "—"
          : formatNumber(m.prevTickets)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {event.tickets_sold_previous === null ? "—" : formatChange(m.change)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-900">
        {formatGBP(m.cpt, 2)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">
        {formatGBP(m.prevCpt, 2)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums ${cptDeltaClass(m.cptDelta)}`}
      >
        {m.cptDelta === null
          ? "—"
          : `${m.cptDelta > 0 ? "+" : ""}${GBP2.format(m.cptDelta)}`}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-900">
        {formatGBP(m.revenue)}
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}>
        {formatRoas(m.roas)}
      </td>
    </tr>
  );
}

interface TicketsCellProps {
  token: string;
  event: PortalEvent;
  currentValue: number;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

function TicketsCell({
  token,
  event,
  currentValue,
  onSnapshotSaved,
}: TicketsCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(currentValue));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const beginEdit = () => {
    setDraft(String(currentValue));
    setSave({ kind: "idle" });
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setSave({ kind: "idle" });
  };

  const submit = async () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setSave({ kind: "error", message: "Whole numbers only" });
      return;
    }
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: event.id, tickets_sold: parsed }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved(event.id, {
        tickets_sold: parsed,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setSave({ kind: "saved", at: Date.now() });
      setEditing(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSave({ kind: "error", message });
    }
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") cancel();
          }}
          disabled={save.kind === "saving"}
          aria-label={`Tickets sold for ${event.name}`}
          className="h-7 w-20 rounded border border-zinc-300 bg-white px-2 text-right text-sm tabular-nums text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:bg-zinc-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={save.kind === "saving"}
          className="inline-flex h-7 items-center gap-1 rounded bg-zinc-900 px-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {save.kind === "saving" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            "Save"
          )}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={save.kind === "saving"}
          className="text-[11px] text-zinc-500 hover:text-zinc-900"
        >
          Cancel
        </button>
        {save.kind === "error" && (
          <span className="ml-1 text-[11px] text-red-600">{save.message}</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={beginEdit}
      className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-right tabular-nums text-zinc-900 hover:bg-zinc-200/60"
      aria-label={`Edit tickets sold for ${event.name}`}
    >
      <span className="font-medium">{formatNumber(currentValue)}</span>
      <Pencil className="h-3 w-3 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
      {save.kind === "saved" && (
        <span className="text-[11px] font-medium text-emerald-600">✓</span>
      )}
    </button>
  );
}
