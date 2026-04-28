"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalClient,
  PortalEvent,
  VenueDailyBudgetRow,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import { AdditionalSpendCard } from "@/components/dashboard/events/additional-spend-card";
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
  /** The venue's `event_code` — the pivot key for venue-scope writes. */
  eventCode: string;
  client: PortalClient;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  venueDailyBudgets: VenueDailyBudgetRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  isInternal?: boolean;
  /**
   * Controls whether the venue additional-spend card renders in
   * read-only mode on the share surface. Defaults to read-only for
   * external shares that weren't explicitly flagged editable — matches
   * the per-event share card's contract.
   */
  canEdit?: boolean;
}

export function VenueFullReport({
  token = "",
  clientId,
  eventCode,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  venueDailyBudgets,
  weeklyTicketSnapshots,
  londonOnsaleSpend,
  londonPresaleSpend,
  isInternal = false,
  canEdit = false,
}: Props) {
  const router = useRouter();
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

  // Venue-scope additional spend. Internal surface: cookie auth,
  // always editable. Share surface: token auth, editable iff the
  // share row was minted with `can_edit=true`.
  const mode: "dashboard" | "share" = isInternal ? "dashboard" : "share";
  const readOnly = !isInternal && !canEdit;

  return (
    <div className="space-y-6">
      <ClientPortalVenueTable
        token={token}
        clientId={clientId}
        events={events}
        londonOnsaleSpend={londonOnsaleSpend}
        londonPresaleSpend={londonPresaleSpend}
        dailyEntries={dailyEntries}
        dailyRollups={dailyRollups}
        additionalSpend={additionalSpend}
        venueDailyBudgets={venueDailyBudgets}
        weeklyTicketSnapshots={weeklyTicketSnapshots}
        isInternal={isInternal}
        onSnapshotSaved={handleSnapshotSaved}
        forceExpandAll
      />
      {/* Venue-level additional spend (PR 4). Sits *after* the
          venue table rather than inline so the per-event table
          markup stays untouched; the card aggregates scope='venue'
          rows across every match under this event_code. */}
      <div className="rounded-md border border-border bg-background p-4">
        <AdditionalSpendCard
          scope={{ kind: "venue", clientId, venueEventCode: eventCode }}
          mode={mode}
          shareToken={mode === "share" ? token : undefined}
          readOnly={readOnly}
          onAfterMutate={() => router.refresh()}
        />
      </div>
    </div>
  );
}
