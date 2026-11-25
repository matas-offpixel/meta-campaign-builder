/**
 * lib/mcp/crypto.ts
 *
 * Opaque tokens and PKCE. Tokens are 32 random bytes, base64url, with a
 * readable prefix; only `sha256Hex(token)` is ever stored or compared.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_PREFIX = {
  access: "opx_at_",
  refresh: "opx_rt_",
  code: "opx_code_",
  client: "opx_client_",
} as const;

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Base64url(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

/** RFC 7636 verifier: 43–128 chars of [A-Za-z0-9-._~]. */
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}

/** S256 only: BASE64URL(SHA256(verifier)) === challenge, compared in constant time. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const a = Buffer.from(sha256Base64url(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** For tests and the local client. */
export function pkceChallengeFor(verifier: string): string {
  return sha256Base64url(verifier);
}
