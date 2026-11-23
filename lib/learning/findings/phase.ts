/**
 * E2b / RP3: a show's rollout phase on a London day.
 *
 *   teaser        before announcement_at (no date or venue, by design)
 *   announced     announcement_at → presale_at (the presale info / dated page)
 *   presale       presale_at → general_sale_at
 *   general_sale  from general_sale_at
 *   unknown       before the earliest known boundary, when announcement_at isn't
 *                 set (a teaser can't be told from a dated phase): "no phase
 *                 data" for those days only. Never guessed from ad names.
 *
 * Missing boundaries (ops ruling, 23 Nov): every day after the latest known
 * boundary is that boundary's phase. P26-BDAY has no announcement_at but its
 * general sale was 30 Oct, so its November days are general_sale. A show with
 * no boundary at all has no phase data.
 *
 * The phase is a property of the landing page and the rollout, not of one ad.
 *
 * A day belongs to the phase in force when it starts (00:00 London). A boundary
 * during the day takes effect the next day: NX27-EWANMCVICAR announced at 17:00
 * on 18 Nov, so 18 Nov is teaser and 19 Nov the first announced day. Variant
 * pairs use this as it is (the 16–18 Nov "Promo vid" / "Promo vid no text" pair
 * stays inside the teaser). Phase curves leave that day out entirely
 * (`boundaryDays`, ops ruling, 23 Nov): a day split between two phases is
 * neither's. A boundary at exactly 00:00 London splits no day, so it excludes
 * none.
 *
 * Two boundaries on the same day (presale_at 12:00 and general_sale_at 14:00 on
 * 20 Nov for Ewan McVicar, Glitterbox and LP Rhythm) leave the phase between
 * them with no day: never an empty row, never an error. A boundary that comes
 * before an earlier one (bad data) is ignored, so phases never run backwards.
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

const ORDER = [
  ["announced", "announcement_at"],
  ["presale", "presale_at"],
  ["general_sale", "general_sale_at"],
] as const;

/** The boundaries that count, in order, with the London day each phase starts; one earlier than the one before it is dropped. */
export function phaseStarts(event: PhaseEvent | null | undefined): { phase: Exclude<Phase, "unknown" | "teaser">; column: (typeof ORDER)[number][1]; at: string; startDay: string }[] {
  const out: { phase: Exclude<Phase, "unknown" | "teaser">; column: (typeof ORDER)[number][1]; at: string; startDay: string }[] = [];
  let floor: string | null = null;
  for (const [phase, column] of ORDER) {
    const at = event?.[column] ?? null;
    const startDay = phaseStartDay(at);
    if (!at || !startDay || (floor && startDay < floor)) continue;
    floor = startDay;
    out.push({ phase, column, at, startDay });
  }
  return out;
}

/** The show's phase on a London day (YYYY-MM-DD). The one place phases come from (§9.7). */
export function phaseOf(event: PhaseEvent | null | undefined, day: string): Phase {
  const starts = phaseStarts(event);
  let phase: Phase | null = null;
  for (const s of starts) if (day >= s.startDay) phase = s.phase;
  if (phase) return phase;
  // Before every known boundary: teaser only when the announcement is known.
  return starts[0]?.phase === "announced" ? "teaser" : "unknown";
}

/** Any boundary known: the show has phase data for some of its days. */
export function hasPhaseData(event: PhaseEvent | null | undefined): boolean {
  return phaseStarts(event).length > 0;
}

/**
 * The London days a boundary splits: the calendar day of every known boundary
 * (the three columns, kept or not), except one at exactly 00:00 London. Phase
 * curves leave these days out (ops ruling, 23 Nov).
 */
export function boundaryDays(event: PhaseEvent | null | undefined): string[] {
  const days = new Set<string>();
  for (const [, column] of ORDER) {
    const at = event?.[column] ?? null;
    const start = phaseStartDay(at);
    if (!at || !start) continue;
    const day = londonDayOf(at);
    if (day !== start) days.add(day);
  }
  return [...days].sort();
}

function londonDayOf(at: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.parse(at)));
}
