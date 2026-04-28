/**
 * lib/ticketing/manual/provider.ts
 *
 * Null provider for events that have no upstream ticketing API. The
 * operator types cumulative tickets into the dashboard's bulk catch-
 * up grid (`/events/[id]/manual-tickets`) and the rows land in
 * `ticket_sales_snapshots` with `source='manual'`, `connection_id`
 * pointing at the manual connection created here.
 *
 * Registering the manual provider against the existing
 * `TicketingProvider` interface lets the rest of the stack (event
 * readiness, rollout audit, connections CRUD) treat it like any
 * other provider without branching per-provider everywhere.
 *
 * All three methods are intentional no-ops:
 *   - `validateCredentials` always returns ok, empty credentials are
 *     fine — we never need to auth against an upstream.
 *   - `listEvents` returns [] because there's no remote event list to
 *     bind to; the internal event row IS the event.
 *   - `getEventSales` throws — the cron must never invoke the manual
 *     provider. `recordConnectionSync` on a manual connection is the
 *     caller's bug.
 */

import type {
  TicketingProvider,
  ValidateCredentialsResult,
  FetchedTicketSales,
} from "@/lib/ticketing/types";

export const manualProvider: TicketingProvider = {
  name: "manual",
  async validateCredentials(): Promise<ValidateCredentialsResult> {
    return { ok: true, externalAccountId: null };
  },
  async listEvents() {
    return [];
  },
  async getEventSales(): Promise<FetchedTicketSales> {
    throw new Error(
      "Manual provider has no upstream API — tickets are entered directly via /events/[id]/manual-tickets.",
    );
  },
};
