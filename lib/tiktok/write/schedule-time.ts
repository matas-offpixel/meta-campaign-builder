/**
 * Schedule times for /adgroup/create/.
 *
 * Official Create-an-ad-group docs label both fields UTC+0:
 * https://ads.tiktok.com/marketing_api/docs?id=1739499616346114
 * "Schedule start time (UTC+0), in the format of YYYY-MM-DD HH:MM:SS."
 * The same page says a start may be up to 12 hours earlier than now.
 *
 * Live /adgroup/create/ contradicted both notes: a start 18 minutes in the
 * operator's future was rejected with 40002 "Start time can't be earlier than
 * the current time." (request 20260821193127B3D9008B64A624A0E816). The miss
 * matched BST exactly if we UTC-converted a naive datetime-local and TikTok
 * then read the string in the advertiser timezone. Ads Manager's time-zone
 * help also says the account timezone governs campaign start and end times.
 *
 * The string we send is therefore the operator's intended wall clock in the
 * advertiser `timezone` from GET /advertiser/info/ (AccountManagementApi,
 * portal id 1739593083610113). That field is `timezone` (activity / schedule),
 * not `display_timezone` (reporting display). Never hardcode Europe/London.
 */

const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const AWARE_DATETIME = /(?:Z|[+-]\d{2}:\d{2})$/i;

export const TIKTOK_SCHEDULE_START_MARGIN_MS = 15 * 60 * 1000;
export const TIKTOK_SCHEDULE_START_LEAD_MS = 30 * 60 * 1000;

export function isIanaTimeZone(
  value: string | null | undefined,
): value is string {
  const timeZone = value?.trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isTimezoneAwareDateTime(value: string): boolean {
  return AWARE_DATETIME.test(value.trim());
}

export function formatWallClockForTikTok(
  value: string,
  timeZone: string,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!isIanaTimeZone(timeZone)) return null;

  if (!isTimezoneAwareDateTime(trimmed)) {
    const naive = parseNaiveDateTime(trimmed);
    if (!naive) return null;
    return formatTikTokDateTimeParts(naive);
  }

  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = wallClockPartsInTimeZone(instant, timeZone);
  if (!parts) return null;
  return formatTikTokDateTimeParts(parts);
}

/** Wall-clock `YYYY-MM-DDTHH:mm` for a draft field in `timeZone`. */
export function formatDatetimeLocalInTimeZone(
  instant: Date,
  timeZone: string,
): string | null {
  if (!isIanaTimeZone(timeZone)) return null;
  const parts = wallClockPartsInTimeZone(instant, timeZone);
  if (!parts) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function resolveScheduleInstant(
  value: string,
  timeZone: string,
): Date | null {
  const trimmed = value.trim();
  if (!trimmed || !isIanaTimeZone(timeZone)) return null;

  if (isTimezoneAwareDateTime(trimmed)) {
    const instant = new Date(trimmed);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  const naive = parseNaiveDateTime(trimmed);
  if (!naive) return null;
  return wallClockInTimeZoneToDate(naive, timeZone);
}

export function tikTokScheduleStartTooSoonMessage(
  formattedStart: string,
  timeZone: string,
): string {
  return `Schedule start ${formattedStart} is in the past or less than 15 minutes from now in the advertiser timezone (${timeZone}). TikTok rejects a start earlier than the current time. Set a start at least 15 minutes from now.`;
}

export function tikTokAdvertiserTimezoneMissingMessage(): string {
  return "Advertiser timezone could not be resolved from /advertiser/info/ `timezone`. TikTok schedule times are interpreted in the advertiser timezone — launch cannot assume Europe/London.";
}

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseNaiveDateTime(value: string): DateTimeParts | null {
  const match = NAIVE_DATETIME.exec(value.trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
  };
}

function formatTikTokDateTimeParts(parts: DateTimeParts): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function wallClockPartsInTimeZone(
  instant: Date,
  timeZone: string,
): DateTimeParts | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  const hour = Number(read("hour"));
  const minute = Number(read("minute"));
  const second = Number(read("second"));
  if (
    [year, month, day, hour, minute, second].some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function wallClockInTimeZoneToDate(
  parts: DateTimeParts,
  timeZone: string,
): Date | null {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const guessed = new Date(asUtc);
  const observed = wallClockPartsInTimeZone(guessed, timeZone);
  if (!observed) return null;
  const observedAsUtc = Date.UTC(
    observed.year,
    observed.month - 1,
    observed.day,
    observed.hour,
    observed.minute,
    observed.second,
  );
  return new Date(asUtc - (observedAsUtc - asUtc));
}
