/**
 * lib/retargeting/limits.ts — time limits for the connector's retargeting read
 * (plan_retargeting, create_show_campaigns). Matas, 27 Nov: plan_retargeting
 * timed out from the connector on prod; apply #1405's pattern (audience_sources):
 * every outside read ≤ 10 s, a budget per show, about 60 s overall, independent
 * reads side by side, and a "couldn't be read in time" line instead of a hang.
 *
 * The 08:00 read passes no limits and runs as before.
 *
 * Pure. Relative imports only (node:test).
 */
import type { RefreshGraph } from "../onsale-refresh/purchase-read.ts";

export type ReadLimits = {
  /** Each Graph request and each CIRQLIN read. */
  requestMs: number;
  /** The reads before the shows: the purchase read, the Pages with a role, every show's links. */
  frontMs: number;
  /** Each show's own reads. */
  showMs: number;
  /** The whole read, from its start. */
  totalMs: number;
  /** Shows read at once (Meta's rate limits: a few, not all 17). */
  concurrency: number;
};

export const CONNECTOR_LIMITS: ReadLimits = { requestMs: 10_000, frontMs: 25_000, showMs: 20_000, totalMs: 60_000, concurrency: 4 };

export class TimedOut extends Error {
  constructor(what: string) {
    super(`${what} timed out`);
    this.name = "TimedOut";
  }
}

/** A promise that rejects with TimedOut when `signal` aborts (or at once if it has). */
function aborted(signal: AbortSignal, what: string): { promise: Promise<never>; done: () => void } {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    if (signal.aborted) return reject(new TimedOut(what));
    onAbort = () => reject(new TimedOut(what));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(() => {});
  return { promise, done: () => onAbort && signal.removeEventListener("abort", onAbort) };
}

/**
 * `run` within `ms` (and within `outer`, when given). The run gets the joined
 * signal, so a read that takes one stops for real; one that doesn't is no
 * longer waited for. Rejects with TimedOut.
 */
export async function within<T>(what: string, ms: number, run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  // A plain timer, not AbortSignal.timeout: that one doesn't hold the event loop open, so a read that never settles
  // could end the process before its limit fires. Cleared once the read settles.
  const own = new AbortController();
  const timer = setTimeout(() => own.abort(), ms);
  const signal = outer ? AbortSignal.any([outer, own.signal]) : own.signal;
  // A budget already spent starts nothing.
  if (signal.aborted) {
    clearTimeout(timer);
    throw new TimedOut(what);
  }
  const stop = aborted(signal, what);
  try {
    return await Promise.race([run(signal), stop.promise]);
  } finally {
    clearTimeout(timer);
    stop.done();
  }
}

/**
 * The read's graph inside one budget: each request stops after `requestMs`, and
 * none starts once `signal` has aborted. `onTimeout` hears every request that
 * ran out (the caller says which read it was).
 */
export function boundGraph(graph: RefreshGraph, opts: { signal: AbortSignal; requestMs: number; onTimeout?: () => void }): RefreshGraph {
  const guard = <T,>(what: string, call: () => Promise<T>): Promise<T> =>
    within(what, opts.requestMs, () => call(), opts.signal).catch((err) => {
      if (err instanceof TimedOut) opts.onTimeout?.();
      throw err;
    });
  return {
    graphGet: (path, params) => guard(`GET ${path}`, () => graph.graphGet(path, params)),
    multiGet: (path, params) => guard(`GET ${path}`, () => graph.multiGet(path, params)),
  };
}

/**
 * Each item through `worker`, at most `concurrency` at once, each within
 * `itemMs`, none started once `signal` aborts. Answers in the items' order:
 * the value, or `unfinished` with why ("item": its own budget; "total": the
 * whole read's). One slow item never holds up the others.
 */
export async function runPool<I, O>(
  items: readonly I[],
  opts: { concurrency: number; itemMs: number; signal: AbortSignal },
  worker: (item: I, signal: AbortSignal) => Promise<O>,
): Promise<({ ok: true; value: O } | { ok: false; unfinished: "item" | "total"; error?: unknown })[]> {
  const out: ({ ok: true; value: O } | { ok: false; unfinished: "item" | "total"; error?: unknown })[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      if (opts.signal.aborted) {
        out[i] = { ok: false, unfinished: "total" };
        continue;
      }
      try {
        out[i] = { ok: true, value: await within(`item ${i}`, opts.itemMs, (signal) => worker(items[i]!, signal), opts.signal) };
      } catch (error) {
        out[i] = error instanceof TimedOut ? { ok: false, unfinished: opts.signal.aborted ? "total" : "item" } : { ok: false, unfinished: "item", error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, items.length)) }, lane));
  return out;
}

/** A show's reads that can run out (plan_retargeting names each one). */
export const SHOW_UNREAD = ["links", "pixel", "pages", "hosts", "prospecting", "meta"] as const;
export type ShowUnread = (typeof SHOW_UNREAD)[number];
/** The reads before the shows that can run out. */
export type FrontUnread = "purchases";
