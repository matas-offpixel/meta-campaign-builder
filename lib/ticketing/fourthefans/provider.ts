/**
 * lib/ticketing/fourthefans/provider.ts
 *
 * 4TheFans native adapter. The native API is in development at the time
 * of this commit. This module is shaped exactly like the Eventbrite
 * provider so the swap-in, when 4TheFans publish their docs, is a
 * one-file edit.
 *
 * Today every contract method is gated behind `FEATURE_FOURTHEFANS_API`.
 * When the flag is off (default), each method throws
 * `FourthefansDisabledError` (a subclass of `TicketingProviderDisabledError`)
 * with a message pointing operators at the onboarding doc. When the flag
 * is on but the spec hasn't landed yet, the methods throw a TODO error
 * — flipping the flag in production is a deliberate operator action and
 * should not silently succeed against an unfinished implementation.
 *
 * To complete this adapter (Task D follow-up):
 *   1. Replace each TODO block below with the real provider calls.
 *   2. Update `FourthefansApiError` handling in `client.ts` to match
 *      4TheFans' actual error envelope.
 *   3. Drop the `FEATURE_FOURTHEFANS_API` gate or switch to a kill-switch
 *      role only.
 *   4. Add the personal-token field name (likely `access_token`) to the
 *      `credentials` blob shape in `lib/ticketing/types.ts`.
 *
 * The doc at `docs/ticketing/fourthefans-onboarding.md` walks Matas
 * through this end-to-end.
 */

import {
  fourthefansGet,
  FourthefansApiError,
} from "@/lib/ticketing/fourthefans/client";
import {
  TicketingProviderDisabledError,
  type ExternalEventSummary,
  type FetchedTicketSales,
  type TicketingConnection,
  type TicketingProvider,
  type ValidateCredentialsResult,
} from "@/lib/ticketing/types";

const ONBOARDING_DOC = "docs/ticketing/fourthefans-onboarding.md";
const DISABLED_MESSAGE =
  `4TheFans native adapter is gated behind FEATURE_FOURTHEFANS_API. ` +
  `See ${ONBOARDING_DOC} to enable it once their API spec is published.`;
const TODO_MESSAGE =
  `FEATURE_FOURTHEFANS_API is on but the 4TheFans adapter has not been ` +
  `implemented yet — the API spec is still pending. See ${ONBOARDING_DOC}.`;

export class FourthefansDisabledError extends TicketingProviderDisabledError {
  constructor(message: string = DISABLED_MESSAGE) {
    super("fourthefans", message);
    this.name = "FourthefansDisabledError";
  }
}

function isFlagEnabled(): boolean {
  const raw = process.env.FEATURE_FOURTHEFANS_API;
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

function extractToken(credentials: Record<string, unknown>): string | null {
  const v = credentials["access_token"];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export class FourthefansProvider implements TicketingProvider {
  readonly name = "fourthefans" as const;

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<ValidateCredentialsResult> {
    if (!isFlagEnabled()) {
      return { ok: false, error: DISABLED_MESSAGE };
    }
    const token = extractToken(credentials);
    if (!token) {
      return {
        ok: false,
        error: "Missing 4TheFans access_token in credentials.",
      };
    }
    try {
      // TODO(4thefans-spec): replace `me` with the actual identity
      // endpoint once the spec lands. Expected response shape: an
      // object with an `account.id` (or similar) we can persist as
      // `external_account_id`.
      const me = await fourthefansGet<{
        account?: { id?: string | number };
        id?: string | number;
      }>(token, "me");
      const externalAccountId =
        me.account?.id !== undefined
          ? String(me.account.id)
          : me.id !== undefined
            ? String(me.id)
            : null;
      return { ok: true, externalAccountId };
    } catch (err) {
      if (err instanceof FourthefansApiError) {
        return {
          ok: false,
          error: `4TheFans rejected the credentials (status ${err.status}): ${err.message}`,
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
    if (!isFlagEnabled()) {
      throw new FourthefansDisabledError();
    }
    const token = extractToken(connection.credentials);
    if (!token) {
      throw new FourthefansDisabledError(
        "4TheFans connection is missing access_token.",
      );
    }
    // TODO(4thefans-spec): real endpoint pending. Expected to be
    // something like `accounts/:id/events` returning a paginated array
    // of { id, title, starts_at, url, status }.
    throw new FourthefansDisabledError(TODO_MESSAGE);
  }

  async getEventSales(
    connection: TicketingConnection,
    externalEventId: string,
  ): Promise<FetchedTicketSales> {
    if (!isFlagEnabled()) {
      throw new FourthefansDisabledError();
    }
    const token = extractToken(connection.credentials);
    if (!token) {
      throw new FourthefansDisabledError(
        "4TheFans connection is missing access_token.",
      );
    }
    void externalEventId;
    // TODO(4thefans-spec): real endpoint pending. Expected to return
    // the per-event sales totals; map their fields onto
    // FetchedTicketSales (ticketsSold, ticketsAvailable,
    // grossRevenueCents, currency).
    throw new FourthefansDisabledError(TODO_MESSAGE);
  }
}

export const fourthefansProvider = new FourthefansProvider();
