import "server-only";

/**
 * lib/ticketing/secrets.ts
 *
 * Single source for the symmetric key used by `pgp_sym_encrypt` /
 * `pgp_sym_decrypt` when reading and writing
 * `client_ticketing_connections.credentials_encrypted`.
 *
 * The key lives in env and is passed into the SQL RPC as a parameter on
 * every call — pgcrypto stretches it internally, so any random ≥32
 * character string is fine. It is never
 * returned to the browser, never logged, never written to the DB.
 *
 * Naming: Eventbrite originally used `EVENTBRITE_TOKEN_KEY`. 4thefans
 * gets its own `FOURTHEFANS_TOKEN_KEY` so token rotation can happen per
 * upstream provider while reusing the same SQL RPCs.
 */

import type { TicketingProviderName } from "@/lib/ticketing/types";

const EVENTBRITE_ENV_VAR = "EVENTBRITE_TOKEN_KEY";
const FOURTHEFANS_ENV_VAR = "FOURTHEFANS_TOKEN_KEY";

export class MissingTokenKeyError extends Error {
  constructor(envVar: string) {
    super(
      `${envVar} is not set. Add it to .env.local and Vercel (production + preview) before saving or syncing ticketing connections.`,
    );
    this.name = "MissingTokenKeyError";
  }
}

/**
 * Returns the symmetric key, throwing `MissingTokenKeyError` when the
 * env var is unset or shorter than 8 characters. The 8-char floor
 * matches the SQL RPC's defensive check so a caller never gets past
 * here only to see a `pg_catalog.pgp_sym_encrypt` error.
 *
 * Callers should treat the throw as a 500-class condition: the
 * dashboard cannot encrypt or decrypt connections without the key, and
 * we'd rather fail loudly than silently fall back to the legacy
 * plaintext column for new writes.
 */
export function getEventbriteTokenKey(): string {
  const value = process.env[EVENTBRITE_ENV_VAR];
  if (!value || value.length < 8) {
    throw new MissingTokenKeyError(EVENTBRITE_ENV_VAR);
  }
  return value;
}

export function getTicketingTokenKey(provider: TicketingProviderName): string {
  if (provider === "fourthefans") {
    const value = process.env[FOURTHEFANS_ENV_VAR];
    if (!value || value.length < 8) {
      throw new MissingTokenKeyError(FOURTHEFANS_ENV_VAR);
    }
    return value;
  }
  return getEventbriteTokenKey();
}

/**
 * Soft variant — returns null instead of throwing. Used by code paths
 * that need to degrade gracefully (e.g. listing connections in a
 * server component when the key is missing in dev), so the page can
 * still render with a banner instead of 500-ing on every request.
 */
export function tryGetEventbriteTokenKey(): string | null {
  const value = process.env[EVENTBRITE_ENV_VAR];
  if (!value || value.length < 8) return null;
  return value;
}

export function tryGetTicketingTokenKey(
  provider: TicketingProviderName,
): string | null {
  const envVar =
    provider === "fourthefans" ? FOURTHEFANS_ENV_VAR : EVENTBRITE_ENV_VAR;
  const value = process.env[envVar];
  if (!value || value.length < 8) return null;
  return value;
}
