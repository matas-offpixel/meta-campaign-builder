/**
 * lib/event-config/form.ts
 *
 * Parsing what the event page's config inputs send (D9). Pure.
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

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
 * nothing else. cirqlin_page_id is never written from the panel (design
 * rejected the raw-id field; the pasted-link field is a follow-up), so a
 * caller that sends one has it dropped here.
 */
export function eventConfigUpdate(input: { capacity: number | null; isUmbrella: boolean }): { capacity: number | null; is_umbrella: boolean } {
  return { capacity: input.capacity, is_umbrella: input.isUmbrella === true };
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
