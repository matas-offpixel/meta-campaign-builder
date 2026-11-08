import { isInPaydayWindow } from "../dashboard/pacing.ts";
import { lastFridayOfMonth } from "../creative-lab/payday.ts";
import { addCalendarDays } from "./dates.ts";
import type { TicketWarning } from "./types.ts";

export type RunWindow = { atRelease: boolean; from: string; to: string; inside: boolean };

function boundsAround(day: string): { from: string; to: string } | null {
  if (!isInPaydayWindow(day)) return null;
  let from = day;
  for (let i = 0; i < 24; i += 1) {
    const prev = addCalendarDays(from, -1);
    if (!isInPaydayWindow(prev)) break;
    from = prev;
  }
  let to = day;
  for (let i = 0; i < 24; i += 1) {
    const next = addCalendarDays(to, 1);
    if (!isInPaydayWindow(next)) break;
    to = next;
  }
  return { from, to };
}

function nextWindow(day: string): { from: string; to: string } {
  let cursor = day;
  for (let i = 0; i < 45; i += 1) {
    cursor = addCalendarDays(cursor, 1);
    const found = boundsAround(cursor);
    if (found && found.from > day) return found;
  }
  return { from: cursor, to: cursor };
}

/** "{release} live" runs at the list time. Every other claim uses the payday window. */
export function claimWindow(claim: string, listAt: string | null, day: string): RunWindow {
  const live = /\blive\b/i.test(claim);
  if (live && listAt) {
    const at = listAt.slice(0, 10);
    return { atRelease: true, from: at, to: at, inside: true };
  }
  const here = boundsAround(day);
  if (here) return { atRelease: false, from: here.from, to: here.to, inside: true };
  const upcoming = nextWindow(day);
  return { atRelease: false, from: upcoming.from, to: upcoming.to, inside: false };
}

function fridayIso(year: number, month: number): string {
  const day = lastFridayOfMonth(year, month);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekend(ymd: string): boolean {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * A8. The last Friday stays the rule. When that Friday is a bank holiday
 * or falls on 24–26 December, the push moves to the previous working day
 * and the day says why. 24 December can be the day it moves to.
 */
export function paydayPush(
  year: number,
  month: number,
  holidays: ReadonlyMap<string, string> = new Map(),
): { friday: string; day: string; reason: string | null } {
  const friday = fridayIso(year, month);
  const holiday = holidays.get(friday);
  const monthDay = friday.slice(5);
  const boxed = monthDay === "12-24" || monthDay === "12-25" || monthDay === "12-26";
  if (!holiday && !boxed) return { friday, day: friday, reason: null };
  let day = addCalendarDays(friday, -1);
  while (weekend(day) || holidays.has(day) || day.slice(5) === "12-25" || day.slice(5) === "12-26") {
    day = addCalendarDays(day, -1);
  }
  const reason = monthDay === "12-25" ? "moved · 25th is Christmas" : holiday ? `moved · ${holiday}` : "moved · the Friday is 24–26 December";
  return { friday, day, reason };
}

export function approveWarning(warning: TicketWarning, at: string): TicketWarning {
  return { ...warning, state: "scheduled", approvedAt: at };
}

/** Not now keeps the claim held and aims it at the next payday window. */
export function notNow(warning: TicketWarning, day: string): TicketWarning {
  const upcoming = claimWindow(warning.claim, null, day);
  const next = upcoming.inside ? nextWindow(day) : { from: upcoming.from, to: upcoming.to };
  return { ...warning, state: "held", runsFrom: next.from, runsTo: next.to };
}

/** An approved claim whose trigger has moved. One sentence, and a Today row. */
export function backToHeld(warning: TicketWarning, why: string): TicketWarning {
  if (warning.state !== "scheduled" && warning.state !== "live") return warning;
  return { ...warning, state: "back_to_held", why };
}

export function todaySentence(warning: TicketWarning): string | null {
  if (warning.state === "held") return `Proposed: ${warning.claim}`;
  if (warning.state === "back_to_held") return warning.why;
  return null;
}
