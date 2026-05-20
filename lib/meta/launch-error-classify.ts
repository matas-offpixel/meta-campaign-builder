/**
 * lib/meta/launch-error-classify.ts
 *
 * Maps a Meta Graph error code to an honest, actionable launch message.
 *
 * The launch path used to treat ANY token-validation failure as token expiry
 * ("Your Facebook connection has expired… reconnect"). But Meta's /debug_token
 * call can itself be RATE-LIMITED (#4 "Application request limit reached",
 * is_transient:true) when the token is perfectly fresh — so the user was sent
 * reconnecting repeatedly for nothing (see memory
 * project_auth_error_masks_rate_limit). This classifier separates the two.
 *
 * Mirrors the code-mapping shape of `campaignFetchSkipReason` (PR #394) and is
 * dependency-free + duck-typed so it imports cleanly under the strip-only test
 * runner (no `@/` imports, no `server-only`).
 */

/**
 * App/user/account-level rate limits — TRANSIENT. The fix is to wait and retry,
 * NOT to reconnect Facebook.
 *   4     — Application request limit reached
 *   17    — User request limit reached
 *   341   — Application-level rate cap (alt code on some edges)
 *   80004 — Ad-account request limit reached
 */
const META_RATE_LIMIT_CODES: ReadonlySet<number> = new Set([4, 17, 341, 80004]);

/**
 * Genuine auth failures — the token really is expired/invalid, so reconnecting
 * Facebook IS the correct fix.
 *   190 — Access token expired / invalidated
 *   102 — Session key invalid / expired
 */
const META_AUTH_CODES: ReadonlySet<number> = new Set([190, 102]);

export type LaunchErrorKind = "rate_limit" | "auth" | "other";

/** Classify a Meta error code into the three launch-relevant buckets. */
export function classifyLaunchMetaCode(
  code: number | undefined | null,
): LaunchErrorKind {
  if (typeof code !== "number") return "other";
  if (META_RATE_LIMIT_CODES.has(code)) return "rate_limit";
  if (META_AUTH_CODES.has(code)) return "auth";
  return "other";
}

export interface LaunchTokenErrorMapping {
  kind: LaunchErrorKind;
  /** User-facing message. */
  message: string;
  /** HTTP status the launch route should return. */
  status: number;
  /** Whether the client should prompt a Facebook reconnect. */
  reconnect: boolean;
}

/** Honest reconnect copy — kept verbatim so the existing client UX still fires. */
const RECONNECT_MESSAGE =
  "Your Facebook connection has expired. Please reconnect Facebook in Account Setup before launching.";

/**
 * Map a failed token-validation code to the response the launch route should
 * send. Rate limits get a transient/retry message and do NOT prompt a reconnect;
 * everything else (genuine auth failures AND inconclusive/unknown validation
 * errors) keeps the pre-existing reconnect block so the auth gate isn't weakened.
 */
export function mapLaunchTokenError(
  code: number | undefined | null,
): LaunchTokenErrorMapping {
  const kind = classifyLaunchMetaCode(code);
  if (kind === "rate_limit") {
    return {
      kind,
      status: 429,
      reconnect: false,
      message: `Meta rate limit reached (#${code}) — this is temporary, please retry in a few minutes.`,
    };
  }
  return { kind, status: 401, reconnect: true, message: RECONNECT_MESSAGE };
}
