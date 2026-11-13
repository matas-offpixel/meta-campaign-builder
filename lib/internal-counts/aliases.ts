/**
 * lib/internal-counts/aliases.ts
 *
 * Show name (exactly as Internal Counts writes it) → event code.
 *
 * TEMPORARY. HD2 adds count aliases to the event (D9); when it lands, this
 * module reads them instead and nothing else changes. Until then this is
 * the one place the map lives.
 *
 * A name only matches through CONFIRMED_COUNT_ALIASES, which Matas fills
 * one name at a time. A name with no confirmed alias goes to the review
 * list with its proposed event; it never auto-matches. Names match exactly
 * as written: nothing is trimmed, upper-cased or normalised.
 */

/** Confirmed by Matas. Empty until he confirms each proposal below. */
export const CONFIRMED_COUNT_ALIASES: Readonly<Record<string, string>> = {};

/** Exact-name proposals from the 12 Nov sheet, for the review list only. */
export const PROPOSED_COUNT_ALIASES: Readonly<Record<string, string>> = {
  IPC: "NX26-IPC",
  "EAST END DUBS": "NX26-EED",
  "D.O.D": "NX26-DOD",
  SCHAK: "NX26-SCHAK",
  RUDIMENTAL: "NX26-RUDIMENTAL",
  "ROBBIE DOHERTY": "NX26-ROBBIEDOHERTY",
  "Julian Fijma": "NX27-JULIANFIJMA",
  LOCKLEAD: "NX26-LOCKLEAD",
  KREAM: "EBR26-KREAM",
};

/** Umbrella events never get counts (D1, D9). */
export const UMBRELLA_EVENT_CODES: ReadonlySet<string> = new Set(["NX26-GLOBAL"]);

export interface ShowMatch {
  eventCode: string | null;
  proposedEventCode: string | null;
}

export function matchShow(
  showName: string,
  confirmed: Readonly<Record<string, string>> = CONFIRMED_COUNT_ALIASES,
): ShowMatch {
  const eventCode = Object.prototype.hasOwnProperty.call(confirmed, showName) ? confirmed[showName] : null;
  const proposed = Object.prototype.hasOwnProperty.call(PROPOSED_COUNT_ALIASES, showName)
    ? PROPOSED_COUNT_ALIASES[showName]
    : null;
  return { eventCode, proposedEventCode: eventCode ?? proposed };
}
