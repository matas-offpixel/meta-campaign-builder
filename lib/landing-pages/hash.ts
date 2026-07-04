import { createHash } from "node:crypto";

/**
 * lib/landing-pages/hash.ts
 *
 * Salted sha256 helpers for the signup write path (SERVER-ONLY — node:crypto;
 * the client form never hashes anything).
 *
 *   email_hash / phone_hash — per-event dedupe WITHOUT decrypting PII. The
 *   hash is namespaced by kind so hashEmail(x) can never collide with
 *   hashPhone(x), and salted with LANDING_PAGES_HASH_SALT so the hashes are
 *   useless for cross-referencing against external datasets.
 *
 *   ip_hash — raw IPs are never stored (GDPR data minimisation); the hash
 *   still lets abuse analysis group repeated submitters.
 *
 * ⚠ The salt must be treated as IMMUTABLE once live: rotating it silently
 * breaks dedupe (old hashes never match new ones → duplicate canonical
 * rows). If rotation is ever forced, a re-hash backfill via decryption is
 * required — documented in the design doc's PII section.
 */

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function requireSalt(salt: string): string {
  if (!salt || salt.length < 8) {
    throw new Error(
      "LANDING_PAGES_HASH_SALT must be set and at least 8 characters",
    );
  }
  return salt;
}

/** Email must already be normalised (lowercased/trimmed) by the schema. */
export function hashEmail(normalisedEmail: string, salt: string): string {
  return sha256Hex(`lp-email:${requireSalt(salt)}:${normalisedEmail}`);
}

/** Phone must already be E.164 (schema output). */
export function hashPhone(phoneE164: string, salt: string): string {
  return sha256Hex(`lp-phone:${requireSalt(salt)}:${phoneE164}`);
}

export function hashIp(ip: string, salt: string): string {
  return sha256Hex(`lp-ip:${requireSalt(salt)}:${ip}`);
}

/** First hop of x-forwarded-for, or null when absent. */
export function ipFromForwardedFor(
  xForwardedFor: string | null | undefined,
): string | null {
  const ip = (xForwardedFor ?? "").split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}
