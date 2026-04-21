/**
 * lib/ticketing/fourthefans/provider.ts
 *
 * STUB. The native 4TheFans API is in development at the time of this
 * commit. The full implementation lands in Task D — this file exists so
 * the registry can return a recognised provider object today and Task D
 * is a one-file edit, not a design session.
 *
 * Calling any of the contract methods throws `TicketingProviderDisabledError`
 * with a clear message pointing operators at Task D's onboarding doc.
 */

import {
  TicketingProviderDisabledError,
  type ExternalEventSummary,
  type FetchedTicketSales,
  type TicketingConnection,
  type TicketingProvider,
  type ValidateCredentialsResult,
} from "@/lib/ticketing/types";

const PENDING_MESSAGE =
  "4TheFans native adapter pending their API release. See docs/ticketing/fourthefans-onboarding.md.";

// Stub methods take their full signatures so the contract is visible at
// the call site (TS infers the right overloads on the registry too).
// The args are intentionally unread today — Task D's onboarding doc
// covers the work-in-anger replacement.
/* eslint-disable @typescript-eslint/no-unused-vars */
export class FourthefansProvider implements TicketingProvider {
  readonly name = "fourthefans" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateCredentialsResult> {
    return { ok: false, error: PENDING_MESSAGE };
  }

  async listEvents(
    connection: TicketingConnection,
  ): Promise<ExternalEventSummary[]> {
    throw new TicketingProviderDisabledError("fourthefans", PENDING_MESSAGE);
  }

  async getEventSales(
    connection: TicketingConnection,
    externalEventId: string,
  ): Promise<FetchedTicketSales> {
    throw new TicketingProviderDisabledError("fourthefans", PENDING_MESSAGE);
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export const fourthefansProvider = new FourthefansProvider();
