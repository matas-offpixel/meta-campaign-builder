/**
 * Every threshold the cron alarms use, in one file.
 *
 * Scheduling mirrors `vercel.json`. If a cron's schedule changes there and
 * not here, `missingAfterMinutes` goes wrong in the safe direction (a late
 * alarm, not a missed one) — but keep them in step.
 */

export interface CronAlarmSpec {
  cronName: string;
  /** Minutes between scheduled runs. */
  intervalMinutes: number;
  /**
   * Which zero counts as implausible. `never` means this cron legitimately
   * writes nothing most runs, so only a missing report is worth an alarm.
   */
  zeroRule: "never" | "rollup_meta" | "tickets" | "tier_channel";
}

/** A cron is "missing" after this many times its own interval. */
export const MISSING_INTERVAL_MULTIPLIER = 2;

/** One alert per condition per this window; re-alerts while still failing. */
export const ALERT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Meta spend is judged against the last two days, not the last run: Meta
 * backfills late and a show can legitimately spend nothing overnight.
 */
export const ROLLUP_SPEND_LOOKBACK_DAYS = 2;

/** Matches the tier-channel snapshot's own staleness cutoff. */
export const TIER_CHANNEL_WINDOW_DAYS = 7;

export const CRON_ALARMS: CronAlarmSpec[] = [
  // 07:00 / 13:00 / 19:00 UTC — six-hourly gaps, so 360.
  { cronName: "rollup-sync-events", intervalMinutes: 360, zeroRule: "rollup_meta" },
  { cronName: "snapshot-tier-channel-sales-daily", intervalMinutes: 1440, zeroRule: "tier_channel" },
  { cronName: "sync-ticketing", intervalMinutes: 360, zeroRule: "tickets" },
  { cronName: "ad-daily-insights", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: "learning-refresh", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: "google-ads-daily-insights", intervalMinutes: 1440, zeroRule: "never" },
];

export type AlarmCondition =
  | { kind: "not_reporting"; cronName: string; lastSeenAt: string | null; dueAfterMinutes: number }
  | { kind: "implausible_zero"; cronName: string; rule: CronAlarmSpec["zeroRule"]; reason: string };

/** Stable key so `notification_dedupe_state` can hold one row per condition. */
export function alarmDedupeKey(condition: AlarmCondition): string {
  return condition.kind === "not_reporting"
    ? `cron_not_reporting:${condition.cronName}`
    : `cron_zero:${condition.cronName}:${condition.rule}`;
}
