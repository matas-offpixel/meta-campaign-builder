/**
 * lib/d2c/brief-parser/schedule.ts
 *
 * Pure scheduling rules for the brief → campaign automation. No I/O, no
 * Anthropic — kept separate so the schedule math is unit-testable in isolation.
 *
 * Rules (all derived from the event milestones in the brief):
 *   - announce        = signup_launch_at (fallback announcement_at)
 *   - reminder        = presale_at − 1 day, at 16:45 venue-local time
 *   - community_early = presale_at − 30 minutes
 *   - presale_live    = presale_at
 *   - gen_sale        = general_sale_at
 *   - autoresp_setup  = announce time (setup task fires alongside announcement)
 *
 * Timezone handling uses Intl.DateTimeFormat with the venue timeZone so the
 * 16:45 reminder lands at the correct wall-clock time across DST boundaries.
 */

import type { BriefEventInsert, D2CJobType } from "../types.ts";

const REMINDER_HOUR_LOCAL = 16;
const REMINDER_MINUTE_LOCAL = 45;
const DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_MIN_MS = 30 * 60 * 1000;

/**
 * Offset (ms) between the given instant's wall-clock representation in `tz`
 * and UTC. Positive east of UTC.
 */
function tzOffsetMs(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // `hour` can come back as 24 at midnight in some engines.
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUtc - instant.getTime();
}

/**
 * Converts a wall-clock time in `tz` to the corresponding UTC ISO string.
 * Iterates once to correct for DST transitions at the target instant.
 */
export function zonedWallClockToUtcISO(
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): string {
  const guess = Date.UTC(year, month1to12 - 1, day, hour, minute, 0, 0);
  let off = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off) {
    off = off2;
    utc = guess - off;
  }
  return new Date(utc).toISOString();
}

/** Wall-clock Y/M/D of an instant in a given timezone. */
function zonedYmd(instant: Date, tz: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return { y: map.year, m: map.month, d: map.day };
}

/**
 * reminder = the calendar day before presale's *local* date, at 16:45 local.
 */
export function computeReminderSendAt(presaleAtIso: string, tz: string): string {
  const presale = new Date(presaleAtIso);
  if (Number.isNaN(presale.getTime())) {
    throw new Error(`Invalid presale_at: ${presaleAtIso}`);
  }
  const { y, m, d } = zonedYmd(presale, tz);
  // Day math on a UTC midnight anchor avoids local-DST surprises.
  const prev = new Date(Date.UTC(y, m - 1, d) - DAY_MS);
  return zonedWallClockToUtcISO(
    prev.getUTCFullYear(),
    prev.getUTCMonth() + 1,
    prev.getUTCDate(),
    REMINDER_HOUR_LOCAL,
    REMINDER_MINUTE_LOCAL,
    tz,
  );
}

export function computeCommunityEarlyAt(presaleAtIso: string): string {
  const presale = new Date(presaleAtIso);
  if (Number.isNaN(presale.getTime())) {
    throw new Error(`Invalid presale_at: ${presaleAtIso}`);
  }
  return new Date(presale.getTime() - THIRTY_MIN_MS).toISOString();
}

export interface ComputedSchedule {
  announce: string;
  reminder: string;
  community_early: string;
  presale_live: string;
  gen_sale: string;
  autoresp_setup: string;
}

/**
 * Computes all six milestone timestamps (UTC ISO) from a parsed brief.
 * Requires event_timezone, presale_at and general_sale_at to be present.
 */
export function computeSchedule(event: BriefEventInsert): ComputedSchedule {
  const tz = event.event_timezone;
  const presale = event.presale_at;
  const genSale = event.general_sale_at;
  const announce =
    event.signup_launch_at ?? event.announcement_at ?? presale;

  return {
    announce: new Date(announce).toISOString(),
    reminder: computeReminderSendAt(presale, tz),
    community_early: computeCommunityEarlyAt(presale),
    presale_live: new Date(presale).toISOString(),
    gen_sale: new Date(genSale).toISOString(),
    autoresp_setup: new Date(announce).toISOString(),
  };
}

export const SCHEDULE_JOB_ORDER: readonly D2CJobType[] = [
  "announce",
  "autoresp_setup",
  "reminder",
  "community_early",
  "presale_live",
  "gen_sale",
] as const;
