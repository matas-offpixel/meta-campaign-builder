import "server-only";

/**
 * lib/bm/secrets.ts
 *
 * Resolves BM_TOKEN_KEY — the pgcrypto symmetric key used to encrypt/decrypt
 * the per-BM user OAuth token on `client_business_managers.access_token_encrypted`
 * (migration 145, via set_bm_access_token / get_bm_access_token).
 *
 * DEDICATED key — deliberately NOT D2C_TOKEN_KEY or LANDING_PAGES_TOKEN_KEY.
 * Blast-radius isolation: a leak of one domain's key must not decrypt another's
 * secrets (same convention as the landing-page arc, see LANDING_PAGE_ARCHITECTURE §8).
 */

const ENV_VAR = "BM_TOKEN_KEY";

export class MissingBMTokenKeyError extends Error {
  constructor() {
    super(
      `${ENV_VAR} is not set. Add it to .env.local and Vercel before connecting or scanning Business Managers.`,
    );
    this.name = "MissingBMTokenKeyError";
  }
}

export function getBMTokenKey(): string {
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) {
    throw new MissingBMTokenKeyError();
  }
  return value;
}

export function tryGetBMTokenKey(): string | null {
  const value = process.env[ENV_VAR];
  if (!value || value.length < 8) return null;
  return value;
}
