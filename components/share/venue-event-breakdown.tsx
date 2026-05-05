"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import { TicketTiersSection } from "@/components/dashboard/events/ticket-tiers-section";
import {
  aggregateAllocationByEvent,
  sortEventsGroupStageFirst,
} from "@/lib/db/client-dashboard-aggregations";
import type {
  DailyRollupRow,
  PortalEvent,
} from "@/lib/db/client-portal-server";
import { fmtDate } from "@/lib/dashboard/format";
import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import {
  suggestedPct,
  tierSaleStatus,
  type SuggestedPct,
} from "@/lib/dashboard/suggested-pct";
import {
  venueSpend,
  type GroupSpend,
  type VenueSpendGroup,
} from "@/lib/dashboard/venue-spend-model";
import { EventTicketingStatusBadge } from "./last-updated-indicator";

interface Props {
  events: PortalEvent[];
  dailyRollups: DailyRollupRow[];
  londonOnsaleSpend: number | null;
}

interface EventMetrics {
  tickets: number;
  capacity: number | null;
  soldPct: number | null;
  suggestedPct: SuggestedPct | null;
  isSoldOut: boolean;
  spend: number | null;
  cpt: number | null;
  pacingTicketsPerDay: number | null;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");

export function VenueEventBreakdown({
  events,
  dailyRollups,
  londonOnsaleSpend,
}: Props) {
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(
    () => new Set(),
  );
  const orderedEvents = useMemo(() => sortEventsGroupStageFirst(events), [events]);
  const spend = useMemo(
    () =>
      venueSpend(
        buildVenueSpendGroup(orderedEvents),
        londonOnsaleSpend,
        aggregateAllocationByEvent(dailyRollups),
        paidSpendByEvent(dailyRollups),
      ),
    [dailyRollups, londonOnsaleSpend, orderedEvents],
  );

  if (orderedEvents.length === 0) return null;
  const metricsByEventId = new Map(
    orderedEvents.map((event) => [event.id, computeEventMetrics(event, spend)]),
  );
  const showFloorNote =
    orderedEvents.length > 0 &&
    orderedEvents.every((event) => {
      const metrics = metricsByEventId.get(event.id);
      return (
        metrics?.suggestedPct === 60 &&
        metrics.soldPct != null &&
        metrics.soldPct < 50
      );
    });

  const toggleEvent = (eventId: string) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg tracking-wide text-foreground">
          Event Breakdown
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Per-event sales and spend using the same venue portal rollups as the
          dashboard event rows.
        </p>
      </div>

      {showFloorNote ? (
        <p className="text-xs italic text-muted-foreground">
          All events early in sales window — Suggested figures show 60% floor
          until events pass 40% sold
        </p>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-sm">
            <thead>
              <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
                <th className="px-3 py-2.5">Event</th>
                <th className="px-3 py-2.5">Last Updated</th>
                <th className="px-3 py-2.5 text-right">Tickets</th>
                <th className="px-3 py-2.5 text-right">% Sold</th>
                <th
                  className="hidden px-3 py-2.5 text-right sm:table-cell"
                  title="Marketing comms figure. Floor 60%, +20% padding through to 95% suggested at 75% actual, then linear to 99%. Sold-out events show SOLD OUT."
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    Suggested <Info className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right">Spend</th>
                <th className="px-3 py-2.5 text-right">CPT</th>
                <th className="px-3 py-2.5 text-right">Pacing</th>
              </tr>
            </thead>
            <tbody>
              {orderedEvents.map((event) => {
                const metrics = metricsByEventId.get(event.id)!;
                const expanded = expandedEventIds.has(event.id);
                return (
                  <VenueEventBreakdownRows
                    key={event.id}
                    event={event}
                    metrics={metrics}
                    expanded={expanded}
                    onToggle={() => toggleEvent(event.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function VenueEventBreakdownRows({
  event,
  metrics,
  expanded,
  onToggle,
}: {
  event: PortalEvent;
  metrics: EventMetrics;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-border bg-card hover:bg-muted/50">
        <td className="px-3 py-2.5 align-top">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="flex min-w-0 items-start gap-2 text-left"
          >
            <span className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </span>
            <span>
              <span className="block font-medium text-foreground">
                {event.name}
              </span>
              {event.event_date ? (
                <span className="block text-[11px] text-muted-foreground">
                  {fmtDate(event.event_date)}
                </span>
              ) : null}
            </span>
          </button>
        </td>
        <td className="px-3 py-2.5 align-top">
          <EventTicketingStatusBadge event={event} />
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatNumber(metrics.tickets)}
          {" / "}
          {metrics.capacity == null ? "—" : formatNumber(metrics.capacity)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatPct(metrics.soldPct)}
        </td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
          <SuggestedValue value={metrics.suggestedPct} />
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatGBP(metrics.spend)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatGBP(metrics.cpt, 2)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {metrics.pacingTicketsPerDay == null
            ? "—"
            : `${formatNumber(metrics.pacingTicketsPerDay)}/day`}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-t border-border bg-muted/30">
          <td colSpan={8} className="px-6 py-4">
            <TicketTiersSection
              tiers={event.ticket_tiers}
              title={`${event.name} ticket tiers`}
              emptyMessage="Tier breakdown will appear after next sync."
              compact
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function computeEventMetrics(
  event: PortalEvent,
  spend: GroupSpend,
): EventMetrics {
  const prereg =
    spend.kind === "allocated" &&
    (spend.byEventId.get(event.id)?.daysCoveredPresale ?? 0) > 0
      ? 0
      : (event.prereg_spend ?? 0);

  const paidMedia = eventPaidMediaSpend(event, spend);
  const totalSpend = paidMedia == null ? null : prereg + paidMedia;
  const tickets = event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
  const tierTotals = tierAllocationTotals(event);
  const capacity = tierTotals.allocation ?? event.capacity;
  const soldPct =
    capacity != null && capacity > 0 ? (tickets / capacity) * 100 : null;
  const isSoldOut =
    tierTotals.allocation != null
      ? tierTotals.sold >= tierTotals.allocation
      : capacity != null && capacity > 0 && tickets >= capacity;
  const suggested =
    tierTotals.allTiersOnSaleSoon
      ? "ON SALE SOON"
      : soldPct == null
      ? null
      : suggestedPct(Math.max(0, Math.min(100, soldPct)), { isSoldOut });
  const cpt =
    totalSpend != null && totalSpend > 0 && tickets > 0
      ? totalSpend / tickets
      : null;
  const daysUntil = daysUntilEvent(event.event_date);
  const remaining =
    capacity != null ? Math.max(0, capacity - tickets) : null;
  const pacingTicketsPerDay =
    remaining != null && remaining > 0 && daysUntil != null
      ? Math.round(remaining / Math.max(1, daysUntil))
      : null;

  return {
    tickets,
    capacity,
    soldPct,
    suggestedPct: suggested,
    isSoldOut,
    spend: totalSpend,
    cpt,
    pacingTicketsPerDay,
  };
}

function tierAllocationTotals(event: PortalEvent): {
  sold: number;
  allocation: number | null;
  allTiersOnSaleSoon: boolean;
} {
  if (event.ticket_tiers.length === 0) {
    return { sold: 0, allocation: null, allTiersOnSaleSoon: false };
  }
  let sold = 0;
  let allocation = 0;
  let hasAllocation = false;
  let onSaleCount = 0;
  for (const tier of event.ticket_tiers) {
    if (tierSaleStatus(tier.quantity_sold, tier.quantity_available) === "on_sale_soon") {
      continue;
    }
    onSaleCount += 1;
    sold += tier.quantity_sold;
    if (tier.quantity_available != null && tier.quantity_available > 0) {
      allocation += tier.quantity_available;
      hasAllocation = true;
    }
  }
  return {
    sold,
    allocation: hasAllocation ? allocation : null,
    allTiersOnSaleSoon: onSaleCount === 0,
  };
}

function SuggestedValue({ value }: { value: SuggestedPct | null }) {
  if (value == null) return <>—</>;
  if (value === "SOLD OUT") {
    return (
      <span className="font-semibold uppercase tracking-wide text-destructive">
        SOLD OUT
      </span>
    );
  }
  if (value === "ON SALE SOON") {
    return <span className="italic text-muted-foreground">On Sale Soon</span>;
  }
  return <>{Math.round(value)}%</>;
}

function eventPaidMediaSpend(
  event: PortalEvent,
  spend: GroupSpend,
): number | null {
  if (spend.kind === "allocated") {
    return spend.byEventId.get(event.id)?.paidMedia ?? null;
  }
  if (spend.kind === "split") {
    return spend.perEventTotal == null
      ? null
      : spend.perEventTotal - (event.prereg_spend ?? 0);
  }
  if (spend.kind === "add") return spend.perEventAd;
  return spend.byEventId.get(event.id) ?? null;
}

function buildVenueSpendGroup(
  events: PortalEvent[],
): VenueSpendGroup<PortalEvent> {
  return {
    city: events[0]?.venue_city ?? null,
    campaignSpend: firstNumber(events.map((event) => event.meta_spend_cached)),
    eventCount: events.length,
    events,
  };
}

function paidSpendByEvent(rows: DailyRollupRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const hasSpend = row.ad_spend != null || row.tiktok_spend != null;
    if (!hasSpend) continue;
    out.set(row.event_id, (out.get(row.event_id) ?? 0) + paidSpendOf(row));
  }
  return out;
}

function firstNumber(values: Array<number | null>): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

function daysUntilEvent(eventDate: string | null): number | null {
  if (!eventDate) return null;
  const today = new Date();
  const start = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const target = new Date(`${eventDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(target)) return null;
  const diff = Math.ceil((target - start) / 86_400_000);
  return diff > 0 ? diff : null;
}

function formatNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}
