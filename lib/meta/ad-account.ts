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

/**
 * Resolve the ad account an EVENT's Meta data lives in.
 *
 * `clients.meta_ad_account_id` is one account per client, which breaks
 * as soon as a client runs venues out of separate ad accounts. Electric
 * Brixton was the first: Mall Grab runs in ELECTRIC STUDIOS SHEFFIELD
 * while the four NX Newcastle shows run in NX Promoter. Every Newcastle
 * event reported zero spend — correctly named campaigns, queried against
 * an account they were never in.
 *
 * `events.meta_ad_account_id` is the per-event override. NULL means
 * "inherit from the client", so existing rows keep their current
 * behaviour and only deliberately-overridden events diverge.
 *
 * Returns the RAW stored value (bare digits), not the `act_` form —
 * callers already normalise. Null when neither level has an account.
 */
export function resolveEventAdAccountId(
  event:
    | {
        meta_ad_account_id?: string | null;
        client?:
          | { meta_ad_account_id?: string | null }
          | { meta_ad_account_id?: string | null }[]
          | null;
      }
    | null
    | undefined,
  clientFallback?: string | null,
): string | null {
  if (!event) return clientFallback?.trim() || null;

  const own = event.meta_ad_account_id?.trim();
  if (own) return own;

  const rel = Array.isArray(event.client) ? event.client[0] : event.client;
  const inherited = rel?.meta_ad_account_id?.trim();
  if (inherited) return inherited;

  return clientFallback?.trim() || null;
}
