import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/db/event-code-primary-sibling.ts
 *
 * Resolves the "engagement-owning fixture" for an `event_code`: the
 * one sibling event_id (out of all events that share the same code)
 * which is allowed to write event-code-level Meta engagement +
 * attribution columns into `event_daily_rollups`. Every other sibling
 * writes NULL on those columns so a SUM across siblings does not
 * triple-count the same Meta number (issue #471 PR-A.5).
 *
 * Why this exists
 * ---------------
 *   Meta's /insights filter matches campaigns by substring on
 *   `[<event_code>]` — every fixture under the same code sees the
 *   IDENTICAL campaign-wide numbers. Pre-PR-A.5 the rollup writer
 *   fanned that out into 3 (Edinburgh) / 4 (Brighton/Manchester/SWG3)
 *   identical rows, breaking any reader that SUM-aggregated across
 *   siblings (Funnel Pacing's 316,689 vs Meta's 105,563 — exactly ×3
 *   on a 3-fixture venue).
 *
 *   The fix is *write-time*: one sibling per code owns the engagement
 *   columns, the rest leave them NULL. Spend stays per-fixture (the
 *   allocator does its job). Tickets stay per-fixture (sourced from
 *   `tier_channel_sales`). See issue #471 audit for the full design.
 *
 * Owner selection rule
 * --------------------
 *   `min(events.id)` per `event_code`. Stateless, deterministic,
 *   survives fixture add/remove (a newly-inserted UUID is statistically
 *   unlikely to be lower than the existing minimum, so the owner stays
 *   stable for the lifetime of the venue).
 *
 *   Alternatives considered:
 *     - `min(events.created_at)` — also fine, but introduces a
 *       timestamp dependency where `id` already exists as the natural
 *       key. One fewer column to read.
 *     - A dedicated `engagement_owner_event_id` column on the events
 *       table — more invasive, requires migration + maintenance when
 *       fixtures are added/deleted.
 *
 * Caching
 * -------
 *   None at this layer. The runner calls this helper once per
 *   `runRollupSyncForEvent` invocation (one DB round-trip per
 *   per-event sync). Production-scale: ~110 active event_ids * 3
 *   cron ticks/day = ~330 queries/day. Each is a tiny indexed
 *   single-key SELECT. Profile and add a per-process LRU only if it
 *   ever shows up in flamegraphs.
 */

/**
 * Returns true when `eventId` is the engagement-owning sibling for
 * `eventCode` (i.e. the lexicographically smallest `events.id` among
 * all events sharing that code).
 *
 * Returns true for solo events (no siblings) — the owner check is a
 * no-op there.
 *
 * Returns true if the lookup fails (network / DB error). Failing OPEN
 * preserves the pre-PR-A.5 behaviour (write engagement values) so a
 * transient DB blip doesn't blank out rollup data for non-owner
 * fixtures across a whole sync window. The eventual reconciliation
 * comes from the next successful sync — readers that aggregate
 * across siblings still have the venue-rollup dedup helper as a
 * read-time backstop.
 */
export async function isEngagementOwnerForCode(
  supabase: SupabaseClient,
  args: { eventCode: string; eventId: string },
): Promise<boolean> {
  const { eventCode, eventId } = args;
  if (!eventCode.trim()) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("events")
      .select("id")
      .eq("event_code", eventCode)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn(
        `[event-code-primary-sibling] lookup error event_code=${eventCode}: ${error.message} — failing OPEN (treating event as owner)`,
      );
      return true;
    }
    const ownerId = (data?.id as string | undefined) ?? null;
    if (!ownerId) return true;
    return ownerId === eventId;
  } catch (err) {
    console.warn(
      `[event-code-primary-sibling] lookup threw event_code=${eventCode}: ${
        err instanceof Error ? err.message : "Unknown error"
      } — failing OPEN`,
    );
    return true;
  }
}
