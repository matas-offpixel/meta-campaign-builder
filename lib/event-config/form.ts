/**
 * lib/event-config/form.ts
 *
 * Parsing what the event page's config inputs send (D9). Pure.
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Blank = no capacity (no default). Otherwise a whole number of tickets above 0. */
export function parseCapacity(input: string): Parsed<number | null> {
  const s = input.trim().replace(/,/g, "");
  if (!s) return { ok: true, value: null };
  if (!/^\d+$/.test(s) || Number(s) <= 0) return { ok: false, error: "Capacity is a whole number of tickets." };
  return { ok: true, value: Number(s) };
}

/**
 * Blank = no page. Otherwise the CIRQLIN page id (a uuid), lower-cased to
 * match migration 235's check. A slug or a page address is refused: the
 * page id doesn't change when the page is renamed.
 */
export function parseCirqlinPageId(input: string): Parsed<string | null> {
  const s = input.trim().toLowerCase();
  if (!s) return { ok: true, value: null };
  if (!UUID.test(s)) return { ok: false, error: "Paste the CIRQLIN page id, not the page's address." };
  return { ok: true, value: s };
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
