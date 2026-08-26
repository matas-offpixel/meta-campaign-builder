/**
 * In-launch retry for Meta ad / ad-set creates that fail transiently.
 *
 * Triggers (any one is enough):
 *   - `is_transient: true` on the Graph error (or rawErrorData)
 *   - Meta code 2 (service temporarily unavailable)
 *   - message containing "please retry your request later"
 *
 * Non-transient errors are never retried. Up to 3 retries with backoff
 * 2s / 8s / 20s, then the error is thrown so the idempotency ledger can
 * record failure. Each retry is logged at console.error with the Meta
 * trace id.
 *
 * Lives outside client.ts so Node strip-only tests can import it.
 */

export const META_TRANSIENT_RETRY_BACKOFF_MS = [2_000, 8_000, 20_000] as const;

/** Number of retries after the first attempt (not including the first). */
export const META_TRANSIENT_RETRY_MAX = META_TRANSIENT_RETRY_BACKOFF_MS.length;

const RETRY_LATER = /please retry your request later/i;

export function isRetryableMetaTransient(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    code?: unknown;
    message?: unknown;
    userMsg?: unknown;
    is_transient?: unknown;
    rawErrorData?: {
      is_transient?: unknown;
      message?: unknown;
      error_user_msg?: unknown;
    };
  };

  if (e.is_transient === true || e.rawErrorData?.is_transient === true) return true;
  if (e.code === 2) return true;

  const haystack = [
    e.message,
    e.userMsg,
    e.rawErrorData?.message,
    e.rawErrorData?.error_user_msg,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return RETRY_LATER.test(haystack);
}

export function metaTransientTraceId(err: unknown): string | null {
  if (err == null || typeof err !== "object") return null;
  const e = err as {
    fbtraceId?: unknown;
    rawErrorData?: { fbtrace_id?: unknown };
  };
  if (typeof e.fbtraceId === "string" && e.fbtraceId.trim()) return e.fbtraceId;
  const fromRaw = e.rawErrorData?.fbtrace_id;
  if (typeof fromRaw === "string" && fromRaw.trim()) return fromRaw;
  return null;
}

export interface TransientRetryLog {
  opKind: string;
  label?: string;
}

/**
 * Run `run` once, then retry up to 3 times on transient Meta errors.
 * Inject `sleep` in tests so backoff is not actually waited.
 */
export async function withMetaTransientRetry<T>(
  run: () => Promise<T>,
  log: TransientRetryLog,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= META_TRANSIENT_RETRY_MAX; attempt += 1) {
    try {
      return await run();
    } catch (err) {
      last = err;
      const retriesLeft = META_TRANSIENT_RETRY_MAX - attempt;
      if (!isRetryableMetaTransient(err) || retriesLeft === 0) {
        throw err;
      }
      const delay = META_TRANSIENT_RETRY_BACKOFF_MS[attempt];
      const trace = metaTransientTraceId(err) ?? "none";
      console.error(
        `[meta-launch-transient-retry] ${log.opKind}` +
          `${log.label ? ` ${log.label}` : ""}` +
          ` attempt ${attempt + 1} failed (transient)` +
          ` fbtrace_id=${trace}` +
          ` retrying in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw last;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function failedAdLabelsFromSummary(summary: {
  creativesCreated?: Array<{
    name: string;
    adsFailed?: Array<{ adSetName: string }>;
  }>;
  adSetsFailed?: Array<{ name: string }>;
}): string[] {
  const ads = (summary.creativesCreated ?? []).flatMap((creative) =>
    (creative.adsFailed ?? []).map((ad) => `${creative.name} → ${ad.adSetName}`),
  );
  const adSets = (summary.adSetsFailed ?? []).map((adSet) => `Ad set: ${adSet.name}`);
  return [...adSets, ...ads];
}

export const RETRY_FAILED_ADS_CONFIRM =
  "If you have already created any of these ads manually in Ads Manager (as happened with DOD), retrying would duplicate them.";
