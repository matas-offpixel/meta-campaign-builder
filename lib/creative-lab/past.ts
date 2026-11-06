/**
 * Past appearances a caption may claim.
 *
 * A line such as "Luke Dean at Circuit last season" is allowed only when
 * a past event of the same client has that artist on its lineup at that
 * venue, or the clip's filmed event does. The promoted show itself is
 * not a past appearance.
 */

import type { ServiceRoleDb } from "./load.ts";

export type PastAppearance = { artist: string; venue: string; city: string; eventId: string };

type EventRow = { id: string; venue_name: string | null; venue_city: string | null; event_date: string | null; client_id: string | null };
type FactsRow = { event_id: string; lineup: string[] | null };

export async function loadPastAppearances(
  db: ServiceRoleDb,
  clientId: string,
  today: string,
  clipId?: string | null,
): Promise<PastAppearance[]> {
  const eventsRes = await db.from("events").select("id, venue_name, venue_city, event_date, client_id").eq("client_id", clientId);
  if (eventsRes.error) throw new Error(`events: ${eventsRes.error.message}`);
  const events = (eventsRes.data ?? []) as EventRow[];

  let clipEventId: string | null = null;
  if (clipId) {
    const clipRes = await db.from("creative_lab_clips").select("event_id").eq("id", clipId).maybeSingle();
    if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
    clipEventId = (clipRes.data as { event_id: string | null } | null)?.event_id ?? null;
  }

  const ids = events
    .filter((event) => {
      const day = event.event_date?.slice(0, 10) ?? "";
      return (day && day < today) || event.id === clipEventId;
    })
    .map((event) => event.id);
  if (!ids.length) return [];

  const factsRes = await db.from("creative_lab_event_facts").select("event_id, lineup").in("event_id", ids);
  if (factsRes.error) throw new Error(`creative_lab_event_facts: ${factsRes.error.message}`);
  const facts = new Map(((factsRes.data ?? []) as FactsRow[]).map((row) => [row.event_id, row.lineup ?? []]));
  const venueOf = new Map(events.map((event) => [event.id, event.venue_name?.trim() ?? ""]));
  const cityOf = new Map(events.map((event) => [event.id, event.venue_city?.trim() ?? ""]));

  const out: PastAppearance[] = [];
  for (const eventId of ids) {
    const venue = venueOf.get(eventId) ?? "";
    const city = cityOf.get(eventId) ?? "";
    if (!venue && !city) continue;
    for (const artist of facts.get(eventId) ?? []) {
      const name = artist.trim();
      if (name) out.push({ artist: name, venue, city, eventId });
    }
  }
  return out;
}
