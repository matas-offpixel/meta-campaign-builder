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

// ─── X-Business-Use-Case-Usage (per-ad-account BUC) ──────────────────────────
//
// Meta stamps this on Graph responses (success AND error) independently of
// X-App-Usage. The DOD/Folamour launch hit ads_management at 100% on
// act_606252931141334 while the App Dashboard still showed 45% app-limit
// used — because nothing here read this header. Shape:
//   {
//     "act_123": [
//       {
//         "type": "ads_management",
//         "call_count": 100,
//         "total_cputime": 72,
//         "total_time": 55,
//         "estimated_time_to_regain_access": 47
//       }
//     ]
//   }
// Percent fields are 0–100 of the rolling BUC budget. ETA is minutes.

/** Warn on Review before a long launch when the target account is already this hot. */
export const BUC_PRELAUNCH_WARN_PERCENT = 80;

export interface BusinessUseCaseBucket {
  /** Normalised `act_<id>`. */
  adAccountId: string;
  /** e.g. ads_management, ads_insights */
  type: string;
  callCountPercent: number;
  totalTimePercent: number;
  totalCpuTimePercent: number;
  maxPercent: number;
  /**
   * Minutes Meta says until access returns. Null when the field is
   * missing — never invent a number. 0 means "no wait reported".
   */
  estimatedTimeToRegainAccessMinutes: number | null;
}

export interface BusinessUseCaseSnapshot {
  buckets: BusinessUseCaseBucket[];
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeActId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function parseBucEntry(
  accountKey: string,
  raw: Record<string, unknown>,
): BusinessUseCaseBucket | null {
  const type = typeof raw.type === "string" && raw.type.trim() ? raw.type.trim() : "";
  if (!type) return null;
  const callCountPercent = percentOr0(raw.call_count);
  const totalTimePercent = percentOr0(raw.total_time);
  const totalCpuTimePercent = percentOr0(raw.total_cputime);
  const etaRaw = asFiniteNumber(raw.estimated_time_to_regain_access);
  return {
    adAccountId: normalizeActId(accountKey),
    type,
    callCountPercent,
    totalTimePercent,
    totalCpuTimePercent,
    maxPercent: maxAppUsagePercent(callCountPercent, totalTimePercent, totalCpuTimePercent),
    estimatedTimeToRegainAccessMinutes: etaRaw === null ? null : Math.max(0, Math.round(etaRaw)),
  };
}

/**
 * Parses the raw `X-Business-Use-Case-Usage` header. Returns null if
 * missing/malformed/empty — never guesses buckets.
 */
export function parseBusinessUseCaseUsageHeader(
  value: string | null | undefined,
): BusinessUseCaseSnapshot | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const buckets: BusinessUseCaseBucket[] = [];
  for (const [accountKey, entries] of Object.entries(parsed as Record<string, unknown>)) {
    if (!accountKey.trim() || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const bucket = parseBucEntry(accountKey, entry as Record<string, unknown>);
      if (bucket) buckets.push(bucket);
    }
  }
  if (buckets.length === 0) return null;
  return { buckets };
}

/** Hottest ads_management bucket, optionally pinned to one ad account. */
export function pickAdsManagementBucket(
  snapshot: BusinessUseCaseSnapshot | null | undefined,
  adAccountId?: string | null,
): BusinessUseCaseBucket | null {
  if (!snapshot?.buckets.length) return null;
  const wanted = adAccountId ? normalizeActId(adAccountId) : null;
  const ads = snapshot.buckets.filter((b) => b.type === "ads_management");
  const pool = wanted ? ads.filter((b) => b.adAccountId === wanted) : ads;
  const from = pool.length > 0 ? pool : wanted ? [] : snapshot.buckets;
  if (from.length === 0) return null;
  return from.reduce((hottest, b) => (b.maxPercent > hottest.maxPercent ? b : hottest));
}

export function isBucPrelaunchWarning(maxPercent: number): boolean {
  return maxPercent >= BUC_PRELAUNCH_WARN_PERCENT;
}

/**
 * Operator-facing copy. Uses Meta's ETA when present; never invents
 * "a few minutes" over a number Meta already gave us.
 */
export function formatBusinessUseCaseLimitMessage(
  bucket: BusinessUseCaseBucket,
  accountLabel?: string | null,
): string {
  const label = (accountLabel?.trim() || bucket.adAccountId).trim();
  const pct = Math.round(bucket.maxPercent);
  const head = `${label} ${bucket.type} at ${pct}%`;
  const eta = bucket.estimatedTimeToRegainAccessMinutes;
  if (eta != null && eta > 0) {
    return `${head} — access returns in ~${eta} min`;
  }
  return `${head} — Meta rate limit; retry after the window resets`;
}

export function resumeAtIsoFromEtaMinutes(
  etaMinutes: number | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (etaMinutes == null || etaMinutes <= 0) return null;
  return new Date(nowMs + etaMinutes * 60_000).toISOString();
}
