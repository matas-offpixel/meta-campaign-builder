/**
 * RT6's dates, for the panel's footer (frame RA): the next run-in step and
 * the next payday stretch, from the record's definitions. The step heights
 * are open for Matas, so nothing here raises a budget: PR C writes the
 * steps, switched off until the heights are set.
 *
 *   - The payday stretch is the code's payday window (isInPaydayWindow):
 *     18 days from the Thursday before payday.
 *   - The run-in: the final month from 30 days out, the final two weeks
 *     from 14, the final week from 7.
 *
 * Pure. Dates are London calendar days (YYYY-MM-DD).
 */

import { isInPaydayWindow } from "../dashboard/pacing.ts";
import { addDaysIso } from "../onsale-refresh/schedule.ts";

export type RunInStep = { key: "final_month" | "final_two_weeks" | "final_week"; label: string; daysOut: number };

export const RUN_IN: readonly RunInStep[] = [
  { key: "final_month", label: "final month", daysOut: 30 },
  { key: "final_two_weeks", label: "final two weeks", daysOut: 14 },
  { key: "final_week", label: "final week", daysOut: 7 },
];

/** RT6: step heights, open for Matas. Unset, so steps stay switched off. */
export const STEP_HEIGHTS: Record<RunInStep["key"] | "payday", number | null> = { payday: null, final_month: null, final_two_weeks: null, final_week: null };

export function stepHeightsSet(): boolean {
  return Object.values(STEP_HEIGHTS).every((value) => value != null);
}

/** The first day after `today` and up to the show day that starts a payday window. */
export function nextPaydayStart(today: string, showDay: string): string | null {
  for (let day = addDaysIso(today, 1); day <= showDay; day = addDaysIso(day, 1)) {
    if (isInPaydayWindow(day) && !isInPaydayWindow(addDaysIso(day, -1))) return day;
  }
  return null;
}

/** The next run-in step that starts after `today`. */
export function nextRunIn(today: string, showDay: string): { step: RunInStep; from: string } | null {
  for (const step of RUN_IN) {
    const from = addDaysIso(showDay, -step.daysOut);
    if (from > today) return { step, from };
  }
  return null;
}

/** The footer's steps, soonest first. */
export function nextSteps(today: string, showDay: string | null): { label: string; from: string }[] {
  if (!showDay || showDay < today) return [];
  const steps: { label: string; from: string }[] = [];
  const runIn = nextRunIn(today, showDay);
  if (runIn) steps.push({ label: runIn.step.label, from: runIn.from });
  const payday = nextPaydayStart(today, showDay);
  if (payday) steps.push({ label: "payday", from: payday });
  return steps.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
