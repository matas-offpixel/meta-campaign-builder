/**
 * RT11 — the campaign's share of current daily spend by stretch
 * (docs/design-record/2026-11-17-retargeting-campaign-2.html, Matas 17 Nov).
 *
 * | Stretch          | Share |
 * |------------------|-------|
 * | Normally         | 10 %  |
 * | Payday stretch   | 15 %  (RT6's window: 18 days from the Thursday before payday) |
 * | Final month      | 15 %  (from 30 days out) |
 * | Final two weeks  | 20 %  (from 14 days out) |
 * | Final week       | 25 %  (from 7 days out, to the show day) |
 *
 * Overlaps take the higher share; they never add up. Create starts at
 * today's share (RT4's 10 / 15 / 20 % choice is withdrawn). The step lines
 * themselves are PR D's.
 *
 * Pure. Dates are London calendar days (YYYY-MM-DD).
 */

import { isInPaydayWindow } from "../dashboard/pacing.ts";
import { addDaysIso } from "../onsale-refresh/schedule.ts";

export type Stretch = "payday" | "final_month" | "final_two_weeks" | "final_week";

export const RT11 = {
  normal: 10,
  shares: { payday: 15, final_month: 15, final_two_weeks: 20, final_week: 25 } satisfies Record<Stretch, number>,
  daysOut: { final_month: 30, final_two_weeks: 14, final_week: 7 },
} as const;

/** RT11's words for a stretch, as the Create line and header write them. */
export const STRETCH_LABEL: Record<Stretch, string> = { payday: "payday", final_month: "final month", final_two_weeks: "final two weeks", final_week: "final week" };

export type TodayShare = {
  share: number;
  /** The stretch that sets the share; null = normally. */
  stretch: Stretch | null;
};

/** The run-in step `day` is in, the highest first; null before 30 days out or after the show. */
export function runInOn(day: string, showDay: string): Exclude<Stretch, "payday"> | null {
  if (day > showDay) return null;
  for (const stretch of ["final_week", "final_two_weeks", "final_month"] as const) {
    if (day >= addDaysIso(showDay, -RT11.daysOut[stretch])) return stretch;
  }
  return null;
}

/** RT11: the day's share, the higher of the payday stretch and the run-in step. */
export function shareOn(day: string, showDay: string | null): TodayShare {
  const candidates: TodayShare[] = [{ share: RT11.normal, stretch: null }];
  if (showDay) {
    const runIn = runInOn(day, showDay);
    if (runIn) candidates.push({ share: RT11.shares[runIn], stretch: runIn });
  }
  if (isInPaydayWindow(day)) candidates.push({ share: RT11.shares.payday, stretch: "payday" });
  // Higher share wins; at a tie the run-in step names it (a payday stretch inside a 15 % step adds nothing).
  return candidates.reduce((best, next) => (next.share > best.share || (next.share === best.share && best.stretch === "payday" && next.stretch !== null) ? next : best));
}
