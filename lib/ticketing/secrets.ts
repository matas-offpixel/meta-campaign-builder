import "server-only";

/**
 * lib/ticketing/secrets.ts
 *
 * Single source for the symmetric key used by `pgp_sym_encrypt` /
 * `pgp_sym_decrypt` when reading and writing
 * `client_ticketing_connections.credentials_encrypted`.
 *
 * The key lives in env (`EVENTBRITE_TOKEN_KEY`) and is passed into the
 * SQL RPC as a parameter on every call — pgcrypto stretches it
 * internally, so any random ≥32 character string is fine. It is never
 * returned to the browser, never logged, never written to the DB.
 *
 * Naming: kept "EVENTBRITE_TOKEN_KEY" rather than something
 * provider-agnostic ("TICKETING_SECRET") so it's obvious what the key
 * unlocks when reviewing Vercel envs. If we ever encrypt non-ticketing
 * credentials with a different key we'll add a sibling helper rather
 * than reusing this one.
 */

const ENV_VAR = "EVENTBRITE_TOKEN_KEY";

export class MissingTokenKeyError extends Error {
  constructor() {
    super(
      `${ENV_VAR} is not set. Add it to .env.local and Vercel (production + preview) before saving or syncing Eventbrite connections.`,
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
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) {
    throw new MissingTokenKeyError();
  }
  return value;
}

/**
 * Soft variant — returns null instead of throwing. Used by code paths
 * that need to degrade gracefully (e.g. listing connections in a
 * server component when the key is missing in dev), so the page can
 * still render with a banner instead of 500-ing on every request.
 */
export function tryGetEventbriteTokenKey(): string | null {
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) return null;
  return value;
}
