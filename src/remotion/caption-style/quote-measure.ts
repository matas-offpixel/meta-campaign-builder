/**
 * Quote line breaks from TikTok Sans, not a character budget.
 * Advances are the font file's hmtx at wdth 100, opsz 36, wght 400 and 700
 * (src/remotion/caption-style/quote-advances.json). A glyph the face does
 * not have — emoji — is one em, which is how wide the platform draws it.
 * The composition draws these lines and does not wrap them again.
 */

import advances from "./quote-advances.json" with { type: "json" };
import { quoteProfile, type QuoteWeight } from "./quote-profile.ts";

const tables = advances.weights as Record<string, Record<string, number>>;

/** How many ems fit in 0.70 of a 9:16 frame at the quote's font size. */
export function quoteWrapEm(): number {
  return quoteProfile.wrapPctOfWidth / ((16 / 9) * quoteProfile.fontSizePctOfHeight);
}

export function quoteCharEm(char: string, weight: QuoteWeight): number {
  const cp = char.codePointAt(0);
  if (cp == null) return 0;
  const units = tables[String(weight)]?.[String(cp)];
  if (units == null) return 1;
  return units / advances.unitsPerEm;
}

export function quoteTextEm(text: string, weight: QuoteWeight): number {
  let width = 0;
  for (const char of text) width += quoteCharEm(char, weight);
  return width;
}

/** The lines the meter stores and the composition draws. A word is never split. */
export function quoteLinesAt(text: string, weight: QuoteWeight = 700): string[] {
  const limit = quoteWrapEm();
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || quoteTextEm(next, weight) <= limit) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
