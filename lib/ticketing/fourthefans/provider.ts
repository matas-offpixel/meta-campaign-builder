/**
 * lib/ticketing/fourthefans/provider.ts
 *
 * 4TheFans native adapter. Auth is a per-client bearer token pasted into
 * client settings. The upstream API has only two documented endpoints:
 * `/events` and `/events/{event_id}`.
 */

import {
  fourthefansGet,
  FourthefansApiError,
} from "@/lib/ticketing/fourthefans/client";
import {
  extractFourthefansEventArray,
  hasMoreFourthefansEvents,
  readFourthefansEventSales,
  readFourthefansEventSummary,
} from "@/lib/ticketing/fourthefans/parse";
import {
  type ExternalEventSummary,
  type FetchedTicketSales,
  type TicketingConnection,
  type TicketingProvider,
  type ValidateCredentialsResult,
} from "@/lib/ticketing/types";

const PAGE_LIMIT = 20;
const PAGE_SIZE = 50;

function extractToken(credentials: Record<string, unknown>): string | null {
  const v = credentials["access_token"] ?? credentials["api_key"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export class FourthefansProvider implements TicketingProvider {
  readonly name = "fourthefans" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateCredentialsResult> {
    const token = extractToken(credentials);
    if (!token) {
      return {
        ok: false,
        error: "Paste your 4thefans API key to continue.",
      };
    }
    try {
      await fourthefansGet<unknown>(token, "/events", {
        query: { per_page: 1, include_past: "false" },
      });
      return { ok: true, externalAccountId: "4thefans" };
    } catch (err) {
      if (err instanceof FourthefansApiError) {
        return {
          ok: false,
          error:
            err.status === 401
              ? "4thefans rejected the API key. Check it was copied in full and has agency event read access."
              : err.status === 429
                ? rateLimitMessage(err.retryAfterMs)
                : `4thefans error (${err.status}): ${err.message}`,
        };
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listEvents(
    connection: TicketingConnection,
  ): Promise<ExternalEventSummary[]> {
    return this.listAllEvents(connection.credentials, { include_past: false });
  }

  async getEventSales(
    connection: TicketingConnection,
    externalEventId: string,
    options?: { apiBase?: string | null },
  ): Promise<FetchedTicketSales> {
    return this.fetchEventByExternalId(
      externalEventId,
      connection.credentials,
      options?.apiBase,
    );
  }

  async listAllEvents(
    credentials: Record<string, unknown>,
    options: { include_past?: boolean } = {},
  ): Promise<ExternalEventSummary[]> {
    const token = extractCredentialsToken(credentials);
    const summaries: ExternalEventSummary[] = [];
    for (let page = 1; page <= PAGE_LIMIT; page += 1) {
      const payload = await fourthefansGet<unknown>(token, "/events", {
        query: {
          page,
          per_page: PAGE_SIZE,
          include_past: options.include_past ? "true" : "false",
        },
      });
      const events = extractFourthefansEventArray(payload);
      for (const event of events) {
        const summary = readFourthefansEventSummary(event);
        if (summary) summaries.push(summary);
      }
      if (!hasMoreFourthefansEvents(payload, page, events.length, PAGE_SIZE)) {
        break;
      }
    }
    return summaries;
  }

  async fetchEventByExternalId(
    externalId: string,
    credentials: Record<string, unknown>,
    apiBase?: string | null,
  ): Promise<FetchedTicketSales> {
    const token = extractCredentialsToken(credentials);
    console.info(
      `[fourthefans-sync] API request external_event_id=${externalId}${apiBase ? ` api_base=${apiBase}` : ""}`,
    );
    const payload = await fourthefansGet<unknown>(
      token,
      `/events/${encodeURIComponent(externalId)}`,
      { apiBase },
    );
    const bodyLength = safeJsonLength(payload);
    console.info(
      `[fourthefans-sync] API response status=ok external_event_id=${externalId} body_length=${bodyLength}`,
    );
    // Log raw payload to surface undocumented tier-array keys so the parser
    // can be extended against the observed shape (truncated at 5 000 chars to
    // avoid flooding structured logs).
    try {
      const raw = JSON.stringify(payload);
      console.info(
        `[fourthefans-sync] raw_payload external_event_id=${externalId} ${raw.length > 5000 ? raw.slice(0, 5000) + "…[truncated]" : raw}`,
      );
    } catch {
      // ignore serialization errors
    }
    const sales = readFourthefansEventSales(payload);
    console.info(
      `[fourthefans-sync] parsed external_event_id=${externalId} tickets_sold=${sales.ticketsSold} tickets_available=${sales.ticketsAvailable ?? "<null>"} gross_revenue_cents=${sales.grossRevenueCents ?? "<null>"} currency=${sales.currency ?? "<null>"} ticket_tiers=${sales.ticketTiers.length}`,
    );

    return {
      ticketsSold: sales.ticketsSold,
      ticketsAvailable: sales.ticketsAvailable,
      grossRevenueCents: sales.grossRevenueCents,
      currency: sales.currency,
      ticketTiers: sales.ticketTiers,
      rawPayload: payload,
    };
  }
}

export const fourthefansProvider = new FourthefansProvider();

function extractCredentialsToken(credentials: Record<string, unknown>): string {
  const token = extractToken(credentials);
  if (!token) {
    throw new Error("4thefans credentials are missing access_token.");
  }
  return token;
}

function safeJsonLength(payload: unknown): number {
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return 0;
  }
}

function rateLimitMessage(retryAfterMs: number | null): string {
  const seconds =
    retryAfterMs == null ? 60 : Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Rate limit exceeded. Retry in ${seconds}s.`;
}
