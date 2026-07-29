/**
 * lib/d2c/bird/campaigns/schedule.ts
 *
 * Building Bird broadcast schedules that Bird will actually accept.
 *
 * Every rule below was established empirically against the live API on
 * 2026-07-29 by reading back validation errors — none of it is documented and
 * none of it was in the DevTools capture (which only ever showed the default
 * `recipient-local` / `send-immediately` empty-draft shape).
 *
 * Enums (from Bird's own validation messages):
 *   timeInPastBehavior      "skip" | "send-immediately" | "send-next-day"
 *   missingTimeZoneBehavior "skip" | "send-immediately" | "workspace-timezone"
 *
 * Constraints when `timezone` is a fixed IANA zone (e.g. "Europe/Lisbon"):
 *
 *   1. `startsAt` MUST carry the UTC offset that matches that zone on that
 *      date — e.g. "2026-08-04T16:45:00+01:00". A correct UTC instant
 *      ("2026-08-04T15:45:00Z") is REJECTED with "Schedule start time doesn't
 *      match provided timezone", even though it denotes the same moment. A
 *      naive local string ("2026-08-04T16:45:00") returns a bare 400.
 *
 *   2. `timeInPastBehavior` MUST be "send-immediately". Both "skip" and
 *      "send-next-day" are rejected: "timeInPastBehavior must be set to
 *      'send-immediately when using a fixed timezone" (Bird's typo, not ours).
 *
 *   3. `missingTimeZoneBehavior` MUST also be "send-immediately". "skip" and
 *      "workspace-timezone" are rejected, and "" is rejected as not-an-enum.
 *
 * So a fixed-zone schedule has exactly ONE legal behaviour pair. The
 * conservative "skip" is only reachable by giving up the fixed zone, which
 * would send at each recipient's local time — wrong for a single-venue event.
 *
 * ⚠️ Consequence to understand: `send-immediately` means that if the broadcast
 * is activated AFTER its scheduled time, it fires at once rather than being
 * skipped. This is contained for our flow because we only ever create DRAFTS
 * with no audience — Bird blocks activation while `_issues` reports
 * "Included recipients must be provided", so a draft physically cannot fire.
 * The behaviour only becomes live once a human attaches an audience and
 * activates, at which point the schedule is visible in the UI.
 */

import type { BroadcastSchedule } from "./client.ts";

/** The only `timeInPastBehavior` a fixed-timezone schedule accepts. */
export const FIXED_TZ_TIME_IN_PAST_BEHAVIOR = "send-immediately";
/** The only `missingTimeZoneBehavior` a fixed-timezone schedule accepts. */
export const FIXED_TZ_MISSING_TIMEZONE_BEHAVIOR = "send-immediately";

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, "0");
}

/**
 * The UTC offset of `tz` at `instant`, in minutes (positive east of UTC).
 * Derived via Intl so DST is handled without a tz database dependency.
 */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = Number(p.value);
  const hour = m.hour === 24 ? 0 : m.hour;
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, hour, m.minute, m.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Format a wall-clock time in `tz` as the offset-bearing ISO string Bird
 * requires, e.g. (2026, 8, 4, 16, 45, "Europe/Lisbon") →
 * "2026-08-04T16:45:00+01:00".
 *
 * Resolves the offset iteratively so a time near a DST boundary lands on the
 * offset actually in force at that instant rather than the one before it.
 */
export function zonedWallClockToOffsetISO(
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): string {
  const naiveUtc = Date.UTC(year, month1to12 - 1, day, hour, minute, 0);
  let offset = tzOffsetMinutes(new Date(naiveUtc), tz);
  // Re-resolve against the corrected instant (matters across a DST change).
  offset = tzOffsetMinutes(new Date(naiveUtc - offset * 60000), tz);

  const sign = offset >= 0 ? "+" : "-";
  return (
    `${year}-${pad(month1to12)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

export interface ScheduledBroadcastInput {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  /** 0-23, venue-local wall clock. */
  hour: number;
  minute: number;
  /** IANA zone, e.g. "Europe/Lisbon". Never a hardcoded offset — Lisbon is
   *  WEST (+01:00) in summer and WET (+00:00) in winter. */
  timezone: string;
}

/**
 * Build a fixed-timezone broadcast schedule Bird accepts, pinning the only
 * legal behaviour pair. Callers give venue-local wall-clock time; the offset
 * is derived from the IANA zone at that date.
 */
export function scheduledBroadcastSchedule(
  input: ScheduledBroadcastInput,
): BroadcastSchedule {
  return {
    startsAt: zonedWallClockToOffsetISO(
      input.year,
      input.month,
      input.day,
      input.hour,
      input.minute,
      input.timezone,
    ),
    timezone: input.timezone,
    timeInPastBehavior: FIXED_TZ_TIME_IN_PAST_BEHAVIOR,
    missingTimeZoneBehavior: FIXED_TZ_MISSING_TIMEZONE_BEHAVIOR,
  };
}
