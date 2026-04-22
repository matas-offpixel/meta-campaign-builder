/**
 * lib/ticketing/eventbrite/orders.ts
 *
 * Daily aggregation of Eventbrite orders for the daily-tracker table.
 *
 * Eventbrite's `/events/{event_id}/orders/` endpoint returns one row
 * per buyer order with a `created` timestamp and a `costs` object.
 * We page through the full list (up to a hard cap), filter by status
 * (paid orders only — `placed` / `complete`), and roll up to one row
 * per `(event_id, date)` keyed by the order date in the event's
 * timezone.
 *
 * Tickets-per-day:
 *   Each order has one or more attendees. We request `?expand=attendees`
 *   so the count comes back inline. When the expand is unavailable
 *   (rare API edge cases) we fall back to 1 attendee per order, which
 *   is the modal case for direct-to-fan ticketing.
 *
 * Revenue-per-day:
 *   Eventbrite reports `costs.gross.value` in MINOR units (pence /
 *   cents), with `costs.gross.currency` carrying the ISO code. The
 *   tracker UI deals in major units; we divide by 100 here so the
 *   stored value matches the rest of the app's currency contract
 *   (numeric(12,2) → pounds, not pence).
 *
 * Why date in the event timezone, not UTC:
 *   A 23:30 BST sale at a Leeds event should show up under that
 *   evening's row, not the next day's. We use the event's
 *   `event_timezone` when present and fall back to "Europe/London".
 */

import {
  EventbriteApiError,
  eventbriteGet,
} from "@/lib/ticketing/eventbrite/client";
import type { TicketingConnection } from "@/lib/ticketing/types";

const PAGE_LIMIT = 20; // 20 × 50 = 1000 orders per sync run
const PAID_STATUSES = new Set(["placed", "complete", "completed"]);

export interface EventbriteDailyOrderRow {
  /** YYYY-MM-DD in the event's timezone. */
  date: string;
  ticketsSold: number;
  /** Major units (pounds), not minor units (pence). */
  revenue: number;
}

interface EventbriteOrdersListResponse {
  pagination?: {
    page_number?: number;
    page_count?: number;
    has_more_items?: boolean;
    continuation?: string;
  };
  orders?: Array<{
    id: string;
    status?: string | null;
    created?: string | null;
    costs?: {
      gross?: { value?: number | null; currency?: string | null } | null;
    } | null;
    attendees?: Array<{ id: string; status?: string | null }> | null;
  }>;
}

export interface FetchDailyOrdersResult {
  rows: EventbriteDailyOrderRow[];
  /** ISO currency code from the first order seen, or null if no orders. */
  currency: string | null;
}

function readPersonalToken(connection: TicketingConnection): string {
  const raw = connection.credentials?.["personal_token"];
  if (typeof raw !== "string" || !raw) {
    throw new Error(
      "Eventbrite connection is missing personal_token. Re-save the connection in client settings.",
    );
  }
  return raw;
}

/**
 * Convert a UTC ISO timestamp to a `YYYY-MM-DD` date in the supplied
 * IANA timezone. We use `Intl.DateTimeFormat` rather than rolling our
 * own offset math so DST transitions and historical zone data are
 * handled by the platform.
 */
function isoToZonedDate(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  try {
    // en-CA gives YYYY-MM-DD natively (sv-SE works too).
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(d);
  } catch {
    // Bad timezone string — fall back to UTC slice.
    return iso.slice(0, 10);
  }
}

export async function fetchDailyOrdersForEvent(args: {
  connection: TicketingConnection;
  externalEventId: string;
  /** IANA timezone, e.g. "Europe/London". Defaults to Europe/London. */
  eventTimezone: string | null;
}): Promise<FetchDailyOrdersResult> {
  const token = readPersonalToken(args.connection);
  const tz = args.eventTimezone ?? "Europe/London";

  const totalsTickets = new Map<string, number>();
  const totalsRevenue = new Map<string, number>();
  let currency: string | null = null;

  let continuation: string | undefined;
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    let res: EventbriteOrdersListResponse;
    try {
      res = await eventbriteGet<EventbriteOrdersListResponse>(
        token,
        `/events/${encodeURIComponent(args.externalEventId)}/orders/`,
        {
          query: {
            // expand=attendees lets us count tickets per order without
            // a second per-order request. Eventbrite charges no extra
            // API budget for the expand.
            expand: "attendees",
            // Continuation tokens are Eventbrite's preferred pagination
            // for large lists; page numbers also work but the API hints
            // continuation as the long-lived contract.
            ...(continuation ? { continuation } : {}),
          },
        },
      );
    } catch (err) {
      // 404 means the event doesn't exist on Eventbrite (anymore /
      // wrong id). Surface as zero-orders rather than failing the
      // whole sync, so the Meta side still lands and the UI can show
      // a useful "0 tickets" instead of a hard error.
      if (err instanceof EventbriteApiError && err.status === 404) {
        return { rows: [], currency: null };
      }
      throw err;
    }

    for (const order of res.orders ?? []) {
      if (!order.created) continue;
      if (!PAID_STATUSES.has((order.status ?? "").toLowerCase())) continue;
      const date = isoToZonedDate(order.created, tz);
      if (!date) continue;

      // Count attendees (= tickets) on this order. Free events still
      // have attendee rows. When expand drops off mid-payload, fall
      // back to 1 ticket per order.
      const attendees = (order.attendees ?? []).filter(
        (a) => (a.status ?? "").toLowerCase() !== "deleted",
      );
      const ticketCount = attendees.length > 0 ? attendees.length : 1;
      totalsTickets.set(
        date,
        (totalsTickets.get(date) ?? 0) + ticketCount,
      );

      const grossMinor = order.costs?.gross?.value ?? 0;
      totalsRevenue.set(
        date,
        (totalsRevenue.get(date) ?? 0) + grossMinor / 100,
      );

      if (!currency && order.costs?.gross?.currency) {
        currency = order.costs.gross.currency;
      }
    }

    continuation = res.pagination?.continuation;
    if (!res.pagination?.has_more_items) break;
    if (!continuation) break;
  }

  const rows: EventbriteDailyOrderRow[] = [...totalsTickets.keys()]
    .sort()
    .map((date) => ({
      date,
      ticketsSold: totalsTickets.get(date) ?? 0,
      revenue: Number((totalsRevenue.get(date) ?? 0).toFixed(2)),
    }));

  return { rows, currency };
}
