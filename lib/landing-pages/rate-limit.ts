/**
 * lib/landing-pages/rate-limit.ts
 *
 * Per-IP request budget for the public /l/[clientSlug]/[eventSlug] route.
 * Adapts the in-process LRU pattern from
 * lib/share/force-refresh-rate-limit.ts (that module is share-thread-owned
 * and single-purpose, so this lives in the landing-pages lane instead of
 * generalising it).
 *
 * Budget: a fixed-window counter of 60 requests / 60s per IP — generous for
 * a human clicking around an event page, tight enough to stop a looped curl
 * from turning every request into 4 Postgres lookups. Same deliberate
 * trade-offs as the share limiter:
 *
 *   - In-memory, per-process. Vercel workers share nothing; total exposure
 *     is (warm workers × budget), still bounded and cheap for reads.
 *   - No Redis/Upstash until logs show a real problem.
 *   - IP from x-forwarded-for is spoofable — the point is protecting the DB
 *     from lazy loops, not hard security. The signup form in PR 2+ (a WRITE
 *     path) needs a stronger, shared limiter — see the design doc.
 */

interface WindowEntry {
  windowStartMs: number;
  count: number;
}

const MAX_ENTRIES = 2000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 60;

const store = new Map<string, WindowEntry>();

export interface LandingRateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the window resets. 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Check-and-consume one request from the IP's fixed window.
 * `nowMs` is injected so tests are deterministic.
 */
export function checkLandingPageRateLimit(
  key: string,
  nowMs: number = Date.now(),
): LandingRateLimitDecision {
  const existing = store.get(key);

  if (!existing || nowMs - existing.windowStartMs >= WINDOW_MS) {
    // Delete-then-set keeps Map insertion order fresh so FIFO eviction
    // collects dormant keys first (same trick as the share limiter).
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

/**
 * Derive the limiter key from the forwarded-for chain. Best-effort — every
 * caller with no IP signal shares the "anon" bucket, which is the desired
 * failure mode for the loop-protection case.
 */
export function buildLandingRateLimitKey(
  xForwardedFor: string | null | undefined,
): string {
  const ip = (xForwardedFor ?? "").split(",")[0]?.trim() || "anon";
  return `l:${ip}`;
}

/** Test-only. Production code must not call this. */
export function _resetLandingPageRateLimitForTests(): void {
  store.clear();
}

// ─── Signup write-path limiter (PR 2) ───────────────────────────────────────
//
// Separate store + much tighter budget than the page-view limiter: the
// signup POST triggers captcha verification, hashing, TWO encrypt RPCs and
// an insert, and writes encrypted PII — a real target. Default 5 signups /
// 10 min per (IP, page) pair; a fan legitimately re-submitting after a typo
// stays well inside it. Env-tunable without redeploy of the constants:
//   LANDING_PAGES_SIGNUP_RATE_MAX             (default 5)
//   LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES  (default 10)
// Same in-process trade-offs as above (per-worker, Vercel WAF backstop).

const signupStore = new Map<string, WindowEntry>();
const SIGNUP_MAX_ENTRIES = 5000;
const SIGNUP_DEFAULT_MAX = 5;
const SIGNUP_DEFAULT_WINDOW_MINUTES = 10;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function checkSignupRateLimit(
  key: string,
  nowMs: number = Date.now(),
): LandingRateLimitDecision {
  const maxPerWindow = envInt(
    "LANDING_PAGES_SIGNUP_RATE_MAX",
    SIGNUP_DEFAULT_MAX,
  );
  const windowMs =
    envInt(
      "LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES",
      SIGNUP_DEFAULT_WINDOW_MINUTES,
    ) * 60_000;

  const existing = signupStore.get(key);

  if (!existing || nowMs - existing.windowStartMs >= windowMs) {
    signupStore.delete(key);
    signupStore.set(key, { windowStartMs: nowMs, count: 1 });
    if (signupStore.size > SIGNUP_MAX_ENTRIES) {
      const iter = signupStore.keys().next();
      if (!iter.done) signupStore.delete(iter.value);
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count < maxPerWindow) {
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  return {
    allowed: false,
    retryAfterMs: windowMs - (nowMs - existing.windowStartMs),
  };
}

/** Per-(IP, page) key so one hot event can't starve another. */
export function buildSignupRateLimitKey(
  xForwardedFor: string | null | undefined,
  clientSlug: string,
  eventSlug: string,
): string {
  const ip = (xForwardedFor ?? "").split(",")[0]?.trim() || "anon";
  return `s:${ip}:${clientSlug}/${eventSlug}`;
}

/** Test-only. Production code must not call this. */
export function _resetSignupRateLimitForTests(): void {
  signupStore.clear();
}
