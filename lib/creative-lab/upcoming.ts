/**
 * Lineups a "Next:" list may name.
 *
 * A show is included on its own date and drops the day after, in
 * Europe/London. Only events with headliners set count. Support names
 * are not listed. events.notes is never read.
 */

import type { ServiceRoleDb } from "./load.ts";

export type UpcomingShow = {
  eventId: string;
  eventName: string;
  eventDate: string;
  lineup: string[];
  /** Draw order. The Next list uses these, not the rest of the lineup. */
  headliners: string[];
};

/** YYYY-MM-DD in Europe/London. */
export function londonDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

type EventRow = { id: string; name: string; event_date: string | null; client_id: string };
type FactsRow = { event_id: string; lineup: string[] | null; headliners?: string[] | null };

/**
 * Upcoming shows for one client, soonest first.
 * `onDate` is the render day (YYYY-MM-DD). A show with event_date >= onDate stays.
 */
export async function loadUpcomingLineups(
  db: ServiceRoleDb,
  clientId: string,
  onDate: string,
): Promise<UpcomingShow[]> {
  const eventsRes = await db.from("events").select("id, name, event_date, client_id").eq("client_id", clientId);
  if (eventsRes.error) throw new Error(`events: ${eventsRes.error.message}`);
  const events = ((eventsRes.data ?? []) as EventRow[]).filter((event) => {
    const day = event.event_date?.slice(0, 10);
    return Boolean(day && day >= onDate);
  });
  if (!events.length) return [];

  const factsRes = await db.from("creative_lab_event_facts").select("event_id, lineup, headliners").in(
    "event_id",
    events.map((event) => event.id),
  );
  if (factsRes.error) throw new Error(`creative_lab_event_facts: ${factsRes.error.message}`);
  const byEvent = new Map<string, { lineup: string[]; headliners: string[] }>();
  for (const row of (factsRes.data ?? []) as FactsRow[]) {
    const lineup = (row.lineup ?? []).map((name) => name.trim()).filter(Boolean);
    const headliners = (row.headliners ?? []).map((name) => name.trim()).filter(Boolean);
    if (headliners.length) byEvent.set(row.event_id, { lineup, headliners });
  }

  return events
    .flatMap((event) => {
      const facts = byEvent.get(event.id);
      if (!facts) return [];
      return [{
        eventId: event.id,
        eventName: event.name,
        eventDate: event.event_date!.slice(0, 10),
        lineup: facts.lineup,
        headliners: facts.headliners,
      }];
    })
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.eventName.localeCompare(b.eventName));
}

/** Up to three headliners, soonest shows first, in each show's draw order. */
export function nextThreeNames(shows: readonly UpcomingShow[], skip: ReadonlySet<string> = new Set()): string[] {
  const names: string[] = [];
  const seen = new Set([...skip].map((name) => name.toLowerCase()));
  for (const show of shows) {
    for (const name of show.headliners) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
      if (names.length === 3) return names;
    }
  }
  return names;
}
