/**
 * lib/meta/retry.ts
 *
 * Tiny dependency-free retry helper for the campaign-boundary fan-out
 * in `lib/reporting/active-creatives-fetch.ts`. Lives outside
 * `lib/meta/client.ts` for the same reason `lib/meta/error-classify.ts`
 * does — the unit tests run via Node `--experimental-strip-types`,
 * which can't parse `client.ts`'s parameter-property classes, so any
 * helper that needs test coverage has to stay importable on its own.
 *
 * Pairs with `isTransientRateLimit` (the other half of the cascade
 * fix) — the classifier decides which errors are worth retrying, this
 * helper actually does the retry. Keeping them in separate one-job
 * modules makes the test fixtures trivial and lets either be reused
 * by other callers later (e.g. the spend-by-day fetcher would benefit
 * from the same posture).
 */

/**
 * Run `fn`. If it throws an error matching `isRetryable`, wait
 * `delayMs` then run it once more. Any non-retryable throw rebubbles
 * immediately; a second retryable throw also rebubbles (single-shot
 * retry — sustained rate-limit means something bigger is wrong and
 * the upstream catch should record the failure).
 *
 * Symmetric error treatment: the second-attempt throw is what callers
 * see, so a transient error followed by an auth error surfaces the
 * auth error — exactly what the campaign-boundary `isMetaAuthError`
 * sentinel needs to flip the auth-expired flag.
 *
 * Pure (no globals, no env), test-friendly, and explicitly typed so
 * production callers wrap typed fetchers without `any`-casting.
 */
export async function retryOnceOnTransient<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  delayMs: number,
  /**
   * Optional hook for the retry log line. Production callers pass a
   * one-line `console.warn` so the retry leaves a paper trail; tests
   * pass nothing (the helper just sleeps + retries silently).
   */
  onRetry?: (err: unknown, delayMs: number) => void,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err)) throw err;
    onRetry?.(err, delayMs);
    // Greppable line so Vercel filtering on `[meta-retry]` shows
    // every retry decision the helper makes. Code is duck-typed off
    // the same { code } shape the classifier inspects — non-Meta
    // throws log "n/a", which still tells us the helper triggered.
    const firedCode = (err as { code?: number }).code ?? "n/a";
    console.info(
      `[meta-retry] retry_fired meta_code=${firedCode} delay_ms=${delayMs}`,
    );
    await sleep(delayMs);
    try {
      return await fn();
    } catch (err2) {
      const exhaustedCode = (err2 as { code?: number }).code ?? "n/a";
      console.info(
        `[meta-retry] retry_exhausted meta_code=${exhaustedCode} delay_ms=${delayMs}`,
      );
      throw err2;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
