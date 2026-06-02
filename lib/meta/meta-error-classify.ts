/**
 * lib/meta/meta-error-classify.ts
 *
 * Route-agnostic classifier for Meta Graph API error codes. Splits the codes
 * into the three buckets that drive how we respond:
 *
 *   rate_limit — TRANSIENT app/user/account caps. The fix is to wait and retry,
 *                NOT to reconnect Facebook. Crucially, Meta returns these with
 *                `type:"OAuthException"` and `is_transient:true`, so any gate
 *                that keys off the OAuthException *type* (rather than the code)
 *                mislabels them as token expiry and sends users to reconnect
 *                for nothing (see memory project_auth_error_masks_rate_limit;
 *                fixed for launch in #436, clone already code-gated in #466,
 *                saved-audience read was the outlier this corrects).
 *   auth       — Genuine token expiry/invalidation. Reconnecting Facebook IS
 *                the correct fix.
 *   other      — Everything else (permissions, validation, server errors).
 *
 * Dependency-free + duck-typed so it imports cleanly under the strip-only test
 * runner (no `@/` imports, no `server-only`). Mirrors the code-mapping shape of
 * `campaignFetchSkipReason` (PR #394). Relocated/renamed from
 * `classifyLaunchMetaCode` so both the launch route and the saved-audiences
 * route consume one shared helper — preventing a fourth misclassification.
 */

/**
 * App/user/account-level rate limits — TRANSIENT. Wait and retry; do NOT
 * reconnect Facebook.
 *   4     — Application request limit reached
 *   17    — User request limit reached
 *   341   — Application-level rate cap (alt code on some edges)
 *   80004 — Ad-account request limit reached
 */
export const META_RATE_LIMIT_CODES: ReadonlySet<number> = new Set([
  4, 17, 341, 80004,
]);

/**
 * Genuine auth failures — the token really is expired/invalid, so reconnecting
 * Facebook IS the correct fix.
 *   190 — Access token expired / invalidated
 *   102 — Session key invalid / expired
 */
export const META_AUTH_CODES: ReadonlySet<number> = new Set([190, 102]);

export type MetaErrorKind = "rate_limit" | "auth" | "other";

/** Classify a Meta error code into the three response-relevant buckets. */
export function classifyMetaCode(
  code: number | undefined | null,
): MetaErrorKind {
  if (typeof code !== "number") return "other";
  if (META_RATE_LIMIT_CODES.has(code)) return "rate_limit";
  if (META_AUTH_CODES.has(code)) return "auth";
  return "other";
}
