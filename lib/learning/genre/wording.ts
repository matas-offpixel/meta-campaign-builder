/**
 * GK4: how a genre-sourced learning is worded, once its pool is on. No reader
 * calls these yet (GK3: every pool is off and shadow is silent); frame G3
 * draws them so design can rule on the shape before a reader is wired.
 *
 * Counts only: a line names the genre, the number of shows and the number of
 * clients, never another client or another client's show. The one client
 * named is the reader's own, in the fallback sentence. Never on a client's
 * share link or client dashboard.
 */

import { genreLabelInSentence, type GenrePoolKey } from "./families.ts";

function showsAcross(n: number, family: GenrePoolKey, m: number): string {
  return `${n} ${genreLabelInSentence(family)} ${n === 1 ? "show" : "shows"} across ${m} ${m === 1 ? "client" : "clients"}`;
}

/** "From 9 house / tech house shows across 3 clients" */
export function genreSourceLine(n: number, family: GenrePoolKey, m: number): string {
  return `From ${showsAcross(n, family, m)}`;
}

/** The client's own is thin: "Not enough of Puzzle's own shows yet, so this is from …". The possessive is written as is. */
export function genreFallbackLine(clientName: string, n: number, family: GenrePoolKey, m: number): string {
  return `Not enough of ${clientName.trim()}'s own shows yet, so this is from ${showsAcross(n, family, m)}.`;
}

/** Plan predictions' comparable set: "Compared with 6 melodic / progressive shows across 2 clients" */
export function genrePlanLine(n: number, family: GenrePoolKey, m: number): string {
  return `Compared with ${showsAcross(n, family, m)}`;
}
