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

export interface ReconstructDailyOptions {
  /** YYYY-MM-DD — drop activity before campaign launch. */
  eventStartAt?: string | null;
  /** Max calendar gap between consecutive API activity rows (default 2). */
  maxActivityGapDays?: number;
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

function daysBetweenUtc(earlierYmd: string, laterYmd: string): number {
  const earlier = Date.parse(`${earlierYmd}T00:00:00Z`);
  const later = Date.parse(`${laterYmd}T00:00:00Z`);
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return Number.POSITIVE_INFINITY;
  return Math.round((later - earlier) / 86_400_000);
}

/**
 * Given per-day DELTA activity rows and the current live total, returns
 * per-day CUMULATIVE subscriber counts sorted chronologically (oldest first).
 *
 * Only emits days where the backward reconstruction is trustworthy:
 *   - on/after `eventStartAt` when provided
 *   - within a contiguous activity window (no gap > maxActivityGapDays)
 *   - before the running total goes negative (incomplete history signal)
 *   - cumulative > 0 (never write fabricated zero rows)
 *
 * `currentActiveTotal` should be `member_count - unsubscribe_count - cleaned_count`
 * from the Mailchimp audience stats API.
 */
export function reconstructDailyCumulatives(
  activityRows: ActivityDeltaRow[],
  currentActiveTotal: number,
  options?: ReconstructDailyOptions,
): DailyCumulative[] {
  if (activityRows.length === 0) return [];

  const maxGap = options?.maxActivityGapDays ?? 2;
  const eventStartAt = options?.eventStartAt?.slice(0, 10) ?? null;

  let filtered = activityRows;
  if (eventStartAt) {
    filtered = filtered.filter((row) => row.day >= eventStartAt);
  }
  if (filtered.length === 0) return [];

  const sorted = [...filtered].sort((a, b) => b.day.localeCompare(a.day));

  const results: DailyCumulative[] = [];
  let runningTotal = currentActiveTotal;
  let newerDay: string | null = null;

  for (const row of sorted) {
    if (newerDay !== null) {
      const gap = daysBetweenUtc(row.day, newerDay);
      if (gap > maxGap) break;
    }

    if (runningTotal < 0) break;

    results.push({ day: row.day, cumulative: runningTotal });

    const netChange =
      row.subs -
      row.unsubs +
      (row.other_adds ?? 0) -
      (row.other_removes ?? 0);

    runningTotal -= netChange;
    newerDay = row.day;

    if (runningTotal < 0) break;
  }

  return results
    .reverse()
    .filter((row) => row.cumulative > 0);
}

/** Whether a reconstructed day should be persisted to mailchimp_audience_snapshots. */
export function isWritableMailchimpDailySnapshot(cumulative: number): boolean {
  return cumulative > 0;
}
