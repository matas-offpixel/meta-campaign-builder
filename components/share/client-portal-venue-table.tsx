"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import type { PortalEvent } from "@/lib/db/client-portal-server";

interface SavedSnapshot {
  tickets_sold: number;
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

interface Props {
  token: string;
  events: PortalEvent[];
  onSnapshotSaved: (eventId: string, snapshot: SavedSnapshot) => void;
}

/**
 * Venue-grouped reporting table that replaces the old per-event card list
 * on /share/client/[token]. The shape mirrors the Google Sheets doc the
 * client used to maintain by hand: one section per venue, one data row per
 * event, plus a "Total" row that re-derives CPT / ROAS from the
 * venue-level sums.
 *
 * Spend model (matches migration 023):
 *   - meta_spend_cached lives on every event sharing the same meta_campaign_id
 *     and represents the *campaign-level* lifetime Meta spend.
 *   - For each venue we take the first non-null meta_spend_cached as the
 *     campaign total, then divide by the number of events in the group to
 *     get the per-event total spend.
 *   - prereg_spend stays on the event row (manual, frozen after presale).
 *   - per-event ad_spend is computed at render = perEventTotal − prereg.
 *
 * Revenue is no longer derived from a stored ticket_price — the client
 * types it in directly through the snapshot row.
 *
 * Edit mode: a single "Edit" button at the top of each venue section
 * flips every Tickets Sold + Revenue cell to inline inputs. Cells save
 * on blur (no per-row Save button). "Done" exits edit mode.
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

interface VenueGroup {
  key: string;
  displayName: string;
  city: string | null;
  budget: number | null;
  /** First non-null meta_spend_cached across the group's events. */
  campaignSpend: number | null;
  /** Number of events in the group — divisor for per-event total. */
  eventCount: number;
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
      existing.eventCount += 1;
      if (existing.budget === null && ev.budget_marketing !== null) {
        existing.budget = ev.budget_marketing;
      }
      if (existing.campaignSpend === null && ev.meta_spend_cached !== null) {
        existing.campaignSpend = ev.meta_spend_cached;
      }
    } else {
      map.set(key, {
        key,
        displayName: name,
        city: ev.venue_city,
        budget: ev.budget_marketing,
        campaignSpend: ev.meta_spend_cached,
        eventCount: 1,
        events: [ev],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

interface EventMetrics {
  prereg: number | null;
  perEventTotal: number | null;
  perEventAd: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  revenue: number | null;
  roas: number | null;
}

function computeEventMetrics(
  ev: PortalEvent,
  perEventTotal: number | null,
): EventMetrics {
  const prereg = ev.prereg_spend;
  const perEventAd =
    perEventTotal !== null ? perEventTotal - (prereg ?? 0) : null;
  const tickets = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
  const prev = ev.tickets_sold_previous ?? 0;
  const cpt =
    perEventTotal !== null && perEventTotal > 0 && tickets > 0
      ? perEventTotal / tickets
      : null;
  const revenue = ev.latest_snapshot?.revenue ?? null;
  const roas =
    revenue !== null && perEventTotal !== null && perEventTotal > 0
      ? revenue / perEventTotal
      : null;
  return {
    prereg,
    perEventTotal,
    perEventAd,
    tickets,
    prevTickets: prev,
    change: tickets - prev,
    cpt,
    revenue,
    roas,
  };
}

interface VenueTotals {
  prereg: number;
  ad: number | null;
  total: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  revenue: number | null;
  roas: number | null;
}

function sumVenue(group: VenueGroup): VenueTotals {
  let prereg = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasRevenue = false;
  for (const ev of group.events) {
    prereg += ev.prereg_spend ?? 0;
    const sold = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    tickets += sold;
    prevTickets += ev.tickets_sold_previous ?? 0;
    const r = ev.latest_snapshot?.revenue;
    if (r !== null && r !== undefined) {
      hasRevenue = true;
      revenue += r;
    }
  }
  // Venue total spend = the campaign's lifetime spend, NOT the sum of
  // per-event splits (they're identical by construction, but reading
  // the campaign value directly avoids floating-point drift on the
  // division round-trip).
  const total = group.campaignSpend;
  const ad = total !== null ? total - prereg : null;
  const cpt = total !== null && total > 0 && tickets > 0 ? total / tickets : null;
  const finalRevenue = hasRevenue ? revenue : null;
  const roas =
    finalRevenue !== null && total !== null && total > 0
      ? finalRevenue / total
      : null;
  return {
    prereg,
    ad,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    revenue: finalRevenue,
    roas,
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

const COL_COUNT = 10;

function VenueSection({ token, group, onSnapshotSaved }: VenueSectionProps) {
  const [editMode, setEditMode] = useState(false);
  const totals = useMemo(() => sumVenue(group), [group]);
  const headerLabel = group.city
    ? `${group.displayName}, ${group.city}`
    : group.displayName;

  // Per-event total spend = campaign spend / event count. Computed once
  // here so every row in the venue uses the same divisor.
  const perEventTotal =
    group.campaignSpend !== null && group.eventCount > 0
      ? group.campaignSpend / group.eventCount
      : null;

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
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
        </div>
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            editMode
              ? "bg-zinc-900 text-white hover:bg-zinc-800"
              : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          }`}
          aria-pressed={editMode}
        >
          {editMode ? (
            "Done"
          ) : (
            <>
              <Pencil className="h-3 w-3" />
              Edit
            </>
          )}
        </button>
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
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">Prev</th>
              <th className="px-3 py-2.5 text-right">Change</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
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
                editMode={editMode}
                perEventTotal={perEventTotal}
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
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
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
  editMode: boolean;
  perEventTotal: number | null;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

function EventRow({
  token,
  event,
  striped,
  editMode,
  perEventTotal,
  onSnapshotSaved,
}: EventRowProps) {
  const m = computeEventMetrics(event, perEventTotal);
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
        {formatGBP(m.perEventAd)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-zinc-900">
        {formatGBP(m.perEventTotal)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          // Remount when the saved value changes (snapshot upserts) so
          // the uncontrolled input picks up the new defaultValue.
          key={`tickets:${m.tickets}`}
          token={token}
          event={event}
          field="tickets_sold"
          editMode={editMode}
          currentValue={m.tickets}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          key={`revenue:${m.revenue ?? "null"}`}
          token={token}
          event={event}
          field="revenue"
          editMode={editMode}
          currentValue={m.revenue}
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
      <td className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}>
        {formatRoas(m.roas)}
      </td>
    </tr>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

interface NumericCellProps {
  token: string;
  event: PortalEvent;
  field: "tickets_sold" | "revenue";
  editMode: boolean;
  /** Current rendered value — null means "not set yet" (display "—"). */
  currentValue: number | null;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

/**
 * Editable numeric cell shared between Tickets Sold and Revenue.
 *
 * In view mode: renders the formatted value (or "—" when null) and a
 * subtle ✓ badge after a successful save.
 * In edit mode: renders an inline number input that persists on blur
 * (or Enter). Esc cancels and reverts to the last saved value.
 *
 * Both fields hit the same /api/share/client/[token]/tickets endpoint —
 * the API persists tickets_sold + revenue in one snapshot row, so we
 * always send the *other* field's current value through unchanged to
 * avoid accidentally clobbering it back to null.
 */
function NumericCell({
  token,
  event,
  field,
  editMode,
  currentValue,
  onSnapshotSaved,
}: NumericCellProps) {
  // The input is uncontrolled — `defaultValue` reflects the prop and the
  // ref reads the current text on blur. This sidesteps the "stale draft
  // after a sibling save" trap controlled inputs hit, and the
  // `key={currentValue}` on the parent <td> remounts the input when the
  // server-side value changes via a different field's save.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const isCurrency = field === "revenue";

  const submit = async () => {
    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim();
    // Empty input on a never-set value is a no-op; clearing a previously
    // saved value writes through as null (only relevant for revenue —
    // tickets_sold goes through the integer guard below).
    if (trimmed === "") {
      if (currentValue === null) return;
      // Tickets are required by the API; refuse to clear.
      if (field === "tickets_sold") {
        setSave({ kind: "error", message: "Required" });
        return;
      }
    }

    let parsedTickets: number;
    let parsedRevenue: number | null;

    if (field === "tickets_sold") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        setSave({ kind: "error", message: "Whole numbers only" });
        return;
      }
      parsedTickets = n;
      parsedRevenue = event.latest_snapshot?.revenue ?? null;
    } else {
      // Revenue may have been left blank to clear; otherwise validate.
      if (trimmed === "") {
        parsedRevenue = null;
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) {
          setSave({ kind: "error", message: "Numbers ≥ 0 only" });
          return;
        }
        parsedRevenue = n;
      }
      parsedTickets =
        event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
    }

    // No-op if nothing actually changed — avoids hammering the API
    // every time a user tabs through the table.
    const ticketsUnchanged =
      field === "tickets_sold" &&
      parsedTickets ===
        (event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0);
    const revenueUnchanged =
      field === "revenue" &&
      parsedRevenue === (event.latest_snapshot?.revenue ?? null);
    if (ticketsUnchanged || revenueUnchanged) {
      return;
    }

    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tickets_sold: parsedTickets,
          revenue: parsedRevenue,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          revenue: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved(event.id, {
        tickets_sold: parsedTickets,
        revenue: parsedRevenue,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSave({ kind: "error", message });
    }
  };

  if (editMode) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        {isCurrency && (
          <span className="text-xs text-zinc-500" aria-hidden="true">
            £
          </span>
        )}
        <input
          ref={inputRef}
          type="number"
          inputMode={isCurrency ? "decimal" : "numeric"}
          min={0}
          step={isCurrency ? "0.01" : 1}
          defaultValue={currentValue === null ? "" : String(currentValue)}
          onBlur={() => {
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              if (inputRef.current) {
                inputRef.current.value =
                  currentValue === null ? "" : String(currentValue);
              }
              setSave({ kind: "idle" });
              e.currentTarget.blur();
            }
          }}
          disabled={save.kind === "saving"}
          aria-label={
            field === "tickets_sold"
              ? `Tickets sold for ${event.name}`
              : `Revenue for ${event.name}`
          }
          className={`h-7 ${isCurrency ? "w-24" : "w-20"} rounded border border-zinc-300 bg-white px-2 text-right text-sm tabular-nums text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:bg-zinc-50`}
        />
        {save.kind === "saving" && (
          <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
        )}
        {save.kind === "saved" && (
          <span className="text-[11px] font-medium text-emerald-600">✓</span>
        )}
        {save.kind === "error" && (
          <span className="ml-1 text-[11px] text-red-600">{save.message}</span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center justify-end gap-1.5 tabular-nums text-zinc-900">
      <span className="font-medium">
        {currentValue === null
          ? "—"
          : isCurrency
            ? formatGBP(currentValue, 2)
            : formatNumber(currentValue)}
      </span>
      {save.kind === "saved" && (
        <span className="text-[11px] font-medium text-emerald-600">✓</span>
      )}
    </div>
  );
}
