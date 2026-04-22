/**
 * lib/meta/error-classify.ts
 *
 * Pure error-classification helpers for Meta Graph API responses.
 * Lives outside `lib/meta/client.ts` so unit tests (which run via
 * Node's `--experimental-strip-types` mode) can import the
 * helpers without dragging in client.ts's TypeScript-parameter-
 * property class declarations — strip-only mode rejects those.
 *
 * `lib/meta/client.ts` re-exports `isReduceDataError` from here
 * so callers keep importing from the canonical Meta surface.
 */

/**
 * Detect Meta's "Please reduce the amount of data you're asking
 * for" response. This is Meta's per-account compute-budget cap on
 * /insights queries with action-level breakdowns over wide
 * windows — NOT a rate limit. Retrying the same query never
 * succeeds; the day-chunked fallback in `lib/insights/meta.ts`
 * fans out per-day calls instead.
 *
 * Real-world response shape (from production Vercel logs):
 *   {
 *     message: "An unknown error occurred",
 *     code: 1,
 *     type: "OAuthException",
 *     error_subcode: 99,
 *     error_user_title: "Please reduce the amount of data",
 *     error_user_msg: "Please reduce the amount of data you're asking for, then retry your request",
 *     fbtrace_id: "ABCD..."
 *   }
 *
 * Critical: the actionable phrase is in `error_user_msg`, NOT in
 * `message`. After PR #43 shipped without `parseMetaError`
 * extracting `error_user_msg`/`error_subcode`, the classifier
 * never matched and AutoRetry kept hammering. PR #44 (this one)
 * fixes both ends:
 *   - parseMetaError now propagates userMsg + rawErrorData
 *   - this regex now searches userMsg + rawErrorData stringify
 *
 * No code prefilter on purpose — Meta has shipped this error with
 * code 1, code 2, code 100 + subcode 2335012, and as a raw
 * network wrapping where `code` is undefined. The string match on
 * the canonical phrase is the load-bearing check.
 *
 * Duck-typed (no `instanceof` against MetaApiError) so the test
 * suite can hand in plain `Error` instances + bare objects without
 * importing the full Meta client module. Production callers pass
 * a real `MetaApiError` and hit the same code path.
 */
export function isReduceDataError(err: unknown): boolean {
  if (err == null) return false;
  const phrase = /reduce the amount of data/i;

  // Probe the structured fields in priority order: message first
  // (cheap), then userMsg (where Meta hides the actionable phrase
  // most often), then a stringify of the raw error payload as a
  // belt-and-braces last resort. Accept any object with these
  // shape-matching fields — keeps this module dependency-free and
  // makes test fixtures trivial to author.
  if (typeof err === "object") {
    const e = err as {
      message?: unknown;
      userMsg?: unknown;
      rawErrorData?: unknown;
    };
    if (typeof e.message === "string" && phrase.test(e.message)) return true;
    if (typeof e.userMsg === "string" && phrase.test(e.userMsg)) return true;
    if (e.rawErrorData != null) {
      try {
        if (phrase.test(JSON.stringify(e.rawErrorData))) return true;
      } catch {
        // Defensive — JSON.stringify on a circular ref shouldn't
        // happen for Meta payloads but we'd rather drop the check
        // than crash an error path.
      }
    }
  }

  // Plain Error or string — last-resort match against whatever
  // surface is coercible to string.
  if (phrase.test(String(err))) return true;

  // Error instances don't expose own-props on the implicit String
  // coercion above (it returns "Error: <message>" not the props),
  // but be explicit: grab `.message` directly. Belt-and-braces.
  if (err instanceof Error && phrase.test(err.message)) return true;

  return false;
}
