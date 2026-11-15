export type OfferKind = "payment_plan" | "group" | "early_entry";

export type OfferFigures = { today?: number; parts?: number; price?: number; arrive?: string };

/** One sentence. The Offers sheet shows this and does not propose. */
export const OFFER_REFUSAL = "An offer can't say sold, final, last or %.";

/** Whole words sold, final and last, plus a % sign. "finale" is not "final". */
export function offerRefusal(text: string): string | null {
  if (text.includes("%") || /(?:^|[^A-Za-z])(?:sold|final|last)(?![A-Za-z])/i.test(text)) return OFFER_REFUSAL;
  return null;
}

/** An offer is not a rung. The ladder never lists it. */
export const OFFER_ON_LADDER = false;

export const OFFER_MARKER = "entered, not derived";

export function offerWords(kind: OfferKind, figures: OfferFigures): { lines: string[]; card: string } {
  if (kind === "payment_plan") {
    const today = figures.today ?? 0;
    const parts = figures.parts ?? 0;
    return {
      lines: [`£${today} TODAY`, `SPLIT THE REST IN ${parts}`],
      card: `£${today} today · split the rest in ${parts}`,
    };
  }
  if (kind === "group") {
    return { lines: ["4 FOR 3", "GROUP TICKETS"], card: "4 for 3 · group tickets" };
  }
  const price = figures.price ?? 0;
  const line = `£${price} EARLY ENTRY`;
  if (!figures.arrive) return { lines: [line], card: `£${price} early entry` };
  const qualifier = `ARRIVE BEFORE ${figures.arrive}`;
  return { lines: [line, qualifier], card: `£${price} early entry · ${qualifier}` };
}

/** £ figures the caption validator may accept beside tier prices. */
export function offerPrices(figures: OfferFigures): number[] {
  return [figures.today, figures.price].filter((price): price is number => price != null);
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name on the offer card. A user id is never a name. */
export function operatorDisplayName(user: { id?: string | null; user_metadata?: Record<string, unknown> | null }): string | null {
  const meta = user.user_metadata ?? {};
  for (const key of ["full_name", "name"]) {
    const value = meta[key];
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (!name || name === user.id || USER_ID.test(name)) continue;
    return name;
  }
  return null;
}

/** "8 Nov" and "Sun 8 Nov 14:10". London, so the card matches the sheet. */
export function enteredByWhen(at: Date): { day: string; wide: string } {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(at);
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Europe/London" }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).format(at);
  return { day, wide: `${weekday} ${day} ${time}` };
}

/** "entered by Matas, 8 Nov". Null when the only identity on hand is the user id. */
export function enteredByLine(name: string | null | undefined, at: Date): string | null {
  const who = name?.trim() ?? "";
  if (!who || USER_ID.test(who)) return null;
  return `entered by ${who}, ${enteredByWhen(at).day}`;
}
