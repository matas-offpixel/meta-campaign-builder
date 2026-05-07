export interface EventCodePrefixOption {
  /** e.g. "WC26" or "4TF26-ARSENAL" */
  prefix: string;
  /** Number of client events whose event_code falls under this prefix. */
  eventCount: number;
  /** The actual event_codes that matched (upper-cased). */
  eventCodes: string[];
}

/**
 * Returns true when `eventCode` belongs to the prefix group.
 * An event code matches prefix P if it equals P exactly or starts with P-
 * (case-insensitive).
 */
export function eventCodeMatchesPrefix(
  eventCode: string,
  prefix: string,
): boolean {
  const uc = eventCode.toUpperCase().trim();
  const p = prefix.toUpperCase().trim();
  return uc === p || uc.startsWith(p + "-");
}

/**
 * Builds prefix options from a list of raw event_code strings (may contain
 * nulls from the DB). Generates 1-segment and 2-segment candidate prefixes
 * from each code, then counts how many events match each candidate.
 *
 * Results are sorted by event count desc, then alphabetically by prefix.
 */
export function buildPrefixOptions(
  eventCodes: Array<string | null | undefined>,
): EventCodePrefixOption[] {
  const codes = eventCodes
    .filter((c): c is string => Boolean(c?.trim()))
    .map((c) => c.trim());

  if (codes.length === 0) return [];

  // Generate candidate prefixes: 1-seg and 2-seg
  const candidates = new Set<string>();
  for (const code of codes) {
    const parts = code.toUpperCase().split("-").filter(Boolean);
    if (parts[0]) candidates.add(parts[0]);
    if (parts[0] && parts[1]) candidates.add(`${parts[0]}-${parts[1]}`);
  }

  const options: EventCodePrefixOption[] = [];
  for (const prefix of candidates) {
    const matching = codes.filter((c) => eventCodeMatchesPrefix(c, prefix));
    if (matching.length > 0) {
      options.push({
        prefix,
        eventCount: matching.length,
        eventCodes: matching.map((c) => c.toUpperCase()),
      });
    }
  }

  return options.sort(
    (a, b) =>
      b.eventCount - a.eventCount || a.prefix.localeCompare(b.prefix),
  );
}
