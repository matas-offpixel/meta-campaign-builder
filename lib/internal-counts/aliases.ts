/**
 * lib/internal-counts/aliases.ts
 *
 * Show name (exactly as Internal Counts writes it) → event code.
 *
 * TEMPORARY. HD2 adds count aliases to the event (D9); when it lands, this
 * module reads them instead and nothing else changes. Until then a name
 * matches through CONFIRMED_COUNT_ALIASES (empty) or a decision Matas made
 * on the review list ("Match to {event}" / "Not a show we run"), stored in
 * internal_count_show_names (migration 234) and passed in as `confirmed`.
 *
 * A name with no decision goes to the review list with its closest event;
 * it never auto-matches. Names match exactly as written: nothing is
 * trimmed, upper-cased or normalised ("Folamour" and "FOLAMOUR" are two
 * names, and both occur).
 */

/** Confirmed by Matas. Empty until he confirms each proposal below. */
export const CONFIRMED_COUNT_ALIASES: Readonly<Record<string, string>> = {};

/** Exact-name proposals from the 12 Nov sheet: the "Closest" on the review list. */
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

export interface NamedEvent {
  eventCode: string;
  name: string;
  eventDate: string | null;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The closest event to a sheet name, for "Closest: {event} · {date}": the
 * 12 Nov proposals first, then an event whose name starts with the sheet
 * name's letters or the other way round ("AZYR B2B PARTI" → "AZYR b2b
 * Partiboi69"). Never an umbrella. Null when nothing is close.
 */
export function closestEvent(showName: string, events: readonly NamedEvent[]): NamedEvent | null {
  const usable = events.filter((e) => !UMBRELLA_EVENT_CODES.has(e.eventCode));
  const proposed = Object.prototype.hasOwnProperty.call(PROPOSED_COUNT_ALIASES, showName)
    ? usable.find((e) => e.eventCode === PROPOSED_COUNT_ALIASES[showName])
    : undefined;
  if (proposed) return proposed;
  const key = letters(showName);
  if (key.length < 3) return null;
  const hits = usable.filter((e) => {
    const n = letters(e.name);
    return n.length >= 3 && (n.startsWith(key) || key.startsWith(n));
  });
  return hits.sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""))[0] ?? null;
}
