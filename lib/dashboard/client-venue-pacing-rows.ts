/**
 * lib/dashboard/client-venue-pacing-rows.ts
 *
 * Pure assembler that turns a client's already-loaded portal payload
 * (events + daily rollups + lifetime Meta cache) into per-venue
 * `VenuePacingRow`s. Shared by Workstream B (Today client alerts) and
 * Workstream C (client dashboard Pacing / Performance-vs-Allocation
 * views) so both derive identical venue statuses.
 *
 * NO data access — the caller passes the portal payload (loaded once via
 * the existing `loadClientPortalByClientId`). Grouping by `event_code`
 * mirrors the venue page exactly (SUM capacity / tickets_sold,
 * `aggregateSharedVenueBudget`, earliest-upcoming event date), then runs
 * the canonical `buildVenueCanonicalFunnel` per venue.
 */

import {
  aggregateSharedVenueBudget,
  aggregateSharedVenueCapacity,
} from "../db/client-dashboard-aggregations.ts";
import type {
  DailyRollupRow,
  PortalEvent,
} from "../db/client-portal-server.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../db/event-code-lifetime-meta-cache.ts";
import {
  isCancelledVenueGroup,
  isPastVenueGroup,
} from "./event-recency.ts";
import { getSeriesDisplayLabel } from "./series-display-labels.ts";
import { buildVenueCanonicalFunnel } from "./venue-canonical-funnel.ts";
import {
  buildVenuePacingRow,
  type VenuePacingRow,
} from "./venue-pacing-summary.ts";

/** Earliest upcoming event date in a venue group, else latest past. */
function venueEventDate(events: PortalEvent[], now: Date): string | null {
  const today = now.toISOString().slice(0, 10);
  const upcoming = events
    .map((e) => e.event_date)
    .filter((d): d is string => !!d && d >= today)
    .sort();
  if (upcoming.length > 0) return upcoming[0]!;
  return (
    events
      .map((e) => e.event_date)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null
  );
}

export interface BuildClientVenuePacingRowsInput {
  events: PortalEvent[];
  dailyRollups: DailyRollupRow[];
  lifetimeMetaByEventCode: EventCodeLifetimeMetaCacheRow[];
  /** Build the Funnel-Pacing deep link for a venue. */
  hrefForVenue: (eventCode: string) => string;
  /** Only include venues whose group is neither past nor cancelled. */
  activeOnly?: boolean;
  /** Override "today" for deterministic tests. */
  now?: Date;
}

export function buildClientVenuePacingRows(
  input: BuildClientVenuePacingRowsInput,
): VenuePacingRow[] {
  const now = input.now ?? new Date();

  // Group events by event_code (the venue scope the canonical funnel uses).
  const byCode = new Map<string, PortalEvent[]>();
  for (const ev of input.events) {
    if (!ev.event_code) continue;
    const arr = byCode.get(ev.event_code);
    if (arr) arr.push(ev);
    else byCode.set(ev.event_code, [ev]);
  }

  // Map event_id → event_code so rollups can be partitioned per venue.
  const codeByEventId = new Map<string, string>();
  for (const ev of input.events) {
    if (ev.event_code) codeByEventId.set(ev.id, ev.event_code);
  }
  const rollupsByCode = new Map<string, DailyRollupRow[]>();
  for (const row of input.dailyRollups) {
    const code = codeByEventId.get(row.event_id);
    if (!code) continue;
    const arr = rollupsByCode.get(code);
    if (arr) arr.push(row);
    else rollupsByCode.set(code, [row]);
  }

  const rows: VenuePacingRow[] = [];
  for (const [eventCode, venueEvents] of byCode) {
    if (input.activeOnly) {
      if (
        isCancelledVenueGroup(venueEvents) ||
        isPastVenueGroup(venueEvents, now)
      ) {
        continue;
      }
    }

    const capacity = aggregateSharedVenueCapacity(venueEvents) ?? 0;
    const ticketsSold = venueEvents.reduce(
      (s, e) => s + (e.tickets_sold ?? 0),
      0,
    );
    const allocatedBudget = aggregateSharedVenueBudget(venueEvents);
    const lifetimeCacheRow =
      input.lifetimeMetaByEventCode.find(
        (r) => r.event_code === eventCode,
      ) ?? null;
    const eventDate = venueEventDate(venueEvents, now);

    const funnel = buildVenueCanonicalFunnel({
      capacity,
      ticketsSold,
      lifetimeCacheRow,
      dailyRollups: rollupsByCode.get(eventCode) ?? [],
      eventDate,
      allocatedBudget,
      today: now,
    });

    const label =
      getSeriesDisplayLabel(eventCode) ??
      venueEvents[0]?.venue_name ??
      eventCode;

    rows.push(
      buildVenuePacingRow({
        funnel,
        eventCode,
        label,
        href: input.hrefForVenue(eventCode),
      }),
    );
  }

  return rows;
}
