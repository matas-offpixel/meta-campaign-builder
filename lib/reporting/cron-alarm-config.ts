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
  zeroRule: "never" | "rollup_meta" | "tickets" | "tier_channel" | "night_all_zero";
  /**
   * `night_all_zero` only: runs scheduled per London night. A zero alarms
   * once this many runs of the night have all done 0, or the night is over.
   */
  runsPerNight?: number;
}

/** A cron is "missing" after this many times its own interval. */
export const MISSING_INTERVAL_MULTIPLIER = 2;

/** One alert per condition per this window; re-alerts while still failing. */
export const ALERT_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * "Not reporting" stays silent for this long after a cron is first seen.
 *
 * `cron_runs` starts empty, so on day one EVERY entry looks like it has
 * never reported — a dozen Slack messages that say nothing except "this
 * table is new". A daily cron also needs a full day before its first row
 * exists.
 *
 * Measured from the later of the evaluator's own first run and the cron's
 * own first row, so a cron added later gets its own grace rather than
 * inheriting an expired one.
 *
 * Implausible-zero alarms are NOT graced: a cron that ran and wrote an
 * impossible zero is telling you something true from its first run.
 */
export const NOT_REPORTING_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Meta spend is judged against the last two days, not the last run: Meta
 * backfills late and a show can legitimately spend nothing overnight.
 */
export const ROLLUP_SPEND_LOOKBACK_DAYS = 2;

/** Matches the tier-channel snapshot's own staleness cutoff. */
export const TIER_CHANNEL_WINDOW_DAYS = 7;

/**
 * Legs are separate entries. `rollup-sync-events` writes four independent
 * legs in one run; folding them into one alarm means a dead tickets leg
 * hides behind a healthy Meta leg — which is exactly how it stayed dead
 * from 3 Sep. Same reason the autotagger and the Cirqlin signup sync get
 * their own rows rather than being absorbed by their host cron.
 *
 * Intervals are the real gaps from `vercel.json`, not the nominal cadence:
 * `0 7,13,19` is a 6 h gap by day but 12 h across the 19:00 → 07:00 night,
 * so the longest gap is what `missing` has to tolerate or it cries every
 * morning.
 *
 * Deliberately NOT alarmed: `d2c-*` (idle), `mailchimp-backfill-tick`,
 * `show-week-burst`, `match-attribution` (0 by design
 * until attribution inputs exist), and anything on the Vercel v2 duplicate
 * project. A cron that is supposed to write nothing must never be wired to
 * an alarm that fires when it writes nothing.
 */
/**
 * Leg names that live inside another cron's route. Exported so the route
 * that records the leg and the list that watches it cannot drift apart.
 */
export const AUTOTAG_LEG_NAME = "refresh-active-creatives:autotag";
export const CIRQLIN_LEG_NAME = "mailchimp-eod-snapshot:cirqlin";

export const CRON_ALARMS: CronAlarmSpec[] = [
  // rollup-sync-events — 0 7,13,19 UTC. Longest gap 19:00 → 07:00 = 720.
  { cronName: "rollup-sync-events:meta", intervalMinutes: 720, zeroRule: "rollup_meta" },
  { cronName: "rollup-sync-events:tickets", intervalMinutes: 720, zeroRule: "tickets" },
  { cronName: "rollup-sync-events:tiktok", intervalMinutes: 720, zeroRule: "never" },
  { cronName: "rollup-sync-events:google", intervalMinutes: 720, zeroRule: "never" },

  // 0 6,10,14,18,22 UTC. Longest gap 22:00 → 06:00 = 480.
  { cronName: "sync-ticketing", intervalMinutes: 480, zeroRule: "tickets" },

  // 30 6,12,18 UTC. Longest gap 18:30 → 06:30 = 720.
  { cronName: "refresh-creative-insights", intervalMinutes: 720, zeroRule: "never" },
  // 30 7,13,19 UTC. Longest gap 19:30 → 07:30 = 720.
  { cronName: "refresh-active-creatives", intervalMinutes: 720, zeroRule: "never" },
  // Runs inside refresh-active-creatives; silent unless ENABLE_AI_AUTOTAG=1.
  { cronName: AUTOTAG_LEG_NAME, intervalMinutes: 720, zeroRule: "never" },

  { cronName: "ad-daily-insights", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: "learning-refresh", intervalMinutes: 1440, zeroRule: "never" },
  // 15 4 UTC: the observed tests' verdicts (RP1). Most nights it reads few or no test ad sets.
  { cronName: "learning-findings", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: "benchmark-alerts", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: "snapshot-tier-channel-sales-daily", intervalMinutes: 1440, zeroRule: "tier_channel" },

  // 55 23 UTC, with the Cirqlin signup sync as its own leg inside it.
  { cronName: "mailchimp-eod-snapshot", intervalMinutes: 1440, zeroRule: "never" },
  { cronName: CIRQLIN_LEG_NAME, intervalMinutes: 1440, zeroRule: "never" },

  { cronName: "optimisation-tick", intervalMinutes: 240, zeroRule: "never" },
  // 0 7,8 UTC, acting at 08:00 London: the creative tests' daily read (TF2, TF5–TF8). Most days it reads no running test.
  { cronName: "creative-tests-read", intervalMinutes: 1440, zeroRule: "never" },

  // 15 21,1,4 UTC: three runs a London night, each stopping at the first
  // rate limit. One row per run (rows_written = BMs scanned OK,
  // rows_considered = BMs not under an archived client). A failed run
  // alarms at once; a zero (rate-limited or not) only when every run that
  // night did 0. intervalMinutes is 1440 on purpose, not the longest real
  // gap (17 h): "not reporting" stays at 48 h without a run.
  { cronName: "bm-page-scan", intervalMinutes: 1440, zeroRule: "night_all_zero", runsPerNight: 3 },
  { cronName: "budget-pacing-check", intervalMinutes: 60, zeroRule: "never" },

  // The watcher watches itself: if the evaluator stops running, nothing
  // else can report that, because every other alarm depends on it.
  { cronName: "cron-alarm-evaluator", intervalMinutes: 60, zeroRule: "never" },
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
