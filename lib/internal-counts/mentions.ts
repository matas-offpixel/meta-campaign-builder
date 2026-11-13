/**
 * lib/internal-counts/mentions.ts
 *
 * M3: sales mentioned only in the email. One review item per sentence that
 * names a number next to "tickets", "sold" or "total", quoting the
 * sentence. Never parsed into counts: Matas confirms one as a manual entry,
 * typing the figure himself.
 *
 * A sentence is put on a show from the sheet when it (or the sentence before
 * it in the same paragraph) names that show: "On Enzo, …" → ENZO SIRAGUSA;
 * "Grand total sold for this event is 1974." follows it, so it's Enzo too.
 */

import { newPartOfBody } from "./message.ts";

export interface SaleMention {
  sentence: string;
  /** The sheet's show name the sentence is about, or null. */
  showName: string | null;
}

const KEYWORD = /\b(tickets?|sold|total)\b/i;
const NUMBER = /\d/;

function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9£])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The show a sentence names: every word of the sheet name is a prefix of a word in the sentence, in order of the name. */
function showNamed(sentence: string, showNames: readonly string[]): string | null {
  const sw = words(sentence);
  let best: { name: string; score: number } | null = null;
  for (const name of showNames) {
    const nw = words(name);
    if (nw.length === 0) continue;
    const first = sw.indexOf(nw[0]);
    const firstHit = first >= 0 || sw.some((w) => w.startsWith(nw[0]) && nw[0].length >= 4);
    if (!firstHit) continue;
    const rest = nw.slice(1).filter((n) => sw.some((w) => w.startsWith(n) || n.startsWith(w)));
    const score = 1 + rest.length;
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name ?? null;
}

export function saleMentions(body: string, showNames: readonly string[]): SaleMention[] {
  const out: SaleMention[] = [];
  for (const paragraph of newPartOfBody(body).split(/\n\s*\n/)) {
    let lastShow: string | null = null;
    for (const sentence of sentences(paragraph)) {
      const named = showNamed(sentence, showNames);
      if (named) lastShow = named;
      if (KEYWORD.test(sentence) && NUMBER.test(sentence)) {
        out.push({ sentence, showName: named ?? lastShow });
      }
    }
  }
  return out;
}
