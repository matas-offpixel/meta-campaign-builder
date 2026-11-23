/**
 * E2b / RP3: a show's rollout phase on a London day.
 *
 *   teaser        before announcement_at (no date or venue, by design)
 *   announced     announcement_at → presale_at (the presale info / dated page)
 *   presale       presale_at → general_sale_at
 *   general_sale  from general_sale_at
 *   unknown       no announcement_at: "no phase data", never guessed from ad names
 *
 * The phase is a property of the landing page and the rollout, not of one ad.
 *
 * A day belongs to the phase in force when it starts (00:00 London). A boundary
 * during the day takes effect the next day: NX27-EWANMCVICAR announced at 17:00
 * on 18 Nov, so 18 Nov is teaser and 19 Nov the first announced day. ad_daily_insights
 * is daily, so a day can't be split; starting-phase keeps the day with the hours
 * most of it ran in for an evening announcement, and keeps the 16–18 Nov
 * "Promo vid" / "Promo vid no text" pair inside one phase.
 *
 * A boundary missing, or two on the same day (presale_at 12:00 and
 * general_sale_at 14:00 on 20 Nov for Ewan McVicar, Glitterbox and LP Rhythm),
 * leaves the phase between them with no day: never an empty row, never an error.
 * A later boundary that comes before an earlier one (bad data) is ignored, so the
 * phases never run backwards.
 *
 * §9.7: the CIRQLIN phase plan becomes the source later, mirrored read-only.
 * Everything reads phases through `phaseOf`, and `PHASE_SOURCE` names where they
 * come from: switching is one function.
 */

import { londonAt } from "./observed-tests.ts";

export type Phase = "teaser" | "announced" | "presale" | "general_sale" | "unknown";

export const PHASES: readonly Exclude<Phase, "unknown">[] = ["teaser", "announced", "presale", "general_sale"];

export type PhaseEvent = {
  announcement_at: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
};

export const PHASE_SOURCE = "event_dates" as const;

/** The London day a phase starts on: the day after a mid-day boundary, the same day for one at 00:00 London. Null when the boundary isn't set or can't be read. */
export function phaseStartDay(boundary: string | null | undefined): string | null {
  if (!boundary) return null;
  const at = Date.parse(boundary);
  if (!Number.isFinite(at)) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  if (Date.parse(londonAt(day, 0)) === at) return day;
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** The show's phase on a London day (YYYY-MM-DD). The one place phases come from (§9.7). */
export function phaseOf(event: PhaseEvent | null | undefined, day: string): Phase {
  const announced = phaseStartDay(event?.announcement_at);
  if (!announced) return "unknown";
  let phase: Phase = day >= announced ? "announced" : "teaser";
  let floor = announced;
  for (const [next, boundary] of [["presale", event?.presale_at], ["general_sale", event?.general_sale_at]] as const) {
    const start = phaseStartDay(boundary);
    if (!start || start < floor) continue;
    floor = start;
    if (day >= start) phase = next;
  }
  return phase;
}

export function hasPhaseData(event: PhaseEvent | null | undefined): boolean {
  return phaseStartDay(event?.announcement_at) != null;
}
