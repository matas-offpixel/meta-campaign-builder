/**
 * lib/share/force-refresh-rate-limit.ts
 *
 * In-process LRU for rate-limiting `?force=1` / `?refresh=1` on the
 * public share URL. The force flag bypasses the Supabase snapshot
 * cache (see `app/share/report/[token]/page.tsx`) and triggers a
 * live fetch against Meta + Eventbrite, so anyone with a share link
 * can DDOS the upstream APIs by looping the URL in a shell. PR 4/4
 * of the Apr 2026 bundle adds a per-(token, IP) rate limit: one
 * forced refresh per 60s. Exceeding requests downgrade silently to
 * a cache read — the UI can't distinguish "fresh" from "served from
 * snapshot" anyway and we'd rather serve a slightly stale page than
 * surface a 429 to the end client.
 *
 * The module is in-memory and per-process, which is deliberate:
 *
 *   - Vercel serverless instances share nothing, so one attacker
 *     can still trip multiple warmed workers. That's fine — the
 *     total concurrency of workers times this budget is still
 *     bounded and far below what the Meta API allows.
 *   - No Redis dependency. If rate-limit traffic ever shows up in
 *     Vercel logs as a genuine problem we'll revisit with Upstash.
 *
 * The LRU caps at 500 keys (token + IP pairs). That's 500 unique
 * abusive URLs tracked simultaneously, which is two orders of
 * magnitude more than the client portal has. Eviction is a simple
 * O(1) FIFO — no need for "proper" LRU semantics here, the oldest
 * entries are the least interesting.
 */

interface Entry {
  lastForcedAtMs: number;
}

const MAX_ENTRIES = 500;
const WINDOW_MS = 60_000;

/**
 * Ring-buffer-style LRU. `Map` preserves insertion order, so iter-
 * first-delete gives us FIFO eviction for free. We re-insert on
 * every read to push active keys to the tail so they survive
 * eviction while dormant ones are collected first.
 */
const store = new Map<string, Entry>();

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until another force-refresh would be allowed. */
  retryAfterMs: number;
}

/**
 * Check-and-consume: if the key hasn't been seen in the last 60s,
 * record the call and return `allowed: true`. Otherwise return the
 * remaining cooldown without touching the entry — the caller is
 * expected to fall back to the cached path.
 *
 * `nowMs` is injected so tests can be deterministic. Prod callers
 * omit it to use wallclock time.
 */
export function checkForceRefreshRateLimit(
  key: string,
  nowMs: number = Date.now(),
): RateLimitDecision {
  const existing = store.get(key);
  if (!existing) {
    insert(key, nowMs);
    return { allowed: true, retryAfterMs: 0 };
  }
  const elapsed = nowMs - existing.lastForcedAtMs;
  if (elapsed >= WINDOW_MS) {
    // Update in-place (no delete) so Map's insertion-order is
    // re-established by the touch-rewrite pattern below.
    store.delete(key);
    insert(key, nowMs);
    return { allowed: true, retryAfterMs: 0 };
  }
  return {
    allowed: false,
    retryAfterMs: WINDOW_MS - elapsed,
  };
}

function insert(key: string, nowMs: number): void {
  store.set(key, { lastForcedAtMs: nowMs });
  if (store.size > MAX_ENTRIES) {
    // FIFO eviction — pull the first key the Map holds and drop it.
    const iter = store.keys().next();
    if (!iter.done) store.delete(iter.value);
  }
}

/**
 * Derive a rate-limit key from the request + token. The IP is best-
 * effort (Vercel's `x-forwarded-for` chain, fall back to "anon") —
 * spoofing is possible but the point isn't hard security, it's
 * protecting upstream APIs from looped URLs. A token with no
 * caller-IP signal still gets a key (the "anon" suffix groups
 * every such caller together, which is the desired behaviour
 * for the DDOS case).
 */
export function buildRateLimitKey(
  token: string,
  xForwardedFor: string | null | undefined,
): string {
  const ip = (xForwardedFor ?? "").split(",")[0]?.trim() || "anon";
  return `${token}:${ip}`;
}

/**
 * Test-only helper. Resets the in-memory store so unit tests can
 * assert fresh-slate behaviour. Production code must not call this.
 */
export function _resetForceRefreshRateLimitForTests(): void {
  store.clear();
}
