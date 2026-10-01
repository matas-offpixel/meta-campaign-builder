/**
 * Per-IP budget for GET /api/community-aliases/:slug.
 *
 * In-process, same trade-off as the landing-page limiter: Vercel isolates
 * do not share the counter, so the ceiling is warm isolates times the
 * budget. Enough to stop a looped client from turning every interstitial
 * render into a Postgres read. Not a security boundary.
 */

interface WindowEntry {
  windowStartMs: number;
  count: number;
}

const MAX_ENTRIES = 2000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const store = new Map<string, WindowEntry>();

export interface CommunityAliasRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export function communityAliasRateKey(forwardedFor: string | null): string {
  const ip = forwardedFor?.split(",")[0]?.trim() || "anon";
  return `community-alias:${ip}`;
}

export function checkCommunityAliasRateLimit(
  key: string,
  nowMs: number = Date.now(),
): CommunityAliasRateLimitDecision {
  const existing = store.get(key);

  if (!existing || nowMs - existing.windowStartMs >= WINDOW_MS) {
    store.delete(key);
    store.set(key, { windowStartMs: nowMs, count: 1 });
    evictIfNeeded();
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count < MAX_REQUESTS_PER_WINDOW) {
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    allowed: false,
    retryAfterMs: WINDOW_MS - (nowMs - existing.windowStartMs),
  };
}

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const iter = store.keys().next();
  if (!iter.done) store.delete(iter.value);
}

/** Test-only. The store is module-scoped. */
export function resetCommunityAliasRateLimitForTests(): void {
  store.clear();
}
