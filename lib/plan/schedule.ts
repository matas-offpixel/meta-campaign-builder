/**
 * Plan-level start/end times. Dates stay YYYY-MM-DD; times are HH:MM
 * (the HTML time input). Existing plans have null times and keep the
 * adapter behaviour they already had — no silent shift on old rows.
 */

const TIME_HH_MM = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Normalise a persisted or typed time to `HH:MM`, or null. */
export function normalizePlanTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = TIME_HH_MM.exec(trimmed);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function withSeconds(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}

/**
 * Meta `budgetSchedule.startDate` / `endDate` as consumed by `toUnixTs`:
 *   - no date → empty (payload omits start_time / end_time)
 *   - date, no time → date-only, midnight UTC (the existing path)
 *   - date + time → ISO `YYYY-MM-DDTHH:mm:ssZ` (UTC, matching toUnixTs)
 */
export function composeMetaScheduleIso(
  date: string | null,
  time: string | null | undefined,
): string {
  if (!date) return "";
  const hhmm = normalizePlanTime(time);
  if (!hhmm) return date;
  return `${date}T${withSeconds(hhmm)}Z`;
}

/**
 * TikTok `scheduleStartAt` / `scheduleEndAt`.
 *
 * With a time: naive `YYYY-MM-DDTHH:mm:ss` (no zone). `formatTikTokScheduleTime`
 * then treats that as wall clock in the ADVERTISER timezone — the existing
 * resolution. Never assume Europe/London; preflight already blocks when tz
 * is unresolved.
 *
 * Without a time: keep the current Z-suffixed defaults (`09:00:00` start,
 * `21:00:00` end) so old rows do not shift.
 */
export function composeTikTokScheduleAt(
  date: string | null,
  time: string | null | undefined,
  fallbackHour: string,
): string | null {
  if (!date) return null;
  const hhmm = normalizePlanTime(time);
  if (!hhmm) return `${date}T${fallbackHour}Z`;
  return `${date}T${withSeconds(hhmm)}`;
}

export const TIKTOK_DEFAULT_START_HOUR = "09:00:00";
export const TIKTOK_DEFAULT_END_HOUR = "21:00:00";

export const PLAN_STEP2_HASH = "plan-step-2";

export function planContinuationHref(planId: string): string {
  return `/plan/${planId}#${PLAN_STEP2_HASH}`;
}

export const WIZARD_ACTIVE_VS_PLAN_PAUSED =
  "Launching from the wizard creates entities ACTIVE (the wizard default). Launch all from this page creates them PAUSED.";

export const GOOGLE_DATE_ONLY_NOTE =
  "Google Ads is date-level — start/end times on this plan are not sent to Google.";
