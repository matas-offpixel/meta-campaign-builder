/**
 * lib/event-config/form.ts
 *
 * Parsing what the event page's config inputs send (D9). Pure.
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { CirqlinPageRef } from "../cirqlin/page.ts";
import { cirqlinPageColumns } from "./cirqlin.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Blank = no capacity (no default). Otherwise a whole number of tickets above 0. */
export function parseCapacity(input: string): Parsed<number | null> {
  const s = input.trim().replace(/,/g, "");
  if (!s) return { ok: true, value: null };
  if (!/^\d+$/.test(s) || Number(s) <= 0) return { ok: false, error: "Capacity is a whole number of tickets." };
  return { ok: true, value: Number(s) };
}

/**
 * The events row the config panel writes: capacity and the umbrella flag,
 * plus the CIRQLIN page columns only when the save resolved (or cleared) the
 * page through CIRQLIN. A page id the caller sends is never written: the id,
 * title and slug come from CIRQLIN's answer (cirqlinPageColumns), and the
 * pasted link is never stored.
 */
export function eventConfigUpdate(input: {
  capacity: number | null;
  isUmbrella: boolean;
  cirqlin?: { page: CirqlinPageRef | null; now: Date };
}): Record<string, unknown> {
  const row: Record<string, unknown> = { capacity: input.capacity, is_umbrella: input.isUmbrella === true };
  if (input.cirqlin) Object.assign(row, cirqlinPageColumns(input.cirqlin.page, input.cirqlin.now));
  return row;
}

/** Today's date in London, YYYY-MM-DD: the day a show's date is compared with. */
export function londonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * D10: can this show be a reference? A reference needs a final count, so
 * only finished shows qualify, never an umbrella.
 *
 * Until the alias switch (HD1, #1217) "has a final count" is "the show's
 * date has passed". #1217 stores a final-count flag (design ruling c): at
 * the alias switch, replace the date test below with that flag. This is the
 * one place the rule lives; the panel's list, the save action and the frame
 * fixtures all call it.
 */
export function canBeReferenceShow(show: { eventDate: string | null; isUmbrella: boolean }, today: string): boolean {
  if (show.isUmbrella || !show.eventDate) return false;
  return show.eventDate.slice(0, 10) < today;
}

/**
 * The reference shows that can be saved: the client's other events that
 * canBeReferenceShow allows, never the event itself. Order kept, repeats
 * dropped.
 */
export function allowedReferenceIds(
  picked: readonly string[],
  eventId: string,
  candidates: readonly { id: string; isUmbrella: boolean; eventDate: string | null }[],
  today: string,
): string[] {
  const ok = new Set(candidates.filter((c) => c.id !== eventId && canBeReferenceShow(c, today)).map((c) => c.id));
  return [...new Set(picked)].filter((id) => ok.has(id));
}
