/**
 * lib/meta/ad-account.ts
 *
 * Canonical helper for normalizing the Meta ad-account identifier
 * between how we store it (`clients.meta_ad_account_id` — raw digits in
 * most rows, `act_…` in a few) and how the Meta Graph API expects it
 * (always `act_<digits>`).
 *
 * Historically every caller rolled its own `startsWith("act_") ? x : \`act_${x}\``
 * one-liner. Collecting them here means:
 *   1. Rejecting malformed inputs in one place instead of scattered regex.
 *   2. Letting callers pass the raw DB value without having to remember.
 *   3. A single audit surface if the storage convention ever changes.
 *
 * The helpers are pure string functions — no I/O.
 */

/**
 * Regex of what Meta Graph will accept after normalization. Digits only
 * after the `act_` prefix. We deliberately reject mixed / extra
 * whitespace / non-digit characters to avoid silently forwarding typos.
 */
const VALID_AD_ACCOUNT_BODY = /^\d{6,}$/;

/**
 * Returns the canonical `act_<digits>` form of an ad account id.
 * Accepts either `12345678` or `act_12345678`. Returns `null` when the
 * input is missing, empty after trimming, or does not contain ≥6 digits
 * (the observable lower bound on real Meta account ids).
 */
export function normalizeAdAccountId(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const body = trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed;
  if (!VALID_AD_ACCOUNT_BODY.test(body)) return null;
  return `act_${body}`;
}

/** Convenience boolean — true when the input normalises cleanly. */
export function isValidAdAccountId(
  raw: string | null | undefined,
): boolean {
  return normalizeAdAccountId(raw) !== null;
}

/**
 * When the Graph call path needs the digits only (e.g. a path segment
 * like `/{account_id}/insights` where the caller already hardcoded `act_`
 * before the interpolation), this returns just the digit body.
 * Returns null when the input fails validation.
 */
export function adAccountDigitsOnly(
  raw: string | null | undefined,
): string | null {
  const normalized = normalizeAdAccountId(raw);
  if (!normalized) return null;
  return normalized.slice(4);
}
