/**
 * lib/intelligence/autotag-cadence.ts
 *
 * Pure cadence gate for the creative auto-tagger. The
 * `refresh-active-creatives` cron writes spend/ticket snapshots ~4× per day,
 * and historically the auto-tag sub-step piggy-backed on every one of those
 * writes (multiple presets × multiple cron invocations). Tags don't change once
 * set, so re-running the tagging pass that often is pure waste.
 *
 * These helpers gate the tagging pass to at most once per UTC day per event,
 * keyed off the most recent assignment already written under the *current*
 * model version. Scoping to the current model is deliberate: when the model
 * string changes (Sonnet → Haiku), no current-model assignment exists yet, so
 * the gate lets the one-time re-tag pass run instead of mistaking yesterday's
 * Sonnet pass for "already tagged today".
 *
 * No database or clock access lives here — the cron passes in the timestamps —
 * so the logic is unit-testable in isolation.
 */

export interface AutotagCadenceRow {
  source: string;
  model_version: string | null;
  created_at: string;
}

/** True iff two instants fall on the same UTC calendar day. */
export function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Most recent `created_at` among AI assignments written under `modelVersion`,
 * or null when this event has never been tagged with that model. Tolerates
 * unparseable / missing timestamps by skipping them.
 */
export function lastAiTagAt(
  rows: readonly AutotagCadenceRow[],
  modelVersion: string,
): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.source !== "ai" || row.model_version !== modelVersion) continue;
    const at = new Date(row.created_at);
    if (Number.isNaN(at.getTime())) continue;
    if (!latest || at.getTime() > latest.getTime()) latest = at;
  }
  return latest;
}

/**
 * Should the daily tagging pass run for this event right now? Yes when the
 * event has never been tagged under the current model, or when its most recent
 * current-model tag was written on an earlier UTC day than `now`.
 */
export function shouldRunDailyAutoTagPass(
  lastTaggedAt: Date | null,
  now: Date,
): boolean {
  if (!lastTaggedAt) return true;
  return !isSameUtcDay(lastTaggedAt, now);
}
