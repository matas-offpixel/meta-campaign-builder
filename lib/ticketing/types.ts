/**
 * lib/ticketing/types.ts
 *
 * Provider-agnostic surface for the ticket-sales pipeline. Every external
 * ticketing system (Eventbrite, 4TheFans, future) implements
 * `TicketingProvider` and registers itself in `lib/ticketing/registry.ts`.
 * The dashboard, sync cron, and reporting panel only ever speak to the
 * registry — never to a concrete provider — so swapping providers is a
 * one-line registry edit, not a feature change.
 *
 * The DB rows live in migration 029: `client_ticketing_connections`,
 * `event_ticketing_links`, `ticket_sales_snapshots`. The shapes below
 * mirror those rows but are hand-typed because the regenerated Supabase
 * types are produced separately by the schema-types tool.
 */

export type TicketingProviderName =
  | "eventbrite"
  | "fourthefans"
  | "foursomething_internal"
  | "manual";

export type TicketingConnectionStatus = "active" | "paused" | "error";

/**
 * In-memory view of `client_ticketing_connections`. The credentials blob
 * is provider-specific:
 *   - eventbrite v1:    { personal_token: string }
 *   - fourthefans v1:   { access_token: string }
 */
export interface TicketingConnection {
  id: string;
  user_id: string;
  client_id: string;
  provider: TicketingProviderName;
  credentials: Record<string, unknown>;
  external_account_id: string | null;
  status: TicketingConnectionStatus;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * In-memory view of `event_ticketing_links` — the pivot row between an
 * internal `events.id` and an external event identifier on the provider.
 */
export interface EventTicketingLink {
  id: string;
  user_id: string;
  event_id: string;
  connection_id: string;
  external_event_id: string;
  external_event_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Append-only ticket-sales row written by every sync (cron + manual). The
 * pacing chart in Task F reads the most recent ~60 rows by `snapshot_at`.
 */
export interface TicketSalesSnapshot {
  id: string;
  user_id: string;
  event_id: string;
  connection_id: string;
  snapshot_at: string;
  tickets_sold: number;
  tickets_available: number | null;
  gross_revenue_cents: number | null;
  currency: string | null;
  source:
    | "eventbrite"
    | "fourthefans"
    | "manual"
    | "xlsx_import"
    | "foursomething";
  raw_payload: unknown;
  created_at: string;
}

export interface TicketTierBreakdown {
  tierName: string;
  price: number | null;
  quantitySold: number;
  quantityAvailable: number | null;
}

/**
 * Provider-side view of an external event. Used by the linking UI: the
 * user picks a row from `listEvents` to bind to an internal event.
 */
export interface ExternalEventSummary {
  externalEventId: string;
  name: string;
  startsAt: string | null;
  url: string | null;
  /** Provider-reported venue/location string when list endpoints expose it. */
  venue?: string | null;
  /** Provider-reported event capacity when list endpoints expose it. */
  capacity?: number | null;
  /**
   * Provider-reported status when present. Used for UI hints only — we
   * never gate sync on this because providers disagree on values.
   */
  status?: string | null;
}

/**
 * Snapshot returned by `getEventSales` — the in-flight shape that the
 * sync route persists into `ticket_sales_snapshots` (minus the FK
 * columns + `id` + `snapshot_at`, which are filled in by the caller).
 */
export interface FetchedTicketSales {
  ticketsSold: number;
  ticketsAvailable: number | null;
  grossRevenueCents: number | null;
  currency: string | null;
  ticketTiers?: TicketTierBreakdown[];
  /**
   * Untyped provider payload kept for debugging. Persisted into
   * `raw_payload` on the snapshot row — never read by the app code.
   */
  rawPayload: unknown;
}

export interface ValidateCredentialsResult {
  ok: boolean;
  error?: string;
  /**
   * Provider-side identifier for the authenticated account (Eventbrite
   * organization id, etc.). Persisted onto
   * `client_ticketing_connections.external_account_id` on save.
   */
  externalAccountId?: string | null;
}

/**
 * The provider contract. Every ticketing integration implements this
 * interface; the dashboard only ever calls these three methods. Keep it
 * small — provider-specific quirks belong inside the implementation, not
 * leaked through the interface.
 */
export interface TicketingProvider {
  /** Stable identifier matching the `provider` enum in the DB. */
  readonly name: TicketingProviderName;
  validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateCredentialsResult>;
  listEvents(connection: TicketingConnection): Promise<ExternalEventSummary[]>;
  getEventSales(
    connection: TicketingConnection,
    externalEventId: string,
  ): Promise<FetchedTicketSales>;
}

/**
 * Thrown by feature-flagged providers when the integration is gated off
 * (e.g. 4TheFans before their API ships, see Task D). Catching this in
 * the cron / API route lets us surface a clear error message instead of
 * a generic 500.
 */
export class TicketingProviderDisabledError extends Error {
  readonly providerName: TicketingProviderName;
  constructor(providerName: TicketingProviderName, message: string) {
    super(message);
    this.name = "TicketingProviderDisabledError";
    this.providerName = providerName;
  }
}
