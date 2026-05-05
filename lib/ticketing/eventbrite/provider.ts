/**
 * lib/ticketing/eventbrite/provider.ts
 *
 * Eventbrite implementation of the `TicketingProvider` interface.
 *
 * Auth model (v1): a personal OAuth token pasted into client settings.
 * The token is validated against `/users/me/` on save — a non-2xx response
 * means we never persist the connection row, so a bad token can't poison
 * subsequent syncs.
 *
 * Pagination: Eventbrite returns 50 items per page by default. We cap
 * `listEvents` at 5 pages (250 events) — enough for any single org's
 * upcoming run and bounded so a misbehaving org can't blow the request
 * budget. Pagination happens here, not at the call site, so callers see
 * a flat list.
 */

import {
  EventbriteApiError,
  eventbriteGet,
} from "@/lib/ticketing/eventbrite/client";
import type {
  ExternalEventSummary,
  FetchedTicketSales,
  TicketingConnection,
  TicketingProvider,
  ValidateCredentialsResult,
} from "@/lib/ticketing/types";

interface EventbriteUserMeResponse {
  id: string;
  name?: string | null;
  emails?: Array<{ email: string; primary?: boolean }> | null;
}

interface EventbriteOrganizationsResponse {
  organizations?: Array<{
    id: string;
    name?: string | null;
  }> | null;
}

interface EventbriteEventListResponse {
  pagination?: {
    page_number?: number;
    page_count?: number;
    has_more_items?: boolean;
  };
  events?: Array<{
    id: string;
    name?: { text?: string | null } | null;
    url?: string | null;
    start?: { utc?: string | null } | null;
    status?: string | null;
    venue?: {
      name?: string | null;
      address?: {
        city?: string | null;
        localized_address_display?: string | null;
      } | null;
    } | null;
    capacity?: number | null;
  }>;
}

interface EventbriteTicketClass {
  id: string;
  name?: string | null;
  cost?: { value?: number; currency?: string } | null;
  quantity_total?: number | null;
  quantity_sold?: number | null;
}

interface EventbriteEventDetailResponse {
  id: string;
  capacity?: number | null;
  ticket_classes?: EventbriteTicketClass[];
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

async function fetchPrimaryOrganizationId(
  token: string,
): Promise<string | null> {
  // Eventbrite users may belong to multiple orgs. We grab the first one
  // and persist it as `external_account_id`. Multi-org clients can edit
  // the connection later to switch.
  try {
    const res = await eventbriteGet<EventbriteOrganizationsResponse>(
      token,
      "/users/me/organizations/",
    );
    const first = res.organizations?.[0];
    return first?.id ?? null;
  } catch {
    return null;
  }
}

export class EventbriteProvider implements TicketingProvider {
  readonly name = "eventbrite" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateCredentialsResult> {
    const token = credentials["personal_token"];
    if (typeof token !== "string" || !token.trim()) {
      return {
        ok: false,
        error: "Paste your Eventbrite personal OAuth token to continue.",
      };
    }
    try {
      const me = await eventbriteGet<EventbriteUserMeResponse>(
        token,
        "/users/me/",
      );
      if (!me?.id) {
        return {
          ok: false,
          error: "Eventbrite returned an empty user profile. Re-issue the token and try again.",
        };
      }
      const organizationId = await fetchPrimaryOrganizationId(token);
      return { ok: true, externalAccountId: organizationId ?? me.id };
    } catch (err) {
      if (err instanceof EventbriteApiError) {
        return {
          ok: false,
          error:
            err.status === 401
              ? "Eventbrite rejected the token. Double-check it has at least read access to your events."
              : `Eventbrite error (${err.status}): ${err.message}`,
        };
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      return { ok: false, error: message };
    }
  }

  async listEvents(
    connection: TicketingConnection,
  ): Promise<ExternalEventSummary[]> {
    const token = readPersonalToken(connection);
    const orgId = connection.external_account_id;
    if (!orgId) {
      throw new Error(
        "Eventbrite connection has no external_account_id. Re-validate the connection so we can pick the right organization.",
      );
    }

    const summaries: ExternalEventSummary[] = [];
    const PAGE_LIMIT = 5;
    for (let page = 1; page <= PAGE_LIMIT; page++) {
      const res = await eventbriteGet<EventbriteEventListResponse>(
        token,
        `/organizations/${encodeURIComponent(orgId)}/events/`,
        {
          query: {
            order_by: "start_desc",
            expand: "venue",
            page,
          },
        },
      );
      for (const ev of res.events ?? []) {
        summaries.push({
          externalEventId: ev.id,
          name: ev.name?.text ?? "(untitled)",
          startsAt: ev.start?.utc ?? null,
          url: ev.url ?? null,
          venue:
            ev.venue?.name ??
            ev.venue?.address?.localized_address_display ??
            ev.venue?.address?.city ??
            null,
          capacity: ev.capacity ?? null,
          status: ev.status ?? null,
        });
      }
      if (!res.pagination?.has_more_items) break;
    }

    return summaries;
  }

  async getEventSales(
    connection: TicketingConnection,
    externalEventId: string,
  ): Promise<FetchedTicketSales> {
    const token = readPersonalToken(connection);
    const detail = await eventbriteGet<EventbriteEventDetailResponse>(
      token,
      `/events/${encodeURIComponent(externalEventId)}/`,
      { query: { expand: "ticket_classes" } },
    );

    const ticketClasses = detail.ticket_classes ?? [];

    let ticketsSold = 0;
    let ticketsAvailable: number | null = null;
    let grossRevenueCents = 0;
    let currency: string | null = null;

    for (const tc of ticketClasses) {
      const sold = tc.quantity_sold ?? 0;
      ticketsSold += sold;
      if (tc.quantity_total != null) {
        ticketsAvailable = (ticketsAvailable ?? 0) + tc.quantity_total;
      }
      // Eventbrite reports `cost.value` already in minor units (cents /
      // pence), so we add directly without re-multiplying.
      const costMinor = tc.cost?.value ?? 0;
      grossRevenueCents += sold * costMinor;
      if (!currency && tc.cost?.currency) {
        currency = tc.cost.currency;
      }
    }

    // Fall back to the event-level capacity when no ticket class declares
    // `quantity_total` (free events typically don't).
    if (ticketsAvailable == null && detail.capacity != null) {
      ticketsAvailable = detail.capacity;
    }

    return {
      ticketsSold,
      ticketsAvailable,
      grossRevenueCents: ticketClasses.length === 0 ? null : grossRevenueCents,
      currency,
      rawPayload: detail,
    };
  }
}

export const eventbriteProvider = new EventbriteProvider();
