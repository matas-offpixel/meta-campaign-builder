"use client";

import { useState } from "react";

import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalClient,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import { ClientPortalVenueTable } from "./client-portal-venue-table";

/**
 * Shape the portal table hands back on a successful ticket save.
 * Mirrors the internal `SavedSnapshot` interface inside
 * `ClientPortalVenueTable` — duplicated here because that type is
 * file-local there and re-exporting it would widen the public
 * surface more than we need.
 */
interface SavedSnapshot {
  tickets_sold: number;
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

/**
 * components/share/venue-full-report.tsx
 *
 * Wrapper around `ClientPortalVenueTable` that renders ONE venue
 * group full-width — the dedicated surface used by both the
 * internal `/clients/[id]/venues/[event_code]` page and the
 * external `/share/venue/[token]` page.
 *
 * Why a wrapper instead of calling `ClientPortalVenueTable` directly:
 *
 *   - The portal table's default behaviour is to render collapsed
 *     venue headers; here the venue IS the page, so we flip
 *     `forceExpandAll` on so the operator lands on fully-populated
 *     content.
 *   - The portal table owns the tickets-update plumbing through
 *     its `onSnapshotSaved` callback. On this surface the parent
 *     page doesn't need to re-render (there's no sibling card to
 *     refresh), so the wrapper holds a small optimistic snapshot
 *     state and feeds it back into the table via an `events`
 *     rebuild — mirroring the pattern the client portal uses.
 *
 * Single-responsibility: this file does NO data fetching; the
 * parent page pre-filters the portal payload down to the venue
 * scope before passing it in.
 */

interface Props {
  /**
   * Token forwarded to `ClientPortalVenueTable` for the per-row
   * tickets/additional-spend endpoints. External usage passes a
   * venue-scope share token; internal usage passes empty string —
   * the table falls back to event-detail navigation for editing
   * (see `VenueTicketsClickEdit`).
   */
  token?: string;
  clientId: string;
  client: PortalClient;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  isInternal?: boolean;
}

export function VenueFullReport({
  token = "",
  clientId,
  client: _client,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend: _additionalSpend,
  weeklyTicketSnapshots,
  londonOnsaleSpend,
  londonPresaleSpend,
  isInternal = false,
}: Props) {
  // Optimistic snapshot state — a save on any row inside the
  // expanded venue card calls `onSnapshotSaved` with the new
  // cumulative, and we update the in-memory events list so the
  // header number + WoW delta re-render without a full page reload.
  const [events, setEvents] = useState<PortalEvent[]>(initialEvents);

  const handleSnapshotSaved = (
    eventId: string,
    snapshot: SavedSnapshot,
  ) => {
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              latest_snapshot: {
                tickets_sold: snapshot.tickets_sold,
                revenue: snapshot.revenue,
                captured_at: snapshot.captured_at,
                week_start: snapshot.week_start,
              },
              tickets_sold: snapshot.tickets_sold,
            }
          : e,
      ),
    );
  };

  return (
    <ClientPortalVenueTable
      token={token}
      clientId={clientId}
      events={events}
      londonOnsaleSpend={londonOnsaleSpend}
      londonPresaleSpend={londonPresaleSpend}
      dailyEntries={dailyEntries}
      dailyRollups={dailyRollups}
      weeklyTicketSnapshots={weeklyTicketSnapshots}
      isInternal={isInternal}
      onSnapshotSaved={handleSnapshotSaved}
      forceExpandAll
    />
  );
}
