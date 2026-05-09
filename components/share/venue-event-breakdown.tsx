"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import { CopyToClipboard } from "@/components/dashboard/events/copy-to-clipboard";
import { TicketTiersSection } from "@/components/dashboard/events/ticket-tiers-section";
import {
  aggregateAllocationByEvent,
  sortEventsGroupStageFirst,
} from "@/lib/db/client-dashboard-aggregations";
import {
  suggestedCommsPhrase,
  type CommsPhrase,
} from "@/lib/dashboard/comms-phrase";
import type {
  AdditionalSpendRow,
  DailyRollupRow,
  PortalEvent,
} from "@/lib/db/client-portal-server";
import { fmtDate } from "@/lib/dashboard/format";
import {
  recommendMarketingAction,
  type MarketingAction,
} from "@/lib/dashboard/marketing-actions";
import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import {
  suggestedPct,
  tierSaleStatus,
  type SuggestedPct,
} from "@/lib/dashboard/suggested-pct";
import { computePortalEventSpendRowMetrics } from "@/lib/dashboard/portal-event-spend-row";
import {
  eventTierSalesRollup,
  resolveDisplayTicketCount,
  resolveDisplayTicketRevenue,
  tierSalesRollup,
} from "@/lib/dashboard/tier-channel-rollups";
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
  additionalSpend?: AdditionalSpendRow[];
  channelEditApiBase?: string;
  canEditChannels?: boolean;
  /**
   * Internal `/clients/.../venues/...` report: tier-channel PATCH uses
   * `/api/events/[eventId]` per row; expanded spend grid matches share portal.
   */
  isInternalDashboard?: boolean;
  /** Pass through for `EventTicketingStatusBadge` on internal surfaces. */
  clientId?: string;
  onAfterChannelMutate?: () => void;
}

