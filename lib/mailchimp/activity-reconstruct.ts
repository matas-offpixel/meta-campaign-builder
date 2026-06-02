/**
 * Pure helper: reconstruct per-day cumulative subscriber totals from
 * Mailchimp per-day DELTA activity rows + resolve the effective audience ID.
 *
 * This module is intentionally free of `server-only`, `@/` path aliases,
 * and Supabase imports so it can be unit-tested directly with Node's
 * native test runner without a bundler.
 */

export interface ActivityDeltaRow {
  day: string;          // YYYY-MM-DD
  subs: number;
  unsubs: number;
  other_adds?: number;
  other_removes?: number;
}

export interface DailyCumulative {
  day: string;          // YYYY-MM-DD
  cumulative: number;   // end-of-day active subscriber count
}

export interface AudienceIdResolvable {
  mailchimp_audience_id: string | null;
  client: { mailchimp_audience_id: string | null } | { mailchimp_audience_id: string | null }[] | null;
}

/** Resolves the effective mailchimp_audience_id: event override → client default. */
export function resolveMailchimpAudienceId(event: AudienceIdResolvable): string | null {
  if (event.mailchimp_audience_id) return event.mailchimp_audience_id;
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  return client?.mailchimp_audience_id ?? null;
}

/**
 * Given an array of per-day DELTA activity rows and the current live total,
 * returns an array of per-day CUMULATIVE subscriber counts sorted
 * chronologically (oldest first).
 *
 * `currentActiveTotal` should be `member_count - unsubscribe_count - cleaned_count`
 * from the Mailchimp audience stats API — i.e. the count of active subscribers
 * right now.
 */
export function reconstructDailyCumulatives(
  activityRows: ActivityDeltaRow[],
  currentActiveTotal: number,
): DailyCumulative[] {
  if (activityRows.length === 0) return [];

  // Sort newest-first so we can walk backwards from the known current total.
  const sorted = [...activityRows].sort((a, b) => b.day.localeCompare(a.day));

  const results: DailyCumulative[] = [];
  let runningTotal = currentActiveTotal;

  for (const row of sorted) {
    const netChange =
      row.subs -
      row.unsubs +
      (row.other_adds ?? 0) -
      (row.other_removes ?? 0);

    // End-of-day count for this day = current running total.
    results.push({ day: row.day, cumulative: Math.max(0, runningTotal) });

    // Move one day further back in time.
    runningTotal = runningTotal - netChange;
  }

  // Return chronological order (oldest first).
  results.reverse();
  return results;
}
