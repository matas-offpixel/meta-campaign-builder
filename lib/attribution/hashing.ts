/**
 * lib/attribution/hashing.ts
 *
 * Hashing helpers for the real-attribution matching layer (PR #423).
 *
 * Email + external-id are STORED HASHED on `ticketing_purchase_events`
 * and `meta_click_touchpoints` so the matcher cron can join across
 * sources without retaining raw PII outside the `raw_payload` audit
 * column. The hashing contract has to be byte-for-byte identical
 * across consumers — anything that changes the normalisation rule
 * silently breaks already-stored hashes — so all of it lives here.
 *
 * Normalisation rule (matches Meta CAPI's email-hash convention):
 *   1. Trim leading + trailing whitespace.
 *   2. Lowercase.
 *   3. SHA-256 hex (lowercase).
 *
 * Empty or whitespace-only inputs return `null` rather than the hash
 * of an empty string. Callers should treat `null` as "no signal" and
 * skip the corresponding match strategy.
 */

import { createHash } from "node:crypto";

/**
 * Hash an email per the rule above. Returns `null` for nullish or
 * whitespace-only inputs so callers can drop the column rather than
 * insert the sha256 of "".
 *
 * Idempotent: hashEmail("Bob@Example.com ") and hashEmail("bob@example.com")
 * return the same digest.
 */
export function hashEmail(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;
  return sha256Hex(trimmed);
}

/**
 * Hash any other stable user identifier (CRM id, ticketing customer
 * id, etc). Same trim+lowercase rule so collisions across providers
 * that happen to use the same id format stay deterministic.
 */
export function hashExternalId(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "") return null;
  return sha256Hex(trimmed);
}

/**
 * Hash an IP address for storage on the audit columns. Same shape as
 * the others. We hash rather than store raw IPs to align with the
 * "no raw PII outside `raw_payload`" rule.
 */
export function hashIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return sha256Hex(trimmed.toLowerCase());
}

/**
 * Convenience: hex-encoded sha256 of an arbitrary string. Exposed
 * because the webhook-signature path uses it for HMAC verification
 * and a per-PR consolidation makes it grep-able.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Constant-time equality check for hex strings (e.g. comparing a
 * webhook signature against the expected HMAC). Falls back to a
 * non-throwing path on length mismatch — `crypto.timingSafeEqual`
 * raises on mismatched lengths which would leak length information
 * to an attacker.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
