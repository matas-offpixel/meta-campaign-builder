/**
 * lib/bm/scan-run.ts
 *
 * The control loop for the daily `/api/cron/bm-page-scan` run: rotation order,
 * the rate-limit circuit breaker, the time budget, and a per-token read cache.
 *
 * Pure and dependency-free on purpose (no `server-only`, no `@/` imports, no
 * `MetaApiError` class import) so `node --test` can exercise it directly —
 * same reason as `chunk.ts` and `business-scoped-user-id.ts`.
 *
 * Why this exists (investigation, 18 Nov 2026): the cron walked all 71 BMs by
 * name, sequentially, and hit Vercel's 800 s ceiling every day since about
 * 29 Jul. About two minutes in, Meta answered "(#4) Application request limit
 * reached"; from then on each BM spent ~20 s on retry-then-fail, so the run
 * died around BM #32–#36 and BMs #37–#71 (The Columbo Group, LWE, …) were
 * never scanned. Three changes stop that:
 *
 *   1. Breaker — the first rate-limit error ends the run. The remaining BMs are
 *      skipped, not errored, and nothing else is sent to Meta.
 *   2. Time budget — no BM is started after `budgetMs` (650 s by default), so
 *      the run always returns, and always writes its `cron_runs` row, before
 *      the 800 s kill.
 *   3. Rotation — BMs go least-recently-scanned first, so the BMs a run never
 *      reached are first in line the next day instead of last again.
 */

/** Stop starting new BMs after this long. 150 s of headroom under maxDuration 800. */
export const BM_SCAN_TIME_BUDGET_MS = 650_000;

/**
 * Meta error codes that mean "this app / user / page is over its request
 * budget". Retrying, or moving on to the next BM with the same token and app,
 * only digs the hole deeper.
 *
 *   4     — Application request limit reached (what the cron hits)
 *   17    — User request limit reached
 *   32    — Page request limit reached
 *   341   — Application limit reached (alternate code on some edges)
 *   613   — Calls within one hour exceeded
 *   80004 — Too many calls to this ad account (business use case)
 *
 * Code 2 ("service temporarily unavailable") is left out: client.ts retries it
 * like a rate limit, but on its own it is a transient error, not a budget.
 */
const RATE_LIMIT_CODES = new Set<number>([4, 17, 32, 341, 613, 80004]);

/**
 * True for a Meta rate-limit error. Duck-typed on `name === "MetaApiError"`
 * (not `instanceof`) so this module never imports `lib/meta/client.ts`.
 *
 * HTTP 429 carries no Meta code; `parseMetaError` in client.ts then falls back
 * to the message `HTTP 429`, which is what is matched here.
 */
export function isMetaRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; subcode?: unknown; message?: unknown };
  if (e.name !== "MetaApiError") return false;
  if (typeof e.code === "number" && RATE_LIMIT_CODES.has(e.code)) return true;
  if (typeof e.subcode === "number" && e.subcode === 80004) return true;
  const message = typeof e.message === "string" ? e.message : "";
  return /^HTTP 429\b/.test(message);
}

/** True for an expired / invalid OAuth token (code or subcode 190). */
export function isMetaTokenExpiredError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; code?: unknown; subcode?: unknown };
  return e.name === "MetaApiError" && (e.code === 190 || e.subcode === 190);
}

/** The fields rotation reads. A `BusinessManager` row satisfies it. */
export interface RotatableBm {
  business_id: string;
  business_name: string | null;
  last_scanned_at: string | null;
}

/**
 * Least-recently-scanned first: never-scanned (null) BMs, then oldest
 * `last_scanned_at`. Ties break on name, then business id, so the order is
 * stable. Returns a new array; the input is not mutated.
 *
 * A BM the breaker or the time budget skipped keeps its old `last_scanned_at`
 * (the scan never stamps it on a rate limit), so it sorts ahead of every BM
 * this run did scan.
 */
