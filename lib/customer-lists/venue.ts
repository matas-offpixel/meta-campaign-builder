/**
 * The event's venue account: venues by events.venue_id, else the client's
 * venue whose name has the event's venue key (CC-1's loader, read only).
 * Null when there's no venue row (prod had none on 24 Nov: the venue seed
 * hadn't been applied).
 */

import { loadReplicateVenue, type LoadedEvent, type ReplicateDb } from "../replicate/load.ts";
import type { EventRow } from "./sync.ts";

export async function venueAccountOf(db: ReplicateDb, event: Pick<EventRow, "id" | "event_code" | "client_id" | "venue_id" | "venue_name">): Promise<string | null> {
  const loaded = {
    id: event.id,
    event_code: event.event_code,
    client_id: event.client_id,
    name: null,
    venue_id: event.venue_id,
    venue_name: event.venue_name,
    venue_city: null,
    event_date: null,
    presale_at: null,
    general_sale_at: null,
    signup_url: null,
    meta_ad_account_id: null,
    meta_pixel_id: null,
  } as unknown as LoadedEvent;
  try {
    return (await loadReplicateVenue(db, loaded))?.meta_ad_account_id ?? null;
  } catch {
    return null;
  }
}
