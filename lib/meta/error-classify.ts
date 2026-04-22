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
 * for" response. Surfaced as a generic code 1 / code 2 error with
 * a specific message — Meta is annoyingly inconsistent about
 * whether it sets the code field for this one (sometimes it
 * bubbles as a plain network error from a downstream timeout).
 * The string match on the canonical phrase is the load-bearing
 * check; the code prefilter just keeps the regex off every error
 * path in the happy case.
 *
 * Used by `lib/insights/meta.ts` to switch from a single-shot
 * `date_preset=last_7d` insights call to a per-day chunked fan-out
 * — retrying the same impossible query 5× via the GET retry ladder
 * doesn't fix the underlying compute-budget rejection.
 *
 * Duck-typed (no `instanceof` against MetaApiError) so the test
 * suite can hand in plain `Error` instances + bare objects without
 * importing the full Meta client module. Production callers pass
 * a real `MetaApiError` and hit the same code path.
 */
export function isReduceDataError(err: unknown): boolean {
  if (err == null) return false;
  const phrase = /reduce the amount of data/i;
  // Probe the structured fields in priority order. We accept any
  // object with `message` / `userMsg` / `rawErrorData` rather than
  // narrowing to MetaApiError: keeps this module dependency-free
  // and makes the test fixtures trivial to author.
  if (typeof err === "object") {
    const e = err as {
      code?: unknown;
      message?: unknown;
      userMsg?: unknown;
      rawErrorData?: unknown;
    };
    const codeOk =
      e.code === 1 || e.code === 2 || e.code == null;
    if (codeOk && typeof e.message === "string" && phrase.test(e.message)) {
      return true;
    }
    if (typeof e.userMsg === "string" && phrase.test(e.userMsg)) {
      return true;
    }
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
  // Fallback for non-MetaApiError shapes (e.g. the helper threw a
  // plain Error wrapping the upstream message).
  return phrase.test(String(err));
}
