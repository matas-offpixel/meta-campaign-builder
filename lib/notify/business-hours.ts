/**
 * lib/notify/business-hours.ts
 *
 * "Is it currently business hours in this timezone" for task #121's Slack
 * notification service — gates non-urgent channels so `ads_ops` pings don't
 * land at 3am. Business hours are fixed at 10:00–20:00 (exclusive of 20:00
 * itself), Monday–Friday.
 *
 * Uses `Intl.DateTimeFormat` to read the wall-clock hour/weekday in the
 * target IANA zone rather than pulling in a timezone-database dependency —
 * same technique already established by `lib/d2c/bird/campaigns/schedule.ts`
 * (`tzOffsetMinutes`). No `@/` imports so this stays `node --test`-friendly.
 */

const BUSINESS_HOURS_START = 10;
/** Exclusive — 20 means "up to but not including 8pm". */
const BUSINESS_HOURS_END = 20;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface ZonedWallClock {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  hour: number; // 0-23
}

function zonedWallClock(instant: Date, timezone: string): ZonedWallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
  }).formatToParts(instant);

  let weekdayStr: string | undefined;
  let hourStr: string | undefined;
  for (const part of parts) {
    if (part.type === "weekday") weekdayStr = part.value;
    if (part.type === "hour") hourStr = part.value;
  }

  const weekday = weekdayStr !== undefined ? WEEKDAY_INDEX[weekdayStr] : undefined;
  let hour = hourStr !== undefined ? Number(hourStr) : undefined;
  // Intl's 24h format sometimes renders midnight as "24" rather than "00".
  if (hour === 24) hour = 0;

  if (weekday === undefined || hour === undefined || Number.isNaN(hour)) {
    throw new Error(`business-hours: could not resolve wall clock for timezone "${timezone}"`);
  }
  return { weekday, hour };
}

/**
 * True if `instant` falls within 10:00–20:00, Monday–Friday, in `timezone`.
 * Defaults to `"Europe/London"` — the only zone task #121 needs today.
 */
export function isBusinessHours(instant: Date, timezone = "Europe/London"): boolean {
  const { weekday, hour } = zonedWallClock(instant, timezone);
  const isWeekday = weekday >= 1 && weekday <= 5;
  const isWithinHours = hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
  return isWeekday && isWithinHours;
}
