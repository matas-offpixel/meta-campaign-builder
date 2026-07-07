/**
 * lib/d2c/share-token.ts
 *
 * Share-token generation seam for the public D2C event dashboard. The token
 * IS the credential (same posture as report shares) so it must be long and
 * unguessable. Randomness is injected so the generator is unit-testable.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";

/** Fixed public token length — 32 URL-safe chars. */
export const D2C_SHARE_TOKEN_LENGTH = 32;

/**
 * Base64url-encode a buffer (RFC 4648 §5): `+`→`-`, `/`→`_`, strip `=`.
 * Pure — no side effects.
 */
export function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Generate a 32-char URL-safe random token. 24 random bytes base64url-encode
 * to exactly 32 chars (no padding). `randomBytes` is injectable for tests.
 */
export function generateD2CShareToken(
  randomBytes: (n: number) => Buffer = nodeRandomBytes,
): string {
  // 24 bytes → 32 base64url chars.
  return base64UrlEncode(randomBytes(24)).slice(0, D2C_SHARE_TOKEN_LENGTH);
}

/** Cheap shape guard used by the public route before hitting the DB. */
export function isValidD2CShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}
