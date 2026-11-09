export type OfferKind = "payment_plan" | "group" | "early_entry";

export type OfferFigures = { today?: number; parts?: number; price?: number; arrive?: string };

/** One sentence. The Offers sheet shows this and does not propose. */
export const OFFER_FINAL_REFUSAL = "An offer can't say final.";

export function offerRefusal(text: string): string | null {
  if (/final/i.test(text)) return OFFER_FINAL_REFUSAL;
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
