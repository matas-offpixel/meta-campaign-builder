/**
 * lib/meta/call-meter.ts
 *
 * Counts the Graph calls made inside one piece of work and keeps the last
 * `X-App-Usage` reading Meta returned, for a run log such as the
 * bm-page-scan `cron_runs.detail` (`meta_calls`, `app_usage_last`,
 * `app_usage_at_limit`).
 *
 * Scoped with AsyncLocalStorage, not a module counter: on Fluid Compute one
 * instance serves several requests at once, so a global count (like
 * `getMetaCallCounts` in client.ts) would mix in other routes' calls. Only
 * code awaited inside `withMetaCallMeter(meter, fn)` is counted.
 *
 * `client.ts` calls `countMetaCall` once per HTTP attempt, retries and
 * network failures included, so `calls` is what was sent to Meta; then
 * `noteMetaUsage` once the response is parsed. Outside a meter both do nothing.
 *
 * Pure apart from `node:async_hooks`, so `node --test` loads it directly.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { AppUsageSnapshot } from "./app-usage.ts";

/** Meta's three `X-App-Usage` fields, each a percentage of the rolling hourly budget. */
export interface AppUsageReading {
  call_count: number;
  total_time: number;
  total_cputime: number;
}

export interface MetaCallMeter {
  /** Graph HTTP attempts made inside the meter, retries and network failures included. */
  calls: number;
  /** The most recent `X-App-Usage` reading. A response without the header keeps the previous one. */
  lastAppUsage: AppUsageReading | null;
  /**
   * The reading on the most recent rate-limited response (HTTP 429 or a
   * rate-limit code), or null when that response carried no header.
   */
  lastRateLimitedAppUsage: AppUsageReading | null;
  /** Rate-limited responses seen, retries included. */
  rateLimitedResponses: number;
}

const storage = new AsyncLocalStorage<MetaCallMeter>();

export function createMetaCallMeter(): MetaCallMeter {
  return { calls: 0, lastAppUsage: null, lastRateLimitedAppUsage: null, rateLimitedResponses: 0 };
}

/** Runs `fn` with `meter` counting every Graph call it makes. */
export function withMetaCallMeter<T>(meter: MetaCallMeter, fn: () => Promise<T>): Promise<T> {
  return storage.run(meter, fn);
}

/** The meter for the current async context, if any. */
export function currentMetaCallMeter(): MetaCallMeter | undefined {
  return storage.getStore();
}

/** Meta's field names, from the parsed snapshot. Null in, null out. */
export function toAppUsageReading(snapshot: AppUsageSnapshot | null | undefined): AppUsageReading | null {
  if (!snapshot) return null;
  return {
    call_count: snapshot.callCountPercent,
    total_time: snapshot.totalTimePercent,
    total_cputime: snapshot.totalCpuTimePercent,
  };
}

/** Called by client.ts once per Graph HTTP attempt, before the body is read. Never throws. */
export function countMetaCall(): void {
  const meter = storage.getStore();
  if (meter) meter.calls += 1;
}

/**
 * Called by client.ts once a response is parsed. `appUsage` is the parsed
 * header (null when absent or malformed); `rateLimited` is true for HTTP 429 or
 * a rate-limit error code. Never throws.
 */
export function noteMetaUsage(info: { appUsage: AppUsageSnapshot | null; rateLimited: boolean }): void {
  const meter = storage.getStore();
  if (!meter) return;
  const reading = toAppUsageReading(info.appUsage);
  if (reading) meter.lastAppUsage = reading;
  if (info.rateLimited) {
    meter.rateLimitedResponses += 1;
    meter.lastRateLimitedAppUsage = reading;
  }
}