interface EventMetrics {
  tickets: number;
  capacity: number | null;
  soldPct: number | null;
  suggestedPct: SuggestedPct | null;
  commsPhrase: CommsPhrase;
  isSoldOut: boolean;
  ticketRevenue: number | null;
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
  additionalSpend = [],
  channelEditApiBase,
  canEditChannels = false,
  isInternalDashboard = false,
  clientId,
  onAfterChannelMutate,
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
    orderedEvents.map((event) => [
      event.id,
      computeEventMetrics(event, spend, additionalSpend),
    ]),
  );
  const venueMetrics = computeVenueMetrics([...metricsByEventId.values()]);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg tracking-wide text-foreground">
            Event Breakdown
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Per-event sales and spend using the same venue portal rollups as the
            dashboard event rows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-border bg-background px-2 py-1 text-muted-foreground">
            Suggested: <SuggestedValue value={venueMetrics.suggestedPct} />
          </span>
          <CommsChip phrase={venueMetrics.commsPhrase} />
        </div>
      </div>
      {showFloorNote ? (
        <p className="text-xs italic text-muted-foreground">
          All events early in sales window — Suggested figures show 60% floor
          until events pass 40% sold
        </p>
      ) : null}

      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[940px] border-collapse text-sm">
            <thead>
              <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
                <th className="px-3 py-2.5">Event</th>
                <th className="px-3 py-2.5">Last Updated</th>
                <th className="px-3 py-2.5 text-right">Tickets</th>
                <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
                <th className="px-3 py-2.5 text-right">% Sold</th>
                <th
                  className="hidden px-3 py-2.5 text-right sm:table-cell"
                  title="Marketing comms figure. Floor 60%, +20% padding through to 95% suggested at 75% actual, then linear to 99%. Sold-out events show SOLD OUT."
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    Suggested <Info className="h-3 w-3" />
                  </span>
                </th>
                <th className="px-3 py-2.5 text-right">Comms</th>
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
                    spend={spend}
                    onToggle={() => toggleEvent(event.id)}
                    channelEditApiBase={channelEditApiBase}
                    canEditChannels={canEditChannels}
                    isInternalDashboard={isInternalDashboard}
                    clientId={clientId}
                    onAfterChannelMutate={onAfterChannelMutate}
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
  spend,
  onToggle,
  channelEditApiBase,
  canEditChannels,
  isInternalDashboard = false,
  clientId,
  onAfterChannelMutate,
}: {
  event: PortalEvent;
  metrics: EventMetrics;
  expanded: boolean;
  spend: GroupSpend;
  onToggle: () => void;
  channelEditApiBase?: string;
  canEditChannels: boolean;
  isInternalDashboard?: boolean;
  clientId?: string;
  onAfterChannelMutate?: () => void;
}) {
  const tierChannelApiBase = isInternalDashboard
    ? `/api/events/${event.id}`
    : channelEditApiBase;
  const tierChannelsEditable = isInternalDashboard ? true : canEditChannels;
  const ticketingBadgeClientId = isInternalDashboard ? clientId : undefined;

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
          <EventTicketingStatusBadge
            event={event}
            clientId={ticketingBadgeClientId}
          />
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatNumber(metrics.tickets)}
          {" / "}
          {metrics.capacity == null ? "—" : formatNumber(metrics.capacity)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {metrics.ticketRevenue == null ? "—" : formatGBP(metrics.ticketRevenue)}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
          {formatPct(metrics.soldPct, 1)}
        </td>
        <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
          <SuggestedValue value={metrics.suggestedPct} />
        </td>
        <td className="px-3 py-2.5 text-right">
          <CommsChip phrase={metrics.commsPhrase} />
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
          <td colSpan={10} className="px-6 py-4">
            <div className="space-y-3">
              <VenueEventSpendDetailRow
                event={event}
                spend={spend}
                clientId={ticketingBadgeClientId}
              />
              <TicketTiersSection
                tiers={event.ticket_tiers}
                title={`${event.name} ticket tiers`}
                emptyMessage="Tier breakdown will appear after next sync."
                compact
                eventId={event.id}
                channelEditApiBase={tierChannelApiBase}
                canEditChannels={tierChannelsEditable}
                onAfterChannelMutate={onAfterChannelMutate}
              />
              <RecommendedActionPanel action={buildMarketingAction(event, metrics)} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Mirrors `EventRow` in `client-portal-venue-table.tsx` — read-only cells. */
function VenueEventSpendDetailRow({
  event,
  spend,
  clientId,
}: {
  event: PortalEvent;
  spend: GroupSpend;
  clientId?: string;
}) {
  const m = computePortalEventSpendRowMetrics(event, spend);
  const allocationRow =
    spend.kind === "allocated" ? spend.byEventId.get(event.id) ?? null : null;
  const adSpendTitle = allocationRow
    ? `Includes ${formatGBP(allocationRow.specific)} specific to this game + ${formatGBP(allocationRow.genericShare)} share of venue-generic spend${
        allocationRow.presale > 0
          ? ` + ${formatGBP(allocationRow.presale)} presale paid media`
          : ""
      }`
    : undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="bg-foreground text-left text-xs font-medium uppercase tracking-wide text-background">
            <th className="px-3 py-2.5">Event</th>
            <th className="px-3 py-2.5">Last updated</th>
            <th className="px-3 py-2.5 text-right">Pre-reg</th>
            <th className="px-3 py-2.5 text-right">Ad Spend</th>
            <th className="px-3 py-2.5 text-right">Total Spend</th>
            <th className="px-3 py-2.5 text-right">Tickets Sold</th>
            <th className="px-3 py-2.5 text-right">Tickets Prev</th>
            <th className="px-3 py-2.5 text-right">Tickets Change</th>
            <th className="px-3 py-2.5 text-right">CPT</th>
            <th className="px-3 py-2.5 text-right">CPT Prev</th>
            <th className="px-3 py-2.5 text-right">CPT Change</th>
            <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
            <th className="px-3 py-2.5 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-border bg-background hover:bg-muted/50">
            <td className="px-3 py-2.5 align-top">
              <span className="block font-medium text-foreground">{event.name}</span>
              {event.event_code ? (
                <span className="block text-[11px] text-muted-foreground">
                  {event.event_code}
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2.5 align-top">
              <EventTicketingStatusBadge event={event} clientId={clientId} />
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {formatGBP(m.prereg)}
            </td>
            <td
              className="px-3 py-2.5 text-right tabular-nums text-foreground"
              title={adSpendTitle}
            >
              {formatGBP(m.perEventAd)}
              {allocationRow ? (
                <span className="sr-only"> {adSpendTitle}</span>
              ) : null}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">
              {formatGBP(m.perEventTotal)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {formatNumber(m.tickets)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
              {event.tickets_sold_previous === null
                ? "—"
                : formatNumber(m.prevTickets)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {event.tickets_sold_previous === null ? "—" : formatChange(m.change)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {formatGBP(m.cpt, 2)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {formatGBP(m.cptPrevious, 2)}
            </td>
            <td
              className={`px-3 py-2.5 text-right tabular-nums ${cptChangeClass(m.cptChange)}`}
            >
              {formatCptChange(m.cptChange)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-foreground">
              {m.revenue == null ? "—" : formatGBP(m.revenue)}
            </td>
            <td className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}>
              {formatRoas(m.roas)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function formatChange(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}

function formatRoas(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n >= 3) return "text-emerald-600 font-semibold";
  if (n < 1) return "text-red-600 font-semibold";
  return "text-foreground";
}

function formatCptChange(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return GBP2.format(0);
  const abs = GBP2.format(Math.abs(n));
  return n > 0 ? `+${abs}` : `−${abs}`;
}

function cptChangeClass(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  if (n < 0) return "text-emerald-600 font-semibold";
  if (n > 0) return "text-amber-600 font-semibold";
  return "text-foreground";
}

function computeEventMetrics(
  event: PortalEvent,
  spend: GroupSpend,
  additionalSpend: AdditionalSpendRow[],
): EventMetrics {
  const prereg =
    spend.kind === "allocated" &&
    (spend.byEventId.get(event.id)?.daysCoveredPresale ?? 0) > 0
      ? 0
      : (event.prereg_spend ?? 0);

  const paidMedia = eventPaidMediaSpend(event, spend);
  const eventAdditionalSpend = additionalSpend
    .filter((row) => row.scope === "event" && row.event_id === event.id)
    .reduce((sum, row) => sum + row.amount, 0);
  const totalSpend =
    paidMedia == null ? null : prereg + paidMedia + eventAdditionalSpend;
  const tierTotals = tierAllocationTotals(event);
  const tickets = tierTotals.sold;
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

  const ticketRevenue =
    event.ticket_tiers.length > 0
      ? resolveDisplayTicketRevenue({
          ticket_tiers: event.ticket_tiers,
          latest_snapshot_revenue: event.latest_snapshot?.revenue ?? null,
          tier_channel_sales_revenue: event.tier_channel_sales_revenue ?? null,
        })
      : event.latest_snapshot?.revenue ?? null;

  return {
    tickets,
    capacity,
    soldPct,
    suggestedPct: suggested,
    commsPhrase: suggestedCommsPhrase(
      suggested,
      tierTotals.allTiersOnSaleSoon ? "on_sale_soon" : isSoldOut ? "sold_out" : "on_sale",
    ),
    isSoldOut,
    ticketRevenue,
    spend: totalSpend,
    cpt,
    pacingTicketsPerDay,
  };
}

function computeVenueMetrics(metrics: EventMetrics[]): {
  suggestedPct: SuggestedPct | null;
  commsPhrase: CommsPhrase;
} {
  let tickets = 0;
  let capacity = 0;
  let hasCapacity = false;
  let allSoldOut = metrics.length > 0;
  for (const metric of metrics) {
    tickets += metric.tickets;
    if (metric.capacity != null) {
      capacity += metric.capacity;
      hasCapacity = true;
      if (metric.tickets < metric.capacity) allSoldOut = false;
    } else {
      allSoldOut = false;
    }
  }
  const actualPct = hasCapacity && capacity > 0 ? (tickets / capacity) * 100 : null;
  const value =
    actualPct == null
      ? null
      : suggestedPct(Math.max(0, Math.min(100, actualPct)), { isSoldOut: allSoldOut });
  return {
    suggestedPct: value,
    commsPhrase: suggestedCommsPhrase(value, allSoldOut ? "sold_out" : "on_sale"),
  };
}

function buildMarketingAction(event: PortalEvent, metrics: EventMetrics): MarketingAction {
  return recommendMarketingAction({
    tickets_sold: metrics.tickets,
    capacity: metrics.capacity ?? 0,
    days_until_event: daysUntilEvent(event.event_date) ?? 0,
    pct_sold: metrics.soldPct ?? 0,
    tiers: event.ticket_tiers.map((tier) => ({
      tier_name: tier.tier_name,
      quantity_sold: tierSalesRollup(tier).sold,
      quantity_available: tierSalesRollup(tier).allocation ?? 0,
      price: Number.isFinite(Number(tier.price)) ? Number(tier.price) : 0,
    })),
  });
}

function CommsChip({ phrase }: { phrase: CommsPhrase }) {
  const display = phrase.primary === "SOLD OUT" ? "SOLD OUT" : phrase.short;
  return (
    <CopyToClipboard
      text={phrase.primary}
      title={`${phrase.primary} — click to copy`}
      className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted"
    >
      {display}
    </CopyToClipboard>
  );
}

function RecommendedActionPanel({ action }: { action: MarketingAction }) {
  return (
    <div className={`rounded-md border p-3 text-sm ${actionPanelClass(action.kind)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide">
            Recommended Action
          </p>
          <p className="mt-1 leading-snug">{action.reason}</p>
        </div>
        <CopyToClipboard
          text={action.reason}
          className="rounded border border-current/30 px-2 py-1 text-xs font-medium hover:bg-background/60"
        >
          Copy
        </CopyToClipboard>
      </div>
    </div>
  );
}

function actionPanelClass(kind: MarketingAction["kind"]): string {
  switch (kind) {
    case "sold_out_celebrate":
    case "scale_spend":
      return "border-emerald-200 bg-emerald-50 text-emerald-950";
    case "promote_next_tier":
    case "release_next_tier":
      return "border-blue-200 bg-blue-50 text-blue-950";
    case "premium_underperforming":
      return "border-amber-200 bg-amber-50 text-amber-950";
    case "reduce_spend":
      return "border-red-200 bg-red-50 text-red-950";
    case "pre_sale_hold":
    case "hold":
      return "border-border bg-background text-muted-foreground";
  }
}

function tierAllocationTotals(event: PortalEvent): {
  sold: number;
  allocation: number | null;
  allTiersOnSaleSoon: boolean;
} {
  if (event.ticket_tiers.length === 0) {
    return { sold: 0, allocation: null, allTiersOnSaleSoon: false };
  }
  let onSaleCount = 0;
  for (const tier of event.ticket_tiers) {
    const rollup = tierSalesRollup(tier);
    if (tierSaleStatus(rollup.sold, rollup.allocation) === "on_sale_soon") {
      continue;
    }
    onSaleCount += 1;
  }
  const rollup = eventTierSalesRollup(event.ticket_tiers);
  return {
    sold: resolveDisplayTicketCount({
      ticket_tiers: event.ticket_tiers,
      latest_snapshot_tickets: event.latest_snapshot?.tickets_sold ?? null,
      fallback_tickets: event.tickets_sold ?? null,
      tier_channel_sales_sum: event.tier_channel_sales_tickets ?? null,
    }),
    allocation: rollup.allocation,
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

function formatPct(n: number | null, dp: 0 | 1 = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return dp === 1 ? `${n.toFixed(1)}%` : `${Math.round(n)}%`;
}

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}
