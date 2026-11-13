/**
 * lib/internal-counts/aliases.ts
 *
 * Show name (exactly as Internal Counts writes it) → event code.
 *
 * The aliases live on the event: #1218's event_count_aliases (migration
 * 235), read with loadCountAliasMap / getEventIdForCountAlias
 * (lib/event-config/aliases.ts). A "Match to {event}" on the review list
 * writes one there too (decideName). Decisions made before the switch are
 * still read from internal_count_show_names, which also keeps the "Not a
 * show we run" names. context.ts builds the name → code map passed to
 * matchShow as `confirmed`; umbrellas come from events.is_umbrella.
 *
 * A name with no alias goes to the review list with its closest event; it
 * never auto-matches. Names match exactly as written: nothing is trimmed,
 * upper-cased or normalised ("Folamour" and "FOLAMOUR" are two names, and
 * both occur).
 */

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

export interface ShowMatch {
  eventCode: string | null;
  proposedEventCode: string | null;
}

export function matchShow(showName: string, confirmed: Readonly<Record<string, string>>): ShowMatch {
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
  /** events.is_umbrella: umbrellas never get counts (D1, D9). */
  isUmbrella?: boolean;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The closest event to a sheet name, for "Closest: {event} · {date}": the
 * 12 Nov proposals first, then an event whose name starts with the sheet
 * name's letters or the other way round ("AZYR B2B PARTI" → "AZYR b2b
 * Partiboi69"). Never an umbrella. Null when nothing is close.
 */
export function closestEvent(showName: string, events: readonly NamedEvent[]): NamedEvent | null {
  const usable = events.filter((e) => e.isUmbrella !== true);
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