export function orderForRotation<T extends RotatableBm>(bms: readonly T[]): T[] {
  const time = (bm: RotatableBm): number => {
    if (!bm.last_scanned_at) return Number.NEGATIVE_INFINITY;
    const t = Date.parse(bm.last_scanned_at);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...bms].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const na = a.business_name ?? "";
    const nb = b.business_name ?? "";
    if (na !== nb) return na < nb ? -1 : 1;
    return a.business_id < b.business_id ? -1 : a.business_id > b.business_id ? 1 : 0;
  });
}

export type BmSkipReason = "rate_limited" | "time_budget";

export interface BmScanLoopOptions<T, R> {
  /** BMs in the order to scan them (see `orderForRotation`). */
  bms: readonly T[];
  /** Scan one BM. Must not throw for ordinary Meta failures; a throw is treated as an error result. */
  scanOne: (bm: T) => Promise<R>;
  /** Whether a result means Meta rate-limited the run. */
  isRateLimited: (result: R) => boolean;
  /** Turns a thrown error into a result, so one bad BM never ends the run. */
  onThrow: (bm: T, err: unknown) => R;
  /** Run start, in ms. */
  startedAtMs: number;
  /** Clock, in ms. Injected for tests. */
  now?: () => number;
  /** Stop starting new BMs once this much time has passed. */
  budgetMs?: number;
}

export interface BmScanLoopResult<T, R> {
  /** Every BM that was started, with its result (the rate-limited one included). */
  scanned: Array<{ bm: T; result: R }>;
  /** BMs never started, and why. */
  skipped: Array<{ bm: T; reason: BmSkipReason }>;
  /** What ended the loop early, or null when every BM was started. */
  stoppedBy: BmSkipReason | null;
  /** The BM whose scan tripped the breaker. */
  rateLimitedAt: T | null;
}

/**
 * Walks `bms` sequentially with the breaker and the time budget.
 *
 * The budget is checked before a BM starts, never during: a BM that has
 * started finishes both of its phases, so its `last_scanned_at` and its asset
 * tables agree.
 */
export async function runBmScanLoop<T, R>(
  opts: BmScanLoopOptions<T, R>,
): Promise<BmScanLoopResult<T, R>> {
  const now = opts.now ?? Date.now;
  const budgetMs = opts.budgetMs ?? BM_SCAN_TIME_BUDGET_MS;
  const scanned: Array<{ bm: T; result: R }> = [];
  const skipped: Array<{ bm: T; reason: BmSkipReason }> = [];
  let stoppedBy: BmSkipReason | null = null;
  let rateLimitedAt: T | null = null;

  for (let i = 0; i < opts.bms.length; i += 1) {
    const bm = opts.bms[i];

    if (stoppedBy === null && now() - opts.startedAtMs >= budgetMs) {
      stoppedBy = "time_budget";
    }
    if (stoppedBy !== null) {
      skipped.push({ bm, reason: stoppedBy });
      continue;
    }

    let result: R;
    try {
      result = await opts.scanOne(bm);
    } catch (err) {
      result = opts.onThrow(bm, err);
    }
    scanned.push({ bm, result });

    if (opts.isRateLimited(result)) {
      stoppedBy = "rate_limited";
      rateLimitedAt = bm;
    }
  }

  return { scanned, skipped, stoppedBy, rateLimitedAt };
}

/**
 * Memoises one load per token value. Every BM row stores its own encrypted
 * copy of the operator's token; when two rows hold the same string, the
 * token-wide reads (`/me/accounts`, `/me?fields=business_users`) happen once.
 * Rows holding different strings each get their own read.
 *
 * A rejected load stays cached only when `isSticky(err)` (a rate limit or an
 * expired token: asking again cannot succeed this run). Any other failure is
 * forgotten, so the next BM with that token tries again.
 */
export function createTokenContextCache<C>(
  load: (token: string) => Promise<C>,
  isSticky: (err: unknown) => boolean,
): { get: (token: string) => Promise<C>; loads: () => number } {
  const cache = new Map<string, Promise<C>>();
  let loads = 0;
  return {
    get(token: string): Promise<C> {
      const hit = cache.get(token);
      if (hit) return hit;
      loads += 1;
      const p = load(token);
      cache.set(token, p);
      p.catch((err) => {
        if (!isSticky(err) && cache.get(token) === p) cache.delete(token);
      });
      return p;
    },
    loads: () => loads,
  };
}
