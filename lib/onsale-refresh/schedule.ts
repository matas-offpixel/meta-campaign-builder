/**
 * R1: when the refresh runs and what it reads.
 *
 * Two Mondays per payday cycle (lib/drive/tree.ts's paydayCycleMondays):
 * the cycle refresh on the cycle's Monday, the mid-cycle check on the
 * Monday between. A scheduled run reads the last full Monday–Sunday week;
 * a hand-started shadow run on any day reads the seven days to the day
 * before. From show week's Monday the refresh stops.
 *
 * Dates are ISO days in London; the cron runs at 06:00 UTC so the
 * nightly learning-refresh (03:30 UTC) has finished.
 */

import { lastFridayOfMonth } from "../creative-lab/payday.ts";
import { addDays, cycleMondayFor, londonToday, mondayOf, paydayCycleMondays, showWeekMonday, type CycleCalendar } from "../drive/tree.ts";
import type { PhaseConfig } from "./phase-config.ts";

export type RunKind = "cycle" | "mid_cycle" | "shadow";
export type CycleKind = "payday" | "content";

export type RefreshWindow = {
  /** Inclusive ISO days. */
  start: string;
  end: string;
};

export type RunPlan = {
  /** The day the run is for. */
  day: string;
  runKind: RunKind;
  /** The cycle the day sits in. */
  cycleMonday: string;
  cycleKind: CycleKind;
  window: RefreshWindow;
  /** The next Monday that checks this event, or null once show week has started. */
  nextCheck: string | null;
  nextCheckKind: RunKind | null;
  /** The next cycle refresh (adds and claims come back then), and which cycle it starts. */
  nextCycle: string | null;
  nextCycleKind: CycleKind | null;
  /** True from show week's Monday: the refresh does not run. */
  showWeek: boolean;
};

function isMonday(day: string): boolean {
  return mondayOf(day) === day;
}

/**
 * The payday cycle is the one whose Monday is the Monday of a payday week
 * (pay lands on the last Friday of the month); the cycle a fortnight after
 * it is the content cycle. Any other Monday the calendar lists is content.
 */
export function cycleKindOf(cycleMonday: string, calendar: CycleCalendar = paydayCycleMondays): CycleKind {
  const year = Number(cycleMonday.slice(0, 4));
  const month = Number(cycleMonday.slice(5, 7));
  const neighbours: [number, number][] = [
    month === 1 ? [year - 1, 12] : [year, month - 1],
    [year, month],
    month === 12 ? [year + 1, 1] : [year, month + 1],
  ];
  const paydayMondays = neighbours.map(([y, m]) => mondayOf(`${y}-${String(m).padStart(2, "0")}-${String(lastFridayOfMonth(y, m)).padStart(2, "0")}`));
  if (paydayMondays.includes(cycleMonday)) return "payday";
  void calendar;
  return "content";
}

/** The scheduled kind for a Monday: the cycle refresh on a cycle Monday, else the mid-cycle check. Null on any other day. */
export function scheduledRunKind(day: string, calendar: CycleCalendar = paydayCycleMondays): RunKind | null {
  if (!isMonday(day)) return null;
  const cycle = cycleMondayFor(day, calendar);
  return cycle === day ? "cycle" : "mid_cycle";
}

/** The last full Monday–Sunday week before `day`, or the seven days to the day before for a shadow run. */
export function windowFor(day: string, runKind: RunKind, config: PhaseConfig): RefreshWindow {
  if (config.window.kind === "rolling_days") {
    const end = addDays(day, -1);
    return { start: addDays(end, -(config.window.days - 1)), end };
  }
  if (runKind === "shadow") {
    const end = addDays(day, -1);
    return { start: addDays(end, -6), end };
  }
  const monday = mondayOf(day);
  const end = addDays(monday, -1);
  return { start: addDays(end, -6), end };
}

function nextMondayAfter(day: string): string {
  const monday = mondayOf(day);
  return monday > day ? monday : addDays(monday, 7);
}

/**
 * The plan for one event on one day. `runKind` is the scheduled kind on a
 * Monday and "shadow" on any other day, or when `shadow` is asked for.
 */
export function planRun(args: {
  day: string;
  eventDate: string | null;
  config: PhaseConfig;
  shadow?: boolean;
  calendar?: CycleCalendar;
}): RunPlan {
  const calendar = args.calendar ?? paydayCycleMondays;
  const scheduled = scheduledRunKind(args.day, calendar);
  const runKind: RunKind = args.shadow || !scheduled ? "shadow" : scheduled;
  const cycleMonday = cycleMondayFor(args.day, calendar);
  const showWeek = showWeekMonday(args.eventDate);
  const inShowWeek = Boolean(showWeek && args.day >= showWeek);
  const window = windowFor(args.day, runKind, args.config);
  let nextCheck: string | null = nextMondayAfter(args.day);
  if (showWeek && nextCheck >= showWeek) nextCheck = null;
  const nextCheckKind = nextCheck ? scheduledRunKind(nextCheck, calendar) : null;
  const upcoming = calendar(addDays(args.day, 1), addDays(args.day, 60));
  const nextCycle = upcoming.find((monday) => !showWeek || monday < showWeek) ?? null;
  return {
    day: args.day,
    runKind,
    cycleMonday,
    cycleKind: cycleKindOf(cycleMonday, calendar),
    window,
    nextCheck,
    nextCheckKind,
    nextCycle,
    nextCycleKind: nextCycle ? cycleKindOf(nextCycle, calendar) : null,
    showWeek: inShowWeek,
  };
}

/** The cycle Monday after `cycleMonday`, and its kind. Null past `horizonDays`. */
export function nextCycleAfter(cycleMonday: string, calendar: CycleCalendar = paydayCycleMondays, horizonDays = 60): { monday: string; kind: CycleKind } | null {
  const next = calendar(addDays(cycleMonday, 1), addDays(cycleMonday, horizonDays))[0];
  return next ? { monday: next, kind: cycleKindOf(next, calendar) } : null;
}

export function todayLondon(now: Date): string {
  return londonToday(now);
}

export const addDaysIso = addDays;

/** "Mon 16 Nov" */
export function shortDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  return `${weekday} ${dayMonth(iso)}`;
}

/** "16 Nov" */
export function dayMonth(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
  return `${date.getUTCDate()} ${month}`;
}

/** "w/c 9 Nov" */
export function weekLabel(monday: string): string {
  return `w/c ${dayMonth(monday)}`;
}
