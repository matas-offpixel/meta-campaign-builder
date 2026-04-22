/**
 * lib/db/event-daily-timeline-window.ts
 *
 * Pure windowing math used by `sumTicketsSoldInWindow` (which
 * lives in the `server-only` `event-daily-timeline.ts` because it
 * does the supabase read). Split into its own module so the
 * windowing logic is unit-testable in plain Node without having
 * to stub `server-only` or supabase-js.
 *
 * No imports from `server-only`, supabase, or anything else that
 * pulls in the Next runtime — keep it that way.
 */

/**
 * Sum `tickets_sold` from rollup rows whose date falls inside the
 * supplied inclusive window. `windowDays === null` means "no
 * filter, sum everything" (the lifetime / unranged-custom case).
 *
 * Returns:
 *   - `null` when `rollups` is empty (no rollup rows exist for
 *     the event at all → caller falls back to the legacy
 *     mount-time `events.tickets_sold`).
 *   - `0` when rollups exist but none fall in the window — a
 *     legitimate "no tickets sold in this period" reading.
 *   - `> 0` for the windowed sum.
 */
export function sumTicketsInWindow(
  rollups: ReadonlyArray<{ date: string; tickets_sold: number | null }>,
  windowDays: readonly string[] | null,
): number | null {
  if (rollups.length === 0) return null;

  let total = 0;
  if (windowDays === null) {
    for (const r of rollups) {
      if (r.tickets_sold != null) total += r.tickets_sold;
    }
    return total;
  }

  // Set membership keeps the loop O(rollups + days). The list
  // comes from `resolvePresetToDays` and is already inclusive on
  // both ends.
  const window = new Set(windowDays);
  for (const r of rollups) {
    if (window.has(r.date) && r.tickets_sold != null) {
      total += r.tickets_sold;
    }
  }
  return total;
}
