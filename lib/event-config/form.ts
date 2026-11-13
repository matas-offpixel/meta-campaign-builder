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

/**
 * The reference shows that can be saved: the client's other events, never
 * the event itself and never an umbrella. Order kept, repeats dropped.
 */
export function allowedReferenceIds(
  picked: readonly string[],
  eventId: string,
  candidates: readonly { id: string; isUmbrella: boolean }[],
): string[] {
  const ok = new Set(candidates.filter((c) => c.id !== eventId && !c.isUmbrella).map((c) => c.id));
  return [...new Set(picked)].filter((id) => ok.has(id));
}
