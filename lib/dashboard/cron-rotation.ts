/**
 * lib/dashboard/cron-rotation.ts
 *
 * Ordering primitive for time-budgeted cron loops that can no longer
 * process their whole eligible set in one invocation.
 *
 * Why this exists: `/api/cron/refresh-active-creatives` walks every
 * eligible event sequentially, ~4 Meta round trips each. Once the
 * eligible set grew past ~130 events, a run could not finish inside
 * `maxDuration` and every invocation was killed with a 504 — no
 * response body, no health signal, and no staleness alarm (the
 * snapshot table still looked fresh thanks to manual dashboard
 * refreshes). The cron was dead for three weeks before anyone noticed.
 *
 * Capping the run on wall-clock alone would only move the cliff: the
 * loop consumed events in PostgREST's return order, which is stable
 * across runs, so the head of the list would be refreshed three times
 * a day forever while the tail was never refreshed at all. Sorting
 * least-recently-refreshed first turns the cap into a rotation —
 * each run drains the stalest slice and the next run picks up where
 * it left off.
 *
 * Kept separate from `cron-eligibility.ts` (which decides WHICH
 * events qualify) because this decides ORDER among already-eligible
 * events — and separate from the route itself so it stays importable
 * under Node's `--experimental-strip-types` test runner.
 */

/**
 * Order events least-recently-refreshed first.
 *
 * Events with no recorded refresh sort first (treated as epoch 0):
 * a newly added event should be picked up on the next run rather than
 * queued behind everything already being maintained.
 *
 * Ties break on `id` so the order is deterministic for a given input
 * rather than dependent on the sort implementation — two runs seeing
 * identical state must produce identical order, or the rotation
 * guarantee is only probabilistic.
 *
 * Pure and non-mutating: the input array is copied before sorting.
 */
export function orderByStalestFirst<T extends { id: string }>(
  events: readonly T[],
  lastRefreshedAtByEventId: ReadonlyMap<string, number>,
): T[] {
  return [...events].sort((a, b) => {
    const aAt = lastRefreshedAtByEventId.get(a.id) ?? 0;
    const bAt = lastRefreshedAtByEventId.get(b.id) ?? 0;
    if (aAt !== bAt) return aAt - bAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
