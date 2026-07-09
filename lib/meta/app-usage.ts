/**
 * lib/meta/app-usage.ts
 *
 * Pure parsing for Meta's `X-App-Usage` response header. No dependency on
 * client.ts — safe to unit-test directly and to import from a Server
 * Component (e.g. the /business-managers quota indicator) without pulling
 * in the whole Meta client surface.
 *
 * Meta attaches this header to (most) Graph API responses as an early
 * warning before the hard #4 / #17 / #80004 rate-limit errors actually
 * fire, e.g.:
 *   X-App-Usage: {"call_count":28,"total_time":25,"total_cputime":22}
 * Despite the field name, each field is a PERCENTAGE (0–100) of the
 * rolling ~1 hour app-level budget already used — NOT a raw request count.
 * The badge / retry heuristics must use MAX(call_count, total_time,
 * total_cputime), never their sum (100+100+72 = 272% is wrong).
 */

export interface AppUsageSnapshot {
  callCountPercent: number;
  totalTimePercent: number;
  totalCpuTimePercent: number;
  /** Highest of the three — the dimension Meta will actually throttle on first. */
  maxPercent: number;
}

/** Coerce a Meta usage field to a finite 0–100 percentage. */
function percentOr0(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    return clampPercent(v);
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return clampPercent(n);
  }
  return 0;
}

function clampPercent(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Meta throttles on whichever dimension is hottest — never sum the three.
 * Exported so UI + retry heuristics share one canonical MAX() implementation.
 */
export function maxAppUsagePercent(
  callCountPercent: number,
  totalTimePercent: number,
  totalCpuTimePercent: number,
): number {
  return Math.max(callCountPercent, totalTimePercent, totalCpuTimePercent);
}

/** Badge / display helper — always recomputes MAX from the three components. */
export function appUsageBadgePercent(snapshot: AppUsageSnapshot): number {
  return maxAppUsagePercent(
    snapshot.callCountPercent,
    snapshot.totalTimePercent,
    snapshot.totalCpuTimePercent,
  );
}

/** Parses the raw `X-App-Usage` header JSON string. Returns null if missing/malformed. */
export function parseAppUsageHeader(
  value: string | null | undefined,
): AppUsageSnapshot | null {
  if (!value) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
  const callCountPercent = percentOr0(parsed.call_count);
  const totalTimePercent = percentOr0(parsed.total_time);
  const totalCpuTimePercent = percentOr0(parsed.total_cputime);
  const maxPercent = maxAppUsagePercent(
    callCountPercent,
    totalTimePercent,
    totalCpuTimePercent,
  );
  return {
    callCountPercent,
    totalTimePercent,
    totalCpuTimePercent,
    maxPercent,
  };
}

/** Generic fallback used when no usage snapshot is available at all — matches the
 *  existing default in lib/audiences/meta-rate-limit.ts's `coverGenericRateLimitBody`. */
export const DEFAULT_RATE_LIMIT_RETRY_MINUTES = 45;

/**
 * Heuristic retry-after estimate from a usage snapshot. Meta's usage header
 * reports a % of a rolling window, not an exact reset timestamp, so this is
 * deliberately a rough, clearly-labelled ESTIMATE:
 *   - At/above 100%: the window is fully consumed — assume close to the
 *     full ~60 min before it meaningfully decays.
 *   - Otherwise: scale down proportionally, floored at 5 minutes so the UI
 *     never tells someone to "retry in 0 minutes" immediately after a hit.
 */
export function estimateRetryAfterMinutes(snapshot: AppUsageSnapshot | null): number {
  if (!snapshot) return DEFAULT_RATE_LIMIT_RETRY_MINUTES;
  const max = appUsageBadgePercent(snapshot);
  if (max >= 100) return 60;
  return Math.max(Math.round((max / 100) * 60), 5);
}
