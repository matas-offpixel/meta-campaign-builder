/**
 * The event's Lab lineup as the Drive tree needs it: event_artists rows with
 * source = 'lab' (the lineup the operator saved — not the ad-copy or
 * campaign-name links the artist library job adds), each with the library
 * artist's name as written. Artist clips/{artist} folders are named from it
 * and S22 matches folder names against it exactly.
 */

import { rowById, rowsWhere, type DriveDb } from "./db.ts";

export type LineupArtist = { libraryArtistId: string; name: string };

export async function loadLineupArtists(db: DriveDb, eventId: string): Promise<LineupArtist[]> {
  const rows = (await rowsWhere(db, "event_artists", "event_id", eventId))
    .filter((row) => row.source === "lab")
    .sort((a, b) => a.billing_order - b.billing_order);
  const out: LineupArtist[] = [];
  for (const row of rows) {
    const artist = await rowById(db, "artists", row.artist_id);
    if (artist?.name) out.push({ libraryArtistId: artist.id, name: artist.name });
  }
  return out;
}
